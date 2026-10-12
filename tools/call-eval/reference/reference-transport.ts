/**
 * Eval-only reference WebRTC transport (CALL-PLAN.md S0, CONTRACT.md).
 *
 * Full mesh over the local WebSocket signaling server
 * (tools/call-eval/reference/signaling-server.mjs). Registered in
 * src/lib/call/transports/index.ts as "reference" plus the broken variants
 * reference-no-audio / reference-never-close / reference-no-reconnect.
 *
 * Rules that keep the harness scenarios honest:
 * - Offers are created only by the lexicographically greater peer id, so
 *   simultaneous joins in either order (H-12) cannot glare.
 * - A signaling drop enters "reconnecting", re-hellos over a fresh socket
 *   and rebuilds the mesh (H-07); a rejected hello surfaces the server's
 *   named rejection verbatim as a kind:"auth" transport error (H-14).
 * - leave() closes the signaling socket and every peer connection (D5, H-11).
 *
 * This file runs in the browser (it is imported by the bench page through
 * the transport registry), so it uses the DOM WebSocket and RTCPeerConnection.
 */

import type {
  CallPhase,
  CallTransport,
  LocalCallState,
  RemoteParticipantState,
  TransportContext,
  TransportEvents,
} from "@/lib/call/transport";

/**
 * The eval signaling server URL. `pnpm call-eval:backend` (and the smoke
 * commands in CONTRACT.md) start next dev with this variable pointing at the
 * reference signaling server; ports 9301-9310 are reserved for eval.
 */
const SIGNALING_URL =
  process.env.NEXT_PUBLIC_CONNVO_CALL_SIGNALING_URL ?? "ws://127.0.0.1:9301";

/** Reconnect retry cadence; media must recover within 10 s of restore (H-07). */
const RECONNECT_DELAY_MS = 1000;

/** Wire subset of the reference signaling server's messages. */
type SignalingDown =
  | { type: "welcome"; selfId: string; peers: string[] }
  | { type: "peer-joined"; participantId: string }
  | { type: "peer-left"; participantId: string; reason: string }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "remote-state"; from: string; micOn: boolean; cameraOn: boolean }
  | { type: "error"; code: string; message: string };

type SignalData =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit }
  /** The answering side asks the offering side for a fresh offer. */
  | { renegotiate: true };

type SignalingUp =
  | { type: "hello"; token: string; meetingId: string }
  | { type: "signal"; to: string; data: SignalData }
  | { type: "state"; micOn: boolean; cameraOn: boolean }
  | { type: "bye" };

/**
 * A deliberately broken behavior, one per harness scenario the variant must
 * fail. Everything else about the variant stays identical to "reference" so
 * the failing scenario is attributable to the named defect alone.
 */
export type ReferenceDefect = "no-audio" | "never-close" | "no-reconnect";

export interface ReferenceTransportOptions {
  defect?: ReferenceDefect;
  /** Overrides NEXT_PUBLIC_CONNVO_CALL_SIGNALING_URL (runner `?signal=` param). */
  signalUrl?: string;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  /** The lexicographically greater peer id creates offers. */
  initiator: boolean;
  /** ICE candidates that arrived before the remote description was set. */
  pendingCandidates: RTCIceCandidateInit[];
  publishedStream: boolean;
  /** Highest inbound framesDecoded observed — the decoder-output evidence the connected phase requires. */
  decodedFrames: number;
  /** Signals for this peer run one at a time, in arrival order. */
  chain: Promise<void>;
  /** The initiator owes a fresh offer once the current one is answered. */
  offerPending: boolean;
}

