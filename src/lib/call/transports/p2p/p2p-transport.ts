/**
 * P2P mesh transport: one RTCPeerConnection per remote participant, for calls
 * of two to four people. It implements src/lib/call/transport.ts and follows
 * D5: the caller owns capture, this transport never stops a track, and
 * leave() closes every connection it opened.
 *
 * Negotiation is the W3C "perfect negotiation" pattern: either side may offer
 * at any time; on a collision the polite side (the lower participant id)
 * rolls back and answers, the impolite side ignores the colliding offer.
 * That covers simultaneous joins, renegotiation after a device change and
 * ICE restarts started by both ends at once.
 *
 * Recovery:
 * - ICE "failed" restarts ICE at once; "disconnected" restarts it after
 *   DISCONNECTED_GRACE_MS, since it often heals by itself first.
 * - A connection that is not up within NOT_CONNECTED_RESTART_MS restarts
 *   ICE, and again each period after. A connection built while the network
 *   was down can have no TURN allocation and no candidates at all, and
 *   Chrome takes far longer than that to declare it failed by itself.
 * - A lost signaling connection reconnects with backoff. Peers tear down
 *   their connection to us when the server reports us gone, so on the next
 *   welcome every peer connection is rebuilt from scratch.
 * - Joining or reconnecting that does not reach "connected" within
 *   GIVE_UP_MS ends in "failed" with a retryable error, so the UI never
 *   shows a spinner forever.
 */
import type {
  CallPhase,
  CallTransport,
  LocalCallState,
  TransportContext,
  TransportErrorKind,
  TransportEvents,
} from "../../transport";
import type {
  P2PSignal,
  SignalingAdapter,
  SignalingConnection,
} from "./signaling";

const DISCONNECTED_GRACE_MS = 3000;
const NOT_CONNECTED_RESTART_MS = 6000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;
const GIVE_UP_MS = { joining: 30_000, reconnecting: 45_000 } as const;

/**
 * Bench-only event trace for diagnosing failed joins: the harness reads the
 * tail of window.__connvoCallLog when a join never connects. Off outside the
 * eval setup.
 */
const TRACE = process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH === "1";
function trace(message: string): void {
  if (!TRACE || typeof window === "undefined") return;
  const w = window as unknown as { __connvoCallLog?: string[] };
  const log = (w.__connvoCallLog ??= []);
  log.push(`${Math.round(performance.now())} ${message}`);
  if (log.length > 300) log.shift();
}

type Kind = "audio" | "video";
const KINDS: Kind[] = ["audio", "video"];

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  /** The lower id yields on an offer collision. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  /** Candidates that arrived before any remote description. */
  pendingCandidates: RTCIceCandidateInit[];
  senders: Partial<Record<Kind, RTCRtpSender>>;
  remoteStream: MediaStream;
  streamAnnounced: boolean;
  everConnected: boolean;
  /** Incoming signals for this peer are applied one at a time, in order. */
  chain: Promise<void>;
  disconnectedTimer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setInterval> | null;
}

export interface P2PTransportOptions {
  signaling: SignalingAdapter;
}

