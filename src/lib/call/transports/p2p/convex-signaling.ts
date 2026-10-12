/**
 * Convex signaling adapter for the P2P mesh, over the call mesh API in
 * convex/meetings/webrtc/mesh.ts (every function behind assertMeetingAccess).
 *
 * One open() is one session: join, then follow presence and the signals
 * addressed to this session, and heartbeat. Presence changes become
 * peer-joined/peer-left (a participant whose session changed, a reloaded
 * tab, is reported as leaving and joining again, so the mesh rebuilds that
 * connection). A refused join is "rejected"; a heartbeat that reports the
 * session replaced by another tab is "replaced"; a heartbeat that fails,
 * stalls or reports the session expired is "lost", and the mesh reconnects
 * with a new session.
 */
import { api } from "@convex/_generated/api";

import type {
  P2PSignal,
  SignalingAdapter,
  SignalingConnection,
} from "./signaling";

export const HEARTBEAT_MS = 2000;
/** A heartbeat that has not answered in this long counts as a lost connection. */
export const HEARTBEAT_STALL_MS = 6000;
/**
 * How long a signal from a sender presence has not shown is kept before it
 * is acknowledged unread. A sender's first offer can beat its presence entry
 * by a few hundred milliseconds; a sender that never appears has closed, and
 * its signals would otherwise hold places in this session's capped queue.
 */
export const UNKNOWN_SENDER_HOLD_MS = 5000;

