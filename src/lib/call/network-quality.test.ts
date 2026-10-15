import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceQualityPolicy,
  classifyNetwork,
  initialQualityPolicy,
  NetworkQualityMonitor,
  sampleNetworkStats,
  type NetworkQualityPeer,
  type NetworkQualitySender,
  type NetworkSample,
  type QualityPolicyState,
} from "./network-quality";

function advance(
  state: QualityPolicyState,
  sample: NetworkSample,
  count: number,
) {
  for (let i = 0; i < count; i++) state = advanceQualityPolicy(state, sample);
  return state;
}
function report(...entries: object[]): Pick<RTCStatsReport, "forEach"> {
  return new Map(entries.map((entry, index) => [String(index), entry]));
}
function inbound(
  timestamp: number,
  packetsReceived: number,
  packetsLost: number,
  id = "in",
) {
  return { id, type: "inbound-rtp", timestamp, packetsReceived, packetsLost };
}
function remote(
  timestamp: number,
  packetsReceived: number,
  packetsLost: number,
  roundTripTime = 0.1,
) {
  return {
    id: "remote",
    type: "remote-inbound-rtp",
    timestamp,
    packetsReceived,
    packetsLost,
    roundTripTime,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class FakeSender implements NetworkQualitySender {
  track = { kind: "video" };
  parameters: RTCRtpSendParameters = {
    transactionId: "transaction-1",
    codecs: [],
    headerExtensions: [],
    rtcp: { cname: "peer" },
    encodings: [
      {
        rid: "main",
        active: true,
        maxFramerate: 24,
        priority: "high",
        maxBitrate: 1_500_000,
        scaleResolutionDownBy: 1,
      },
    ],
  };
  updates: RTCRtpSendParameters[] = [];
  reject: Error | null = null;
  pending: ReturnType<typeof deferred<void>> | null = null;
  getParameters() {
    return structuredClone(this.parameters);
  }
  async setParameters(parameters: RTCRtpSendParameters) {
    if (parameters.transactionId !== this.parameters.transactionId)
      throw new Error("Stale sender transaction");
    if (parameters.encodings.length !== this.parameters.encodings.length)
      throw new Error("Encoding count changed");
    if (this.reject) throw this.reject;
    this.updates.push(structuredClone(parameters));
    if (this.pending) await this.pending.promise;
    this.parameters = structuredClone(parameters);
  }
}
class FakePeer implements NetworkQualityPeer {
  connectionState: RTCPeerConnectionState = "connected";
  calls = 0;
  stats: Pick<RTCStatsReport, "forEach"> = report();
  reject: Error | null = null;
  pending: ReturnType<typeof deferred<Pick<RTCStatsReport, "forEach">>> | null =
    null;
  senders: FakeSender[] = [new FakeSender()];
  async getStats() {
    this.calls++;
    if (this.reject) throw this.reject;
    return this.pending ? this.pending.promise : this.stats;
  }
  getSenders() {
    return this.senders;
  }
}
const monitors: NetworkQualityMonitor[] = [];
function monitor() {
  vi.useFakeTimers();
  const value = new NetworkQualityMonitor(100);
  monitors.push(value);
  return value;
}
async function tick(
  peer: FakePeer,
  timestamp: number,
  received: number,
  lost: number,
  rtt = 0.1,
) {
  peer.stats = report(remote(timestamp, received, lost, rtt));
  await vi.advanceTimersByTimeAsync(100);
}
afterEach(() => {
  monitors.splice(0).forEach((monitor) => monitor.dispose());
  vi.useRealTimers();
});

describe("adaptive quality policy", () => {
  it("classifies exact boundaries and leaves absent metrics unknown", () => {
    expect([
      classifyNetwork({ packetLossRatio: null, roundTripTimeMs: null }),
      classifyNetwork({ packetLossRatio: 0.049, roundTripTimeMs: 349 }),
      classifyNetwork({ packetLossRatio: 0.05, roundTripTimeMs: null }),
      classifyNetwork({ packetLossRatio: null, roundTripTimeMs: 350 }),
      classifyNetwork({ packetLossRatio: 0.12, roundTripTimeMs: null }),
      classifyNetwork({ packetLossRatio: null, roundTripTimeMs: 700 }),
    ]).toEqual(["unknown", "good", "fair", "fair", "poor", "poor"]);
  });
  it("requires consecutive bad intervals, and recovers one level per five healthy intervals", () => {
    const poor = { packetLossRatio: 0.2, roundTripTimeMs: 800 };
    const good = { packetLossRatio: 0.01, roundTripTimeMs: 100 };
    const once = advance(initialQualityPolicy(), poor, 1);
    expect(once).toEqual({ tier: "full", badSamples: 1, healthySamples: 0 });
    const low = advance(once, poor, 1);
    expect(low).toEqual({ tier: "low", badSamples: 0, healthySamples: 0 });
    expect(advance(low, good, 4).tier).toBe("low");
    const balanced = advance(low, good, 5);
    expect(balanced).toEqual({
      tier: "balanced",
      badSamples: 0,
      healthySamples: 0,
    });
    expect(advance(balanced, good, 5).tier).toBe("full");
    expect(advance(advance(once, good, 1), poor, 1).tier).toBe("full");
  });
  it("holds a reduced tier through missing, marginal and mixed metrics", () => {
    const low: QualityPolicyState = {
      tier: "low",
      badSamples: 0,
      healthySamples: 4,
    };
    for (const sample of [
      { packetLossRatio: null, roundTripTimeMs: null },
      { packetLossRatio: 0.02, roundTripTimeMs: 100 },
      { packetLossRatio: 0, roundTripTimeMs: 250 },
      { packetLossRatio: 0, roundTripTimeMs: 800 },
    ])
      expect(advanceQualityPolicy(low, sample)).toEqual({
        tier: "low",
        badSamples: 0,
        healthySamples: 0,
      });
    expect(
      advance(
        initialQualityPolicy(),
        { packetLossRatio: 0.06, roundTripTimeMs: 100 },
        2,
      ).tier,
    ).toBe("balanced");
  });
});

describe("stats intervals", () => {
  it("uses deltas instead of lifetime loss and prefers remote reports", () => {
    const first = sampleNetworkStats(
      report(remote(100, 1_000, 200), inbound(100, 1_000, 0)),
    );
    expect(first.sample).toEqual({
      packetLossRatio: null,
      roundTripTimeMs: null,
    });
    const second = sampleNetworkStats(
      report(remote(200, 1_095, 205), inbound(200, 1_050, 50)),
      first.window,
    );
    expect(second.sample).toEqual({
      packetLossRatio: 0.05,
      roundTripTimeMs: 100,
    });
  });
  it("uses the matched outbound packet delta when remote packetsReceived is unavailable", () => {
    const entries = (timestamp: number, sent: number, lost: number) =>
      report(
        { id: "out", type: "outbound-rtp", timestamp, packetsSent: sent },
        {
          id: "remote",
          type: "remote-inbound-rtp",
          timestamp,
          localId: "out",
          packetsLost: lost,
        },
      );
    const first = sampleNetworkStats(entries(100, 100, 10));
    expect(
      sampleNetworkStats(entries(200, 200, 20), first.window).sample
        .packetLossRatio,
    ).toBe(0.1);
  });
  it("discards cached, malformed, reset and disappearing stream counters", () => {
    const first = sampleNetworkStats(report(inbound(100, 100, 20)));
    expect(
      sampleNetworkStats(report(inbound(100, 200, 50)), first.window).sample
        .packetLossRatio,
    ).toBeNull();
    const reset = sampleNetworkStats(report(inbound(200, 10, 0)), first.window);
    expect(reset.sample.packetLossRatio).toBeNull();
    expect(
      sampleNetworkStats(report(inbound(300, 100, 10)), reset.window).sample
        .packetLossRatio,
    ).toBe(0.1);
    const empty = sampleNetworkStats(
      report({
        id: "bad",
        type: "inbound-rtp",
        timestamp: 200,
        packetsReceived: NaN,
      }),
      first.window,
    );
    expect(
      sampleNetworkStats(report(inbound(300, 300, 100)), empty.window).sample
        .packetLossRatio,
    ).toBeNull();
  });
  it("treats recovered lost packets and idle intervals as unknown", () => {
    const first = sampleNetworkStats(report(inbound(100, 100, 20)));
    expect(
      sampleNetworkStats(report(inbound(200, 100, 20)), first.window).sample
        .packetLossRatio,
    ).toBeNull();
    expect(
      sampleNetworkStats(report(inbound(200, 120, 19)), first.window).sample
        .packetLossRatio,
    ).toBeNull();
  });
  it("calculates RTT from measurement deltas and ignores repeated reports", () => {
    const entries = (timestamp: number, count: number, total: number) =>
      report({
        id: "r",
        type: "remote-inbound-rtp",
        timestamp,
        roundTripTimeMeasurements: count,
        totalRoundTripTime: total,
        roundTripTime: 4,
      });
    const first = sampleNetworkStats(entries(100, 10, 10));
    const next = sampleNetworkStats(entries(200, 12, 11), first.window);
    expect(next.sample.roundTripTimeMs).toBe(500);
    expect(
      sampleNetworkStats(entries(300, 12, 11), next.window).sample
        .roundTripTimeMs,
    ).toBeNull();
  });
  it("uses only the transport-selected candidate pair for fallback RTT", () => {
    const entries = (timestamp: number) =>
      report(
        {
          id: "t",
          type: "transport",
          timestamp,
          selectedCandidatePairId: "chosen",
        },
        {
          id: "chosen",
          type: "candidate-pair",
          timestamp,
          currentRoundTripTime: 0.05,
        },
        {
          id: "stale",
          type: "candidate-pair",
          timestamp,
          nominated: true,
          currentRoundTripTime: 4,
        },
      );
    const first = sampleNetworkStats(entries(100));
    expect(
      sampleNetworkStats(entries(200), first.window).sample.roundTripTimeMs,
    ).toBe(50);
  });
});

describe("connection monitoring", () => {
  it("reduces video parameters, preserves encoding fields, and restores the starting budget", async () => {
    const value = monitor();
    const peer = new FakePeer();
    const sender = peer.senders[0];
    peer.stats = report(remote(100, 100, 0));
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 200, 180, 20);
    await tick(peer, 300, 260, 40);
    expect(value.getSnapshot()).toMatchObject({
      quality: "poor",
      tier: "low",
      adaptation: "applied",
      error: null,
    });
    expect(sender.parameters.encodings).toEqual([
      {
        rid: "main",
        active: true,
        maxFramerate: 24,
        priority: "high",
        maxBitrate: 250_000,
        scaleResolutionDownBy: 2,
      },
    ]);
    expect(sender.parameters.rtcp).toEqual({ cname: "peer" });
    for (let i = 1; i <= 10; i++)
      await tick(peer, 300 + i * 100, 260 + i * 100, 40);
    expect(value.getSnapshot().tier).toBe("full");
    expect(sender.parameters.encodings[0].maxBitrate).toBe(1_500_000);
    expect(sender.parameters.encodings[0].scaleResolutionDownBy).toBe(1);
    expect(sender.updates).toHaveLength(3);
  });
  it("preserves lower existing budgets, omitted fields, inactive encodings and audio senders", async () => {
    const value = monitor();
    const peer = new FakePeer();
    const sender = peer.senders[0];
    sender.parameters.encodings = [
      {
        rid: "small",
        active: false,
        maxBitrate: 100_000,
        scaleResolutionDownBy: 4,
      },
      { rid: "large" },
    ];
    const audio = new FakeSender();
    audio.track = { kind: "audio" };
    peer.senders.push(audio);
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    await tick(peer, 200, 180, 20);
    await tick(peer, 300, 260, 40);
    expect(sender.parameters.encodings).toEqual([
      {
        rid: "small",
        active: false,
        maxBitrate: 100_000,
        scaleResolutionDownBy: 4,
      },
      { rid: "large", maxBitrate: 250_000, scaleResolutionDownBy: 2 },
    ]);
    for (let i = 1; i <= 10; i++)
      await tick(peer, 300 + i * 100, 260 + i * 100, 40);
    expect(sender.parameters.encodings).toEqual([
      {
        rid: "small",
        active: false,
        maxBitrate: 100_000,
        scaleResolutionDownBy: 4,
      },
      { rid: "large" },
    ]);
    expect(audio.updates).toEqual([]);
  });
  it("handles unsupported sender parameters without stopping samples", async () => {
    const value = monitor();
    const peer = new FakePeer();
    peer.senders[0].reject = new DOMException(
      "No parameter support",
      "NotSupportedError",
    );
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    await tick(peer, 200, 180, 20);
    await tick(peer, 300, 260, 40);
    expect(value.getSnapshot()).toMatchObject({
      tier: "low",
      adaptation: "unsupported",
      error: { stage: "sender", message: "No parameter support" },
    });
    await tick(peer, 400, 340, 60);
    expect(value.getSnapshot()).toMatchObject({
      tier: "low",
      adaptation: "unsupported",
      quality: "poor",
    });
  });
  it("retries transient sender errors and applies a current tier to late video senders", async () => {
    const value = monitor();
    const peer = new FakePeer();
    peer.senders[0].reject = new Error("temporarily unavailable");
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    await tick(peer, 200, 180, 20);
    await tick(peer, 300, 260, 40);
    expect(value.getSnapshot()).toMatchObject({
      adaptation: "failed",
      error: { stage: "sender", message: "temporarily unavailable" },
    });
    peer.senders[0].reject = null;
    peer.senders.push(new FakeSender());
    await tick(peer, 400, 340, 60);
    expect(value.getSnapshot()).toMatchObject({
      adaptation: "applied",
      error: null,
    });
    expect(
      peer.senders.map((sender) => sender.parameters.encodings[0].maxBitrate),
    ).toEqual([250_000, 250_000]);
  });
  it("keeps polling serialized while stats or sender writes are pending", async () => {
    const value = monitor();
    const peer = new FakePeer();
    peer.pending = deferred();
    value.attach(peer);
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(peer.calls).toBe(1);
    peer.pending.resolve(report(remote(100, 100, 0)));
    peer.pending = null;
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 200, 180, 20);
    peer.senders[0].pending = deferred();
    await tick(peer, 300, 260, 40);
    const calls = peer.calls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(peer.calls).toBe(calls);
    expect(peer.senders[0].updates[0].encodings[0].maxBitrate).toBe(250_000);
    peer.senders[0].pending.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(peer.calls).toBe(calls + 1);
  });
  it("suppresses stale samples on detach and resets counters for a new peer", async () => {
    const value = monitor();
    const peer = new FakePeer();
    peer.pending = deferred();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    const observed: string[] = [];
    const unsubscribe = value.subscribe(() =>
      observed.push(value.getSnapshot().quality),
    );
    value.detach();
    peer.pending.resolve(report(remote(100, 100, 50, 1)));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(observed).toEqual(["unknown"]);
    expect(peer.calls).toBe(1);
    const next = new FakePeer();
    next.stats = report(remote(200, 200, 50, 1));
    value.attach(next);
    await vi.advanceTimersByTimeAsync(0);
    expect(value.getSnapshot()).toMatchObject({
      quality: "unknown",
      tier: "full",
    });
    await tick(next, 300, 300, 50);
    expect(value.getSnapshot().quality).toBe("good");
    unsubscribe();
  });
  it("disposal suppresses an in-flight write completion and refuses reattachment", async () => {
    const value = monitor();
    const peer = new FakePeer();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    await tick(peer, 200, 180, 20);
    peer.senders[0].pending = deferred();
    await tick(peer, 300, 260, 40);
    const observed: string[] = [];
    value.subscribe(() => observed.push(value.getSnapshot().quality));
    value.dispose();
    value.dispose();
    peer.senders[0].pending.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(value.getSnapshot().quality).toBe("poor");
    expect(observed).toEqual([]);
    expect(peer.calls).toBe(4);
    expect(() => value.attach(peer)).toThrow(
      "NetworkQualityMonitor is disposed",
    );
  });
  it("reports stats errors, resets interval history, and continues polling", async () => {
    const value = monitor();
    const peer = new FakePeer();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    peer.reject = new Error("stats unavailable");
    await vi.advanceTimersByTimeAsync(100);
    expect(value.getSnapshot()).toMatchObject({
      quality: "unknown",
      error: { stage: "stats", message: "stats unavailable" },
    });
    peer.reject = null;
    await tick(peer, 300, 200, 50);
    expect(value.getSnapshot()).toMatchObject({
      quality: "unknown",
      tier: "full",
      error: null,
    });
    await tick(peer, 400, 300, 50);
    expect(value.getSnapshot().quality).toBe("good");
  });
  it("serializes detach and reattach while an old stats request is unresolved", async () => {
    const value = monitor();
    const peer = new FakePeer();
    peer.pending = deferred();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    value.detach();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.calls).toBe(1);
    const old = peer.pending;
    peer.pending = null;
    peer.stats = report(remote(200, 200, 0));
    old.resolve(report(remote(100, 100, 50, 1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.calls).toBe(2);
    expect(value.getSnapshot()).toMatchObject({
      quality: "unknown",
      tier: "full",
    });
    await tick(peer, 300, 300, 0);
    expect(value.getSnapshot().quality).toBe("good");
  });

  it("stops requests when the connection closes", async () => {
    const value = monitor();
    const peer = new FakePeer();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    await tick(peer, 200, 200, 0);
    expect(value.getSnapshot().quality).toBe("good");
    peer.connectionState = "closed";
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.calls).toBe(3);
  });

  it("does not write sender parameters or publish after a connection closes during stats", async () => {
    const value = monitor();
    const peer = new FakePeer();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    await tick(peer, 200, 180, 20);
    peer.pending = deferred();
    await vi.advanceTimersByTimeAsync(100);
    const observed = vi.fn();
    value.subscribe(observed);
    peer.connectionState = "closed";
    peer.pending.resolve(report(remote(300, 260, 40)));
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.senders[0].updates).toEqual([]);
    expect(observed).not.toHaveBeenCalled();
    expect(peer.calls).toBe(4);
  });

  it("does not publish or schedule another poll when closed during a sender write", async () => {
    const value = monitor();
    const peer = new FakePeer();
    value.attach(peer);
    await vi.advanceTimersByTimeAsync(0);
    await tick(peer, 100, 100, 0);
    await tick(peer, 200, 180, 20);
    peer.senders[0].pending = deferred();
    await tick(peer, 300, 260, 40);
    const observed = vi.fn();
    value.subscribe(observed);
    peer.connectionState = "closed";
    peer.senders[0].pending.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(observed).not.toHaveBeenCalled();
    expect(peer.calls).toBe(4);
  });
});
