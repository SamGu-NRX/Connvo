import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IceAccessError, sessionIceConfiguration } from "../../ice-config";
import type {
  CallTransport,
  TransportContext,
  TransportEvents,
} from "../../transport";
import { createP2PTransport } from "./p2p-transport";
import type { SignalingAdapter, SignalingHandlers } from "./signaling";

class FakeStream {
  getTracks() {
    return [];
  }
}

class FakePeer {
  static instances: FakePeer[] = [];
  connectionState = "new";
  iceConnectionState = "new";
  signalingState = "stable";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: { toJSON(): RTCSessionDescriptionInit } | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  offerConfigurations: RTCConfiguration[] = [];
  restartConfigurations: RTCConfiguration[] = [];
  stats = new Map<string, Record<string, unknown>>();
  transceivers: Array<{
    sender: { track: MediaStreamTrack | null };
    mid: string | null;
    stopped: boolean;
  }> = [];
  constructor(public config: RTCConfiguration) {
    FakePeer.instances.push(this);
  }
  getConfiguration() {
    return this.config;
  }
  addTransceiver() {
    const slot = { sender: { track: null }, mid: null, stopped: false };
    this.transceivers.push(slot);
    return slot;
  }
  getTransceivers() {
    return this.transceivers;
  }
  setConfiguration(config: RTCConfiguration) {
    this.config = config;
  }
  restartIce() {
    this.restartConfigurations.push(this.config);
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    this.signalingState =
      description.type === "offer" ? "have-remote-offer" : "stable";
  }
  async setLocalDescription() {
    this.offerConfigurations.push(this.config);
    const type = this.remoteDescription?.type === "offer" ? "answer" : "offer";
    if (type === "offer")
      this.transceivers.forEach((slot, index) => {
        slot.mid = String(index);
      });
    this.localDescription = { toJSON: () => ({ type, sdp: "test-sdp" }) };
    this.signalingState = type === "answer" ? "stable" : "have-local-offer";
  }
  async addIceCandidate() {}
  async getStats() {
    return this.stats;
  }
  close() {
    this.connectionState = "closed";
  }
  connected() {
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
  }
  failedIce() {
    this.iceConnectionState = "failed";
    this.oniceconnectionstatechange?.();
  }
}