export function createReferenceTransport(
  options: ReferenceTransportOptions = {},
): CallTransport {
  const defect = options.defect ?? null;
  const name = defect ? `reference-${defect}` : "reference";

  let ctx: TransportContext | null = null;
  let events: TransportEvents | null = null;
  let ws: WebSocket | null = null;
  let phase: CallPhase = "idle";
  let leaving = false;
  let localStream: MediaStream | null = null;
  let localState: LocalCallState = { micOn: true, cameraOn: true };
  let lastToken: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let decodedPollTimer: ReturnType<typeof setInterval> | null = null;
  const peers = new Map<string, PeerEntry>();

  function setPhase(next: CallPhase): void {
    phase = next;
    events?.onPhase(next);
  }

  function fail(kind: "auth" | "network" | "media" | "unknown", message: string, retryable: boolean): void {
    events?.onError({ kind, message, retryable });
    stopDecodedPoll();
    if (phase !== "left") setPhase("failed");
  }

  /** True when at least one remote peer exists, every peer is ICE-connected,
   * and every peer's decoder has produced at least one frame. */
  function meshReadyForConnected(): boolean {
    if (peers.size === 0) return false;
    for (const [, entry] of peers) {
      if (entry.pc.connectionState !== "connected") return false;
      if (entry.decodedFrames <= 0) return false;
    }
    return true;
  }

  function maybeConnected(): void {
    if ((phase === "joining" || phase === "reconnecting") && meshReadyForConnected()) {
      stopDecodedPoll();
      setPhase("connected");
    }
  }

  /** Reads each peer's browser-side framesDecoded counter — real decoder
   * output, not a phase shortcut — and flips to connected when the whole
   * mesh has media. */
  async function pollDecodedFrames(): Promise<void> {
    for (const [, entry] of peers) {
      if (entry.decodedFrames > 0) continue;
      try {
        const stats = await entry.pc.getStats();
        stats.forEach((report) => {
          const r = report as unknown as {
            type?: string;
            kind?: string;
            mediaType?: string;
            framesDecoded?: number;
          };
          if (
            r.type === "inbound-rtp" &&
            (r.kind === "video" || r.mediaType === "video") &&
            typeof r.framesDecoded === "number" &&
            r.framesDecoded > entry.decodedFrames
          ) {
            entry.decodedFrames = r.framesDecoded;
          }
        });
      } catch {
        /* the pc can close mid-poll; the next tick retries */
      }
    }
    maybeConnected();
  }

  function startDecodedPoll(): void {
    if (decodedPollTimer) return;
    decodedPollTimer = setInterval(() => {
      if (phase === "joining" || phase === "reconnecting") void pollDecodedFrames();
    }, 250);
  }

  function stopDecodedPoll(): void {
    if (decodedPollTimer) {
      clearInterval(decodedPollTimer);
      decodedPollTimer = null;
    }
  }

  function wsSend(message: SignalingUp): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function relayTo(participantId: string, data: SignalData): void {
    wsSend({ type: "signal", to: participantId, data });
  }

  /** Adds the local capture tracks to a peer connection (D5: never stops them). */
  function attachLocalTracks(entry: PeerEntry): void {
    // The UI's capture can exist before publishLocalStream runs (the bench
    // captures, connects, then publishes), and a welcome can arrive in
    // between. Reading the context's stream here means a peer built in that
    // window still carries media in its first offer or answer.
    const stream = localStream ?? ctx?.getLocalStream() ?? null;
    if (!stream) return;
    for (const track of stream.getVideoTracks()) {
      entry.pc.addTrack(track, stream);
    }
    // H-02 defect: the audio track is never added, so receivers hear silence
    // and the tone-frequency pass condition cannot hold.
    if (defect !== "no-audio") {
      for (const track of stream.getAudioTracks()) {
        entry.pc.addTrack(track, stream);
      }
    }
  }

  function teardownPeer(participantId: string): void {
    const entry = peers.get(participantId);
    if (!entry) return;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.onnegotiationneeded = null;
    entry.pc.close();
    peers.delete(participantId);
  }

  function buildPeer(participantId: string): void {
    if (!ctx || !events || peers.has(participantId)) return;
    const pc = new RTCPeerConnection(ctx.rtcConfig);
    const entry: PeerEntry = {
      pc,
      initiator: ctx.selfId > participantId,
      pendingCandidates: [],
      publishedStream: false,
      decodedFrames: 0,
      chain: Promise.resolve(),
      offerPending: false,
    };
    peers.set(participantId, entry);

    pc.onicecandidate = (event) => {
      if (event.candidate) relayTo(participantId, { candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      if (entry.publishedStream) return;
      const stream = event.streams[0];
      if (!stream) return;
      entry.publishedStream = true;
      events?.onRemoteStream({ participantId, stream });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        // ICE is up; the connected phase still waits for decoded output
        // (the poll flips it once framesDecoded advances).
        void pollDecodedFrames();
      }
      if (pc.connectionState === "failed") {
        // A failed media link while signaling is still up: nothing else will
        // rebuild it, so restart ICE (the initiator re-offers; the other side
        // asks it to). The self-proof caught the gap: in H-06, 2 of 15 seeds
        // reached ICE "failed" on both sides and sat in reconnecting forever.
        setPhase(phase === "left" ? phase : "reconnecting");
        entry.decodedFrames = 0;
        startDecodedPoll();
        if (defect !== "no-reconnect") pc.restartIce();
      }
    };

    attachLocalTracks(entry);

    // Only the initiator offers, so offers never collide. When the answering
    // side needs negotiation (a track added after its answer, or an ICE
    // restart), it asks the initiator for a fresh offer instead.
    pc.onnegotiationneeded = () => {
      if (entry.initiator) {
        enqueue(entry, () => createAndSendOffer(participantId, entry));
      } else if (pc.remoteDescription && pc.signalingState === "stable") {
        // Before the first offer arrives there is nothing to renegotiate:
        // the answer will carry the tracks already attached.
        relayTo(participantId, { renegotiate: true });
      }
    };
  }

  function enqueue(entry: PeerEntry, step: () => Promise<void>): void {
    entry.chain = entry.chain.then(step).catch(() => {});
  }

  async function createAndSendOffer(participantId: string, entry: PeerEntry): Promise<void> {
    // One offer in flight at a time: a second offer made before the answer
    // lands would pair that answer with the wrong local description.
    if (entry.pc.signalingState !== "stable") {
      entry.offerPending = true;
      return;
    }
    entry.offerPending = false;
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      relayTo(participantId, { description: { type: "offer", sdp: entry.pc.localDescription?.sdp ?? "" } });
    } catch {
      fail("unknown", `offer creation failed for ${participantId}`, true);
    }
  }

  async function handleSignal(from: string, data: SignalData): Promise<void> {
    const entry = peers.get(from);
    if (!entry) return;
    if ("renegotiate" in data) {
      if (entry.initiator) await createAndSendOffer(from, entry);
      return;
    }
    if ("description" in data) {
      if (data.description.type === "answer" && entry.pc.signalingState !== "have-local-offer") return;
      await entry.pc.setRemoteDescription(data.description);
      for (const candidate of entry.pendingCandidates.splice(0)) {
        await entry.pc.addIceCandidate(candidate).catch(() => {});
      }
      if (data.description.type === "offer") {
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        relayTo(from, { description: { type: "answer", sdp: entry.pc.localDescription?.sdp ?? "" } });
      } else if (entry.offerPending) {
        await createAndSendOffer(from, entry);
      }
    } else {
      if (!entry.pc.remoteDescription) {
        entry.pendingCandidates.push(data.candidate);
        return;
      }
      await entry.pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  /** Tears the mesh down but keeps the transport joinable for a fresh hello. */
  function teardownMesh(): void {
    for (const participantId of [...peers.keys()]) teardownPeer(participantId);
  }

  function closeSocket(): void {
    if (!ws) return;
    ws.onclose = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }

  function scheduleReconnect(): void {
    // H-07 defect: the reconnect path short-circuits to failed instead of
    // retrying, so a network drop never recovers.
    if (defect === "no-reconnect" || leaving || phase === "left") {
      if (!leaving && phase !== "left") {
        fail("network", "signaling connection lost (reconnect disabled by variant)", false);
      }
      return;
    }
    setPhase("reconnecting");
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void joinSocket();
    }, RECONNECT_DELAY_MS);
  }

  function handleDown(raw: string): void {
    let message: SignalingDown;
    try {
      message = JSON.parse(raw) as SignalingDown;
    } catch {
      return;
    }
    if (!events) return;
    switch (message.type) {
      case "welcome": {
        for (const participantId of message.peers) {
          if (!peers.has(participantId)) {
            buildPeer(participantId);
            events.onRemoteJoined({ participantId });
          }
        }
        // The signaling hello alone is NOT "connected" — that shortcut let
        // H-12 pass before any media flowed. The phase flips only when the
        // mesh is ICE-connected with decoded remote frames (the poll).
        startDecodedPoll();
        void pollDecodedFrames();
        break;
      }
      case "peer-joined": {
        buildPeer(message.participantId);
        events.onRemoteJoined({ participantId: message.participantId });
        break;
      }
      case "peer-left": {
        teardownPeer(message.participantId);
        events.onRemoteLeft({ participantId: message.participantId, reason: message.reason });
        break;
      }
      case "signal": {
        const entry = peers.get(message.from);
        if (entry) enqueue(entry, () => handleSignal(message.from, message.data));
        break;
      }
      case "remote-state": {
        const state: RemoteParticipantState = {
          participantId: message.from,
          micOn: message.micOn,
          cameraOn: message.cameraOn,
        };
        events.onRemoteState(state);
        break;
      }
      case "error": {
        // The server's named rejection rides verbatim (H-14).
        const kind = message.code === "auth" ? "auth" : "network";
        fail(kind, message.message, false);
        break;
      }
    }
  }

  async function joinSocket(): Promise<void> {
    if (!ctx || !events) return;
    try {
      // A fresh token per attempt: reconnects after long drops must not
      // re-hello with an expired bearer (TransportContext contract).
      lastToken = await ctx.identityToken();
      const wsUrl = options.signalUrl ?? SIGNALING_URL;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        wsSend({ type: "hello", token: lastToken ?? "", meetingId: ctx?.meetingId ?? "" });
      };
      ws.onmessage = (event) => {
        handleDown(String(event.data));
      };
      ws.onclose = (event) => {
        // Auth closes carry the rejection already surfaced via "error";
        // anything else is a network loss and reconnects.
        if (leaving) return;
        // The mesh must rebuild on a fresh socket: the server already
        // dropped this peer from the room, so answering on the old peer
        // connections would pair an answer with the peer's new PC.
        teardownMesh();
        if (event.code === 4004 || event.code === 4005 || event.code === 4006 || event.code === 4007) return;
        scheduleReconnect();
      };
      ws.onerror = () => {
        if (!leaving && phase === "joining") {
          fail("network", `could not reach the signaling server at ${wsUrl}`, true);
        }
      };
    } catch (err) {
      fail("network", err instanceof Error ? err.message : "signaling connection failed", true);
    }
  }

  return {
    name,

    async connect(context, transportEvents): Promise<void> {
      ctx = context;
      events = transportEvents;
      leaving = false;
      setPhase("joining");
      startDecodedPoll();
      await joinSocket();
    },

    publishLocalStream(stream: MediaStream | null): void {
      localStream = stream;
      // Sync every existing peer connection: PCs built before capture existed
      // get their tracks added here; device switches (H-05) replace tracks.
      if (!stream) return;
      for (const [, entry] of peers) {
        const kinds = defect === "no-audio" ? ["video"] : ["audio", "video"];
        for (const kind of kinds) {
          const track = stream.getTracks().find((t) => t.kind === kind);
          if (!track) continue;
          const sender = entry.pc.getSenders().find((s) => s.track?.kind === kind);
          if (sender) void sender.replaceTrack(track);
          else entry.pc.addTrack(track, stream);
        }
      }
    },

    publishLocalState(state: LocalCallState): void {
      localState = state;
      wsSend({ type: "state", micOn: state.micOn, cameraOn: state.cameraOn });
    },

    async leave(): Promise<void> {
      stopDecodedPoll();
      if (defect === "never-close") {
        // H-11 defect: close is a no-op — the signaling socket and every
        // wrapped peer connection stay open after leaving.
        leaving = true;
        setPhase("left");
        return;
      }
      leaving = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      // Mark the departure client-initiated before closing: the server's
      // close handler records it as "left" (the mock relay's session-event
      // vocabulary) instead of "disconnected" — H-11's evidence.
      wsSend({ type: "bye" });
      teardownMesh();
      closeSocket();
      setPhase("left");
    },
  };
}