/** The slice of ConvexReactClient the adapter uses (a fake in tests). */
export interface ConvexCallClient {
  mutation(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
  watchQuery(
    ref: unknown,
    args: Record<string, unknown>,
  ): {
    onUpdate(callback: () => void): () => void;
    localQueryResult(): unknown;
  };
}

interface PresenceEntry {
  sessionId: string;
  participantId: string;
  micOn: boolean;
  cameraOn: boolean;
}

type WireSignal =
  | {
      kind: "description";
      type: "offer" | "answer" | "pranswer" | "rollback";
      sdp: string;
    }
  | {
      kind: "candidate";
      candidate: string;
      sdpMLineIndex?: number;
      sdpMid?: string;
      usernameFragment?: string;
    };

interface InboundSignal {
  _id: string;
  fromSessionId: string;
  fromParticipantId: string;
  signal: WireSignal;
}

/** The structured data of a ConvexError (convex/lib/errors.ts), if any. */
function errorData(err: unknown): { code?: string; message?: string } | null {
  const data = (err as { data?: unknown })?.data;
  const parsed = typeof data === "string" ? safeJson(data) : data;
  return parsed && typeof parsed === "object" ? parsed : null;
}

/** A refusal from assertMeetingAccess or requireIdentity, with its message. */
function refusal(err: unknown): string | null {
  const data = errorData(err);
  if (data?.code === "FORBIDDEN" || data?.code === "UNAUTHORIZED") {
    return data.message ?? "Access denied";
  }
  return null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toWire(signal: P2PSignal): WireSignal {
  if ("description" in signal) {
    const { type, sdp } = signal.description;
    return {
      kind: "description",
      type: (type ?? "offer") as "offer",
      sdp: sdp ?? "",
    };
  }
  // RTCIceCandidateInit uses null for absent fields; the validator takes
  // only absent ones.
  const c = signal.candidate;
  return {
    kind: "candidate",
    candidate: c.candidate ?? "",
    ...(c.sdpMLineIndex != null ? { sdpMLineIndex: c.sdpMLineIndex } : {}),
    ...(c.sdpMid != null ? { sdpMid: c.sdpMid } : {}),
    ...(c.usernameFragment != null
      ? { usernameFragment: c.usernameFragment }
      : {}),
  };
}

function fromWire(signal: WireSignal): P2PSignal {
  if (signal.kind === "description")
    return { description: { type: signal.type, sdp: signal.sdp } };
  return {
    candidate: {
      candidate: signal.candidate,
      sdpMLineIndex: signal.sdpMLineIndex ?? null,
      sdpMid: signal.sdpMid ?? null,
      usernameFragment: signal.usernameFragment ?? null,
    },
  };
}

export interface ConvexSignalingOptions {
  /**
   * How a participant appears to the mesh and the page, from their WorkOS
   * user id. Identity by default; the eval page maps its test users.
   */
  participantIdOf?: (workosUserId: string) => string;
  newSessionId?: () => string;
}

export function convexSignaling(
  client: ConvexCallClient,
  options: ConvexSignalingOptions = {},
): SignalingAdapter {
  const idOf = options.participantIdOf ?? ((id: string) => id);
  const newSessionId = options.newSessionId ?? (() => crypto.randomUUID());
  const mesh = api.meetings.webrtc.mesh;

  return {
    open(session, handlers): SignalingConnection {
      const meetingId = session.meetingId;
      const sessionId = newSessionId();
      let closed = false;
      let joined = false;
      let welcomed = false;
      /** participantId -> their current session */
      const peers = new Map<string, PresenceEntry>();
      const seen = new Set<string>();
      /** Signals from sessions presence has not shown yet, by signal id. */
      const held = new Map<string, { row: InboundSignal; since: number }>();
      const stops: Array<() => void> = [];
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let lastHeartbeatOk = Date.now();

      const shutdown = () => {
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        for (const stop of stops.splice(0)) stop();
      };
      const report = (reason: Parameters<typeof handlers.onClosed>[0]) => {
        if (closed) return;
        shutdown();
        handlers.onClosed(reason);
      };
      const fail = (err: unknown) => {
        const message = refusal(err);
        if (message) report({ kind: "rejected", message });
        else
          report({
            kind: "lost",
            message:
              err instanceof Error ? err.message : "lost the call service",
          });
      };

      const onPresence = (entries: PresenceEntry[]) => {
        applyPresence(entries);
        if (held.size) onSignals([...held.values()].map((h) => h.row));
      };
      const applyPresence = (entries: PresenceEntry[]) => {
        const now = new Map<string, PresenceEntry>();
        for (const e of entries) {
          if (e.sessionId === sessionId) continue;
          now.set(idOf(e.participantId), e);
        }
        if (!welcomed) {
          welcomed = true;
          for (const [id, e] of now) peers.set(id, e);
          handlers.onWelcome([...now.keys()]);
          for (const [id, e] of now)
            handlers.onRemoteState({
              participantId: id,
              micOn: e.micOn,
              cameraOn: e.cameraOn,
            });
          return;
        }
        for (const [id, before] of [...peers]) {
          const after = now.get(id);
          if (!after || after.sessionId !== before.sessionId) {
            peers.delete(id);
            handlers.onPeerLeft(id, after ? "rejoined" : "left");
          }
        }
        for (const [id, e] of now) {
          const before = peers.get(id);
          if (!before) {
            peers.set(id, e);
            handlers.onPeerJoined(id);
            handlers.onRemoteState({
              participantId: id,
              micOn: e.micOn,
              cameraOn: e.cameraOn,
            });
          } else if (
            before.micOn !== e.micOn ||
            before.cameraOn !== e.cameraOn
          ) {
            peers.set(id, e);
            handlers.onRemoteState({
              participantId: id,
              micOn: e.micOn,
              cameraOn: e.cameraOn,
            });
          }
        }
      };

      const onSignals = (rows: InboundSignal[]) => {
        const ack: string[] = [];
        for (const row of rows) {
          if (seen.has(row._id)) continue;
          const from = idOf(row.fromParticipantId);
          const known = peers.get(from);
          // A peer's first offer can arrive before presence shows the peer:
          // hold it until presence does (onPresence replays held signals).
          if (!known) {
            if (!held.has(row._id))
              held.set(row._id, { row, since: Date.now() });
            continue;
          }
          held.delete(row._id);
          seen.add(row._id);
          ack.push(row._id);
          // A signal from a session the peer has since replaced is stale.
          if (known.sessionId !== row.fromSessionId) continue;
          handlers.onSignal(from, fromWire(row.signal));
        }
        if (ack.length)
          void client
            .mutation(mesh.ackSignals, { meetingId, sessionId, signalIds: ack })
            .catch(() => {});
      };

      const watch = <T>(
        ref: unknown,
        args: Record<string, unknown>,
        apply: (value: T) => void,
      ) => {
        const w = client.watchQuery(ref, args);
        const read = () => {
          if (closed) return;
          let value: unknown;
          try {
            value = w.localQueryResult();
          } catch (err) {
            fail(err);
            return;
          }
          if (value !== undefined) apply(value as T);
        };
        stops.push(w.onUpdate(read));
        read();
      };

      const dropUnclaimed = () => {
        const now = Date.now();
        const drop: string[] = [];
        for (const [id, h] of held) {
          if (now - h.since <= UNKNOWN_SENDER_HOLD_MS) continue;
          held.delete(id);
          seen.add(id);
          drop.push(id);
        }
        if (drop.length)
          void client
            .mutation(mesh.ackSignals, {
              meetingId,
              sessionId,
              signalIds: drop,
            })
            .catch(() => {});
      };

      const beat = async () => {
        if (closed) return;
        dropUnclaimed();
        if (Date.now() - lastHeartbeatOk > HEARTBEAT_STALL_MS) {
          report({
            kind: "lost",
            message: "the call service stopped answering",
          });
          return;
        }
        try {
          const r = (await client.mutation(mesh.heartbeat, {
            meetingId,
            sessionId,
          })) as { alive: boolean; reason?: string };
          if (closed) return;
          lastHeartbeatOk = Date.now();
          if (!r.alive) {
            if (r.reason === "replaced")
              report({
                kind: "replaced",
                message: "This call is open in another window or tab.",
              });
            else if (r.reason === "ended")
              report({ kind: "rejected", message: "This meeting has ended." });
            else report({ kind: "lost", message: "the call session expired" });
          }
        } catch (err) {
          if (refusal(err)) fail(err);
          // Other errors: the stall check above decides.
        }
      };

      void (async () => {
        try {
          await session.identityToken();
        } catch (err) {
          fail(err);
          return;
        }
        try {
          await client.mutation(mesh.joinCall, { meetingId, sessionId });
        } catch (err) {
          // The Convex client queues mutations while offline rather than
          // failing them, so an error here is the server's answer (not a
          // participant, meeting not active, not a meeting id), and asking
          // again gets the same answer: stop and say why.
          report({
            kind: "rejected",
            message:
              refusal(err) ??
              errorData(err)?.message ??
              "This call could not be joined.",
          });
          return;
        }
        if (closed) {
          void client
            .mutation(mesh.leaveCall, { meetingId, sessionId })
            .catch(() => {});
          return;
        }
        joined = true;
        lastHeartbeatOk = Date.now();
        watch<PresenceEntry[]>(mesh.callPresence, { meetingId }, onPresence);
        watch<InboundSignal[]>(
          mesh.signalsForSession,
          { meetingId, sessionId },
          onSignals,
        );
        heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_MS);
      })();

      return {
        send(to, signal) {
          const peer = peers.get(to);
          if (!joined || closed || !peer) return;
          void client
            .mutation(mesh.sendSignal, {
              meetingId,
              fromSessionId: sessionId,
              toSessionId: peer.sessionId,
              signal: toWire(signal),
            })
            .catch(() => {});
        },
        publishState(state) {
          if (!joined || closed) return;
          void client
            .mutation(mesh.setMediaState, {
              meetingId,
              sessionId,
              micOn: state.micOn,
              cameraOn: state.cameraOn,
            })
            .catch(() => {});
        },
        close() {
          const wasJoined = joined;
          shutdown();
          if (wasJoined)
            void client
              .mutation(mesh.leaveCall, { meetingId, sessionId })
              .catch(() => {});
        },
      };
    },
  };
}