const firstConfig: RTCConfiguration = {
  iceServers: [
    { urls: "turn:relay.test", username: "first", credential: "one" },
  ],
};
const freshConfig: RTCConfiguration = {
  iceServers: [
    { urls: "turn:relay.test", username: "fresh", credential: "two" },
  ],
};
const active: CallTransport[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(
  getRtcConfig: () => Promise<RTCConfiguration>,
  selfId = "B",
  onConnectionPath = vi.fn(),
) {
  let handlers!: SignalingHandlers;
  const close = vi.fn();
  const send = vi.fn();
  const open = vi.fn<SignalingAdapter["open"]>((_session, next) => {
    handlers = next;
    return { close, send, publishState: vi.fn() };
  });
  const events: TransportEvents = {
    onPhase: vi.fn(),
    onError: vi.fn(),
    onRemoteJoined: vi.fn(),
    onRemoteLeft: vi.fn(),
    onRemoteStream: vi.fn(),
    onRemoteState: vi.fn(),
  };
  const context: TransportContext = {
    meetingId: "meeting-1",
    selfId,
    identityToken: async () => "identity",
    getLocalStream: () => null,
  };
  const transport = createP2PTransport({
    signaling: { open },
    getRtcConfig,
    onConnectionPath,
  });
  active.push(transport);
  return {
    transport,
    context,
    events,
    open,
    close,
    send,
    get handlers() {
      return handlers;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  FakePeer.instances = [];
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("MediaStream", FakeStream);
});
afterEach(async () => {
  await Promise.all(active.splice(0).map((transport) => transport.leave()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("P2P ICE configuration and recovery", () => {
  it("waits for credentials before opening signaling and constructing a peer", async () => {
    const pending = deferred<RTCConfiguration>();
    const test = setup(() => pending.promise);
    const joining = test.transport.connect(test.context, test.events);
    expect(test.events.onPhase).toHaveBeenLastCalledWith("joining");
    expect(test.open).not.toHaveBeenCalled();
    expect(FakePeer.instances).toHaveLength(0);
    pending.resolve(firstConfig);
    await joining;
    expect(test.open.mock.calls[0][0].meetingId).toBe("meeting-1");
    test.handlers.onWelcome(["A"]);
    expect(FakePeer.instances[0].config).toEqual(firstConfig);
  });

  it("reports credential refusal as a retryable failure and allows a fresh attempt", async () => {
    const load = vi
      .fn<() => Promise<RTCConfiguration>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(firstConfig);
    const test = setup(load);
    await test.transport.connect(test.context, test.events);
    expect(test.events.onError).toHaveBeenCalledWith({
      kind: "network",
      message: "The call connection service is unavailable. Try again.",
      retryable: true,
    });
    expect(test.events.onPhase).toHaveBeenLastCalledWith("failed");
    expect(test.open).not.toHaveBeenCalled();
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["A"]);
    expect(FakePeer.instances[0].config).toEqual(firstConfig);
  });

  it("does not reopen signaling when credentials resolve after leaving", async () => {
    const pending = deferred<RTCConfiguration>();
    const test = setup(() => pending.promise);
    const joining = test.transport.connect(test.context, test.events);
    await test.transport.leave();
    pending.resolve(firstConfig);
    await joining;
    expect(test.events.onPhase).toHaveBeenLastCalledWith("left");
    expect(test.open).not.toHaveBeenCalled();
    // A subsequent intentional join still opens with the resolved credentials.
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["A"]);
    expect(FakePeer.instances[0].config).toEqual(firstConfig);
  });

  it("refreshes expired session credentials before the impolite peer restarts ICE", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        iceServers: firstConfig.iceServers!,
        expiresAt: 160_000,
      })
      .mockResolvedValueOnce({
        iceServers: freshConfig.iceServers!,
        expiresAt: 220_000,
      });
    const test = setup(sessionIceConfiguration(load));
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["A"]);
    const peer = FakePeer.instances[0];
    peer.connected();
    await vi.advanceTimersByTimeAsync(31_000);
    peer.failedIce();
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.restartConfigurations).toEqual([freshConfig]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refreshes the polite peer's configuration before answering a remote restart offer", async () => {
    const test = setup(
      vi
        .fn()
        .mockResolvedValueOnce(firstConfig)
        .mockResolvedValueOnce(freshConfig),
      "A",
    );
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["B"]);
    test.handlers.onSignal("B", {
      description: { type: "offer", sdp: "restart-offer" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakePeer.instances[0].config).toEqual(freshConfig);
    expect(test.send).toHaveBeenCalledWith("B", {
      description: { type: "answer", sdp: "test-sdp" },
    });
  });

  it("restarts an unreachable newcomer and then reports failure even when signaling is connected", async () => {
    const test = setup(async () => firstConfig);
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome([]);
    expect(test.events.onPhase).toHaveBeenLastCalledWith("connected");
    test.handlers.onPeerJoined("A");
    const peer = FakePeer.instances[0];
    await vi.advanceTimersByTimeAsync(6_000);
    expect(peer.restartConfigurations).toEqual([firstConfig]);
    await vi.advanceTimersByTimeAsync(24_000);
    expect(test.events.onError).toHaveBeenCalledWith({
      kind: "network",
      message:
        "Can't reach the other person. A network may be blocking calls. Try again or switch networks.",
      retryable: true,
    });
    expect(test.events.onPhase).toHaveBeenLastCalledWith("failed");
    expect(peer.connectionState).toBe("closed");
  });

  it("reports a relay path from the connected peer's selected candidate pair", async () => {
    const onPath = vi.fn();
    const test = setup(async () => firstConfig, "B", onPath);
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["A"]);
    const peer = FakePeer.instances[0];
    peer.stats = new Map([
      ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
      [
        "pair",
        {
          type: "candidate-pair",
          localCandidateId: "local",
          remoteCandidateId: "remote",
        },
      ],
      [
        "local",
        {
          type: "local-candidate",
          candidateType: "relay",
          address: "private-address",
        },
      ],
      ["remote", { type: "remote-candidate", candidateType: "host" }],
    ]);
    peer.connected();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.events.onPhase).toHaveBeenLastCalledWith("connected");
    expect(onPath.mock.calls).toEqual([["unknown"], ["relay"]]);
  });

  it("refreshes before offering to a newcomer after the session credentials expire", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        iceServers: firstConfig.iceServers!,
        expiresAt: 160_000,
      })
      .mockResolvedValueOnce({
        iceServers: freshConfig.iceServers!,
        expiresAt: 220_000,
      });
    const test = setup(sessionIceConfiguration(load));
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome([]);
    await vi.advanceTimersByTimeAsync(61_000);
    test.handlers.onPeerJoined("A");
    const peer = FakePeer.instances[0];
    peer.onnegotiationneeded?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.offerConfigurations).toEqual([freshConfig]);
    expect(test.send).toHaveBeenCalledWith("A", {
      description: { type: "offer", sdp: "test-sdp" },
    });
  });

  it("keeps an established group connection when a newcomer cannot connect", async () => {
    const test = setup(async () => firstConfig, "C");
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["A"]);
    const established = FakePeer.instances[0];
    established.connected();
    test.handlers.onPeerJoined("B");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(established.connectionState).toBe("connected");
    expect(FakePeer.instances[1].restartConfigurations).toHaveLength(5);
    expect(test.events.onPhase).toHaveBeenLastCalledWith("connected");
    expect(test.events.onError).not.toHaveBeenCalled();
  });

  it("reports an incoming-offer credential refusal as non-retryable auth failure", async () => {
    const test = setup(
      vi
        .fn()
        .mockResolvedValueOnce(firstConfig)
        .mockRejectedValueOnce(new IceAccessError("Meeting access revoked")),
      "A",
    );
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["B"]);
    test.handlers.onSignal("B", {
      description: { type: "offer", sdp: "restart-offer" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.events.onError).toHaveBeenCalledWith({
      kind: "auth",
      message: "Meeting access revoked",
      retryable: false,
    });
    expect(test.events.onPhase).toHaveBeenLastCalledWith("failed");
    expect(FakePeer.instances[0].connectionState).toBe("closed");
  });

  it("does not offer when credential refresh finishes after leaving", async () => {
    const pending = deferred<RTCConfiguration>();
    const test = setup(
      vi
        .fn()
        .mockResolvedValueOnce(firstConfig)
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(freshConfig),
    );
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["A"]);
    const peer = FakePeer.instances[0];
    peer.onnegotiationneeded?.();
    await test.transport.leave();
    pending.resolve(freshConfig);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.offerConfigurations).toEqual([]);
    expect(test.events.onPhase).toHaveBeenLastCalledWith("left");
    await test.transport.connect(test.context, test.events);
    test.handlers.onWelcome(["A"]);
    FakePeer.instances[1].onnegotiationneeded?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).toHaveBeenCalledWith("A", {
      description: { type: "offer", sdp: "test-sdp" },
    });
  });
});