export function createP2PTransport({
  signaling,
}: P2PTransportOptions): CallTransport {
  let ctx: TransportContext | null = null;
  let events: TransportEvents | null = null;
  let conn: SignalingConnection | null = null;
  /** Bumped per connection attempt so late callbacks from an old one are ignored. */
  let generation = 0;
  let signalingUp = false;
  let phase: CallPhase = "idle";
  let leaving = false;
  let localStream: MediaStream | null = null;
  let localState: LocalCallState = { micOn: true, cameraOn: true };
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let giveUpTimer: ReturnType<typeof setTimeout> | null = null;
  const peers = new Map<string, Peer>();

  function setPhase(next: CallPhase): void {
    if (phase === next) return;
    phase = next;
    events?.onPhase(next);
    if (giveUpTimer) clearTimeout(giveUpTimer);
    giveUpTimer = null;
    if (next === "joining" || next === "reconnecting") {
      giveUpTimer = setTimeout(() => {
        if (phase === next) {
          fail(
            "network",
            next === "joining"
              ? "Could not connect to the other people in this call."
              : "The connection did not come back.",
            true,
          );
        }
      }, GIVE_UP_MS[next]);
    }
  }

  function fail(
    kind: TransportErrorKind,
    message: string,
    retryable: boolean,
  ): void {
    if (phase === "left" || phase === "failed") return;
    events?.onError({ kind, message, retryable });
    teardownAll(false);
    closeSignaling();
    setPhase("failed");
  }

  /**
   * Connected once signaling is up and every peer we have reached is still
   * reachable. A peer that has never connected holds the call in its current
   * joining/reconnecting phase but cannot drag a connected call back down.
   */
  function refreshPhase(): void {
    if (leaving || phase === "left" || phase === "failed" || phase === "idle")
      return;
    if (!signalingUp) {
      setPhase(phase === "joining" ? "joining" : "reconnecting");
      return;
    }
    const all = [...peers.values()];
    const broken = all.some(
      (p) => p.everConnected && p.pc.connectionState !== "connected",
    );
    const pending = all.some((p) => !p.everConnected);
    if (broken) setPhase("reconnecting");
    else if (pending && phase !== "connected") return;
    else setPhase("connected");
  }

  function currentStream(): MediaStream | null {
    return localStream ?? ctx?.getLocalStream() ?? null;
  }

  function send(to: string, signal: P2PSignal): void {
    conn?.send(to, signal);
  }

  function enqueue(peer: Peer, step: () => Promise<void>): void {
    peer.chain = peer.chain.then(step).catch((err: unknown) => {
      // A stale description or candidate; the next negotiation recovers.
      trace(
        `${peer.id} signal step failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  function createPeer(id: string): Peer {
    if (!ctx) throw new Error("p2p transport: createPeer before connect");
    const pc = new RTCPeerConnection(ctx.rtcConfig);
    const peer: Peer = {
      id,
      pc,
      polite: ctx.selfId < id,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      pendingCandidates: [],
      senders: {},
      remoteStream: new MediaStream(),
      streamAnnounced: false,
      everConnected: false,
      chain: Promise.resolve(),
      disconnectedTimer: null,
      watchdog: null,
    };
    peers.set(id, peer);

    // addTrack, not addTransceiver: a remote offer can reuse an addTrack
    // transceiver, so a glare rollback does not leave orphaned m-lines.
    const stream = currentStream();
    for (const kind of KINDS) {
      const track = stream?.getTracks().find((t) => t.kind === kind);
      if (track && stream) peer.senders[kind] = pc.addTrack(track, stream);
    }

    pc.onicecandidate = ({ candidate }) => {
      trace(
        `${id} local candidate ${candidate ? candidate.type : "end"}${conn ? "" : " (no signaling)"}`,
      );
      if (candidate) send(id, { candidate: candidate.toJSON() });
    };
    pc.onicegatheringstatechange = () =>
      trace(`${id} gathering ${pc.iceGatheringState}`);
    pc.ontrack = ({ track }) => {
      for (const old of peer.remoteStream.getTracks()) {
        if (old.kind === track.kind && old.id !== track.id)
          peer.remoteStream.removeTrack(old);
      }
      if (!peer.remoteStream.getTrackById(track.id))
        peer.remoteStream.addTrack(track);
      if (!peer.streamAnnounced) {
        peer.streamAnnounced = true;
        events?.onRemoteStream({
          participantId: id,
          stream: peer.remoteStream,
        });
      }
    };
    pc.onnegotiationneeded = async () => {
      trace(`${id} negotiationneeded (${pc.signalingState})`);
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        trace(`${id} sent ${pc.localDescription?.type}`);
        if (pc.localDescription)
          send(id, { description: pc.localDescription.toJSON() });
      } catch (err) {
        // The pc closed or a newer negotiation replaced this one.
        trace(
          `${id} offer failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "failed") {
        pc.restartIce();
      } else if (state === "disconnected" && !peer.disconnectedTimer) {
        peer.disconnectedTimer = setTimeout(() => {
          peer.disconnectedTimer = null;
          if (pc.iceConnectionState === "disconnected") pc.restartIce();
        }, DISCONNECTED_GRACE_MS);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") peer.everConnected = true;
      refreshPhase();
    };
    peer.watchdog = setInterval(() => {
      if (pc.connectionState !== "connected" && pc.connectionState !== "closed")
        pc.restartIce();
    }, NOT_CONNECTED_RESTART_MS);
    return peer;
  }

  async function applySignal(peer: Peer, signal: P2PSignal): Promise<void> {
    const { pc } = peer;
    if ("description" in signal) {
      const description = signal.description;
      const readyForOffer =
        !peer.makingOffer &&
        (pc.signalingState === "stable" || peer.settingRemoteAnswer);
      const collision = description.type === "offer" && !readyForOffer;
      peer.ignoreOffer = !peer.polite && collision;
      trace(
        `${peer.id} got ${description.type} in ${pc.signalingState}${collision ? " (collision)" : ""}${peer.ignoreOffer ? " ignored" : ""}`,
      );
      if (peer.ignoreOffer) return;
      peer.settingRemoteAnswer = description.type === "answer";
      await pc.setRemoteDescription(description);
      peer.settingRemoteAnswer = false;
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
      trace(`${peer.id} applied ${description.type}; now ${pc.signalingState}`);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        if (pc.localDescription)
          send(peer.id, { description: pc.localDescription.toJSON() });
      }
      return;
    }
    if (!pc.remoteDescription) {
      trace(`${peer.id} remote candidate queued`);
      peer.pendingCandidates.push(signal.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(signal.candidate);
      trace(`${peer.id} remote candidate added`);
    } catch (err) {
      // Candidates for an offer we ignored are expected to fail.
      if (!peer.ignoreOffer) throw err;
    }
  }

  /** Closes one peer connection. Never stops local tracks (D5). */
  function closePeer(peer: Peer): void {
    if (peer.disconnectedTimer) clearTimeout(peer.disconnectedTimer);
    if (peer.watchdog) clearInterval(peer.watchdog);
    const { pc } = peer;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onnegotiationneeded = null;
    pc.oniceconnectionstatechange = null;
    pc.onconnectionstatechange = null;
    pc.close();
    peers.delete(peer.id);
  }

  function teardownAll(announce: boolean): void {
    for (const peer of [...peers.values()]) {
      closePeer(peer);
      if (announce)
        events?.onRemoteLeft({ participantId: peer.id, reason: "left" });
    }
  }

  /** A fresh connection to `id`; the tile stays if one already existed. */
  function rebuildPeer(id: string): void {
    const existing = peers.get(id);
    trace(
      `${id} ${existing ? "rebuild" : "build"} peer (local tracks: ${currentStream()?.getTracks().length ?? 0})`,
    );
    if (existing) closePeer(existing);
    else events?.onRemoteJoined({ participantId: id });
    createPeer(id);
  }

  function closeSignaling(): void {
    generation++;
    conn?.close();
    conn = null;
    signalingUp = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function openSignaling(): void {
    if (!ctx) return;
    const mine = ++generation;
    const live = () => mine === generation && !leaving;
    conn = signaling.open(
      { meetingId: ctx.meetingId, identityToken: ctx.identityToken },
      {
        onWelcome: (present) => {
          trace(`welcome [${present.join(",")}]${live() ? "" : " (stale)"}`);
          if (!live()) return;
          signalingUp = true;
          reconnectAttempt = 0;
          for (const id of [...peers.keys()]) {
            if (!present.includes(id)) {
              const gone = peers.get(id);
              if (gone) closePeer(gone);
              events?.onRemoteLeft({ participantId: id, reason: "left" });
            }
          }
          for (const id of present) rebuildPeer(id);
          conn?.publishState(localState);
          refreshPhase();
        },
        onPeerJoined: (id) => {
          trace(`peer-joined ${id}${live() ? "" : " (stale)"}`);
          if (!live()) return;
          rebuildPeer(id);
          // The newcomer has never seen our mute/camera state.
          conn?.publishState(localState);
          refreshPhase();
        },
        onPeerLeft: (id) => {
          trace(`peer-left ${id}${live() ? "" : " (stale)"}`);
          if (!live()) return;
          const peer = peers.get(id);
          if (peer) closePeer(peer);
          events?.onRemoteLeft({ participantId: id, reason: "left" });
          refreshPhase();
        },
        onSignal: (from, signal) => {
          if (!live()) return;
          let peer = peers.get(from);
          if (!peer) {
            events?.onRemoteJoined({ participantId: from });
            peer = createPeer(from);
          }
          const target = peer;
          enqueue(target, () => applySignal(target, signal));
        },
        onRemoteState: (state) => {
          if (live()) events?.onRemoteState(state);
        },
        onClosed: (reason) => {
          trace(
            `signaling closed: ${reason.kind} ${reason.message}${live() ? "" : " (stale)"}`,
          );
          if (!live()) return;
          conn = null;
          signalingUp = false;
          if (reason.kind === "rejected") {
            fail("auth", reason.message, false);
            return;
          }
          if (reason.kind === "replaced") {
            // Retrying is the user's call: it would take the call back from
            // the other window.
            fail("network", reason.message, true);
            return;
          }
          refreshPhase();
          const delay = Math.min(
            RECONNECT_MAX_MS,
            RECONNECT_BASE_MS * 2 ** reconnectAttempt,
          );
          reconnectAttempt++;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!leaving && phase !== "failed" && phase !== "left")
              openSignaling();
          }, delay);
        },
      },
    );
  }

  return {
    name: "p2p",

    async connect(context, transportEvents): Promise<void> {
      trace(`connect as ${context.selfId}`);
      teardownAll(false);
      closeSignaling();
      ctx = context;
      events = transportEvents;
      leaving = false;
      reconnectAttempt = 0;
      phase = "idle";
      setPhase("joining");
      openSignaling();
    },

    publishLocalStream(stream: MediaStream | null): void {
      localStream = stream;
      for (const peer of peers.values()) {
        for (const kind of KINDS) {
          const track =
            stream?.getTracks().find((t) => t.kind === kind) ?? null;
          const sender = peer.senders[kind];
          if (sender) {
            if (sender.track !== track)
              void sender.replaceTrack(track).catch(() => {});
          } else if (track && stream) {
            peer.senders[kind] = peer.pc.addTrack(track, stream);
          }
        }
      }
    },

    publishLocalState(state: LocalCallState): void {
      localState = state;
      conn?.publishState(state);
    },

    async leave(): Promise<void> {
      leaving = true;
      if (giveUpTimer) clearTimeout(giveUpTimer);
      giveUpTimer = null;
      closeSignaling();
      teardownAll(false);
      localStream = null;
      setPhase("left");
    },
  };
}
