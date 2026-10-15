import { z } from "zod";

export type VideoQualityTier = "full" | "balanced" | "low";
export type NetworkQuality = "unknown" | "good" | "fair" | "poor";

export interface NetworkSample {
  packetLossRatio: number | null;
  roundTripTimeMs: number | null;
}

export interface QualityPolicyState {
  tier: VideoQualityTier;
  badSamples: number;
  healthySamples: number;
}

export function initialQualityPolicy(): QualityPolicyState {
  return { tier: "full", badSamples: 0, healthySamples: 0 };
}

// These are conservative product defaults, not measured Connvo thresholds.
// Two bad intervals react sooner than recovery's five healthy intervals so an
// unstable link does not repeatedly switch resolution.
export function classifyNetwork(sample: NetworkSample): NetworkQuality {
  const { packetLossRatio: loss, roundTripTimeMs: rtt } = sample;
  if (loss === null && rtt === null) return "unknown";
  if ((loss !== null && loss >= 0.12) || (rtt !== null && rtt >= 700))
    return "poor";
  if ((loss !== null && loss >= 0.05) || (rtt !== null && rtt >= 350))
    return "fair";
  return "good";
}

export function advanceQualityPolicy(
  state: QualityPolicyState,
  sample: NetworkSample,
): QualityPolicyState {
  const quality = classifyNetwork(sample);
  const target = quality === "poor" ? "low" : "balanced";
  const worse =
    quality === "poor"
      ? state.tier !== "low"
      : quality === "fair" && state.tier === "full";
  const healthy =
    quality === "good" &&
    (sample.packetLossRatio === null || sample.packetLossRatio < 0.02) &&
    (sample.roundTripTimeMs === null || sample.roundTripTimeMs < 250);
  const badSamples = worse ? state.badSamples + 1 : 0;
  const healthySamples = healthy ? state.healthySamples + 1 : 0;
  if (badSamples >= 2)
    return { tier: target, badSamples: 0, healthySamples: 0 };
  if (healthySamples >= 5 && state.tier !== "full") {
    return {
      tier: state.tier === "low" ? "balanced" : "full",
      badSamples: 0,
      healthySamples: 0,
    };
  }
  return {
    tier: state.tier,
    badSamples,
    healthySamples: Math.min(healthySamples, 5),
  };
}

const statsEntry = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.number().finite(),
  packetsReceived: z.number().finite().nonnegative().optional(),
  packetsLost: z.number().finite().optional(),
  packetsSent: z.number().finite().nonnegative().optional(),
  localId: z.string().optional(),
  roundTripTime: z.number().finite().nonnegative().optional(),
  currentRoundTripTime: z.number().finite().nonnegative().optional(),
  totalRoundTripTime: z.number().finite().nonnegative().optional(),
  roundTripTimeMeasurements: z.number().finite().nonnegative().optional(),
  selectedCandidatePairId: z.string().optional(),
});
type StatsEntry = z.infer<typeof statsEntry>;

export interface NetworkStatsWindow {
  readonly entries: ReadonlyMap<string, StatsEntry>;
}

export function sampleNetworkStats(
  report: Pick<RTCStatsReport, "forEach">,
  previous: NetworkStatsWindow = { entries: new Map() },
): { sample: NetworkSample; window: NetworkStatsWindow } {
  const entries = new Map<string, StatsEntry>();
  report.forEach((raw: unknown) => {
    const result = statsEntry.safeParse(raw);
    if (result.success) entries.set(result.data.id, result.data);
  });
  const remoteLosses: number[] = [];
  const inboundLosses: number[] = [];
  const rtts: number[] = [];
  for (const entry of entries.values()) {
    const old = previous.entries.get(entry.id);
    if (!old || entry.type !== old.type || entry.timestamp <= old.timestamp)
      continue;
    if (entry.type !== "inbound-rtp" && entry.type !== "remote-inbound-rtp")
      continue;
    if (entry.packetsLost !== undefined && old.packetsLost !== undefined) {
      let expected: number | undefined;
      const lost = entry.packetsLost - old.packetsLost;
      if (
        entry.packetsReceived !== undefined &&
        old.packetsReceived !== undefined
      ) {
        const received = entry.packetsReceived - old.packetsReceived;
        if (received >= 0) expected = received + Math.max(0, lost);
      } else if (entry.type === "remote-inbound-rtp" && entry.localId) {
        const sent = entries.get(entry.localId)?.packetsSent;
        const oldSent = previous.entries.get(entry.localId)?.packetsSent;
        if (sent !== undefined && oldSent !== undefined)
          expected = sent - oldSent;
      }
      // A decreasing loss counter can mean late recovered packets. It cannot
      // establish a healthy interval, just as an SSRC reset cannot.
      if (lost >= 0 && expected !== undefined && expected > 0) {
        const losses =
          entry.type === "remote-inbound-rtp" ? remoteLosses : inboundLosses;
        losses.push(Math.min(1, lost / expected));
      }
    }
    if (entry.type === "remote-inbound-rtp") {
      const count = entry.roundTripTimeMeasurements;
      const oldCount = old.roundTripTimeMeasurements;
      if (count !== undefined && oldCount !== undefined) {
        const total = entry.totalRoundTripTime;
        const oldTotal = old.totalRoundTripTime;
        if (
          count > oldCount &&
          total !== undefined &&
          oldTotal !== undefined &&
          total >= oldTotal
        ) {
          rtts.push((1000 * (total - oldTotal)) / (count - oldCount));
        }
      } else if (entry.roundTripTime !== undefined) {
        rtts.push(entry.roundTripTime * 1000);
      }
    }
  }
  // Only the transport-selected pair is authoritative; nominated pairs may be
  // obsolete after ICE switches routes.
  if (rtts.length === 0) {
    for (const transport of entries.values()) {
      if (transport.type !== "transport" || !transport.selectedCandidatePairId)
        continue;
      const pair = entries.get(transport.selectedCandidatePairId);
      const old = pair && previous.entries.get(pair.id);
      if (
        pair &&
        old &&
        pair.timestamp > old.timestamp &&
        pair.currentRoundTripTime !== undefined
      ) {
        rtts.push(pair.currentRoundTripTime * 1000);
      }
    }
  }
  const losses = remoteLosses.length ? remoteLosses : inboundLosses;
  return {
    sample: {
      packetLossRatio: losses.length ? Math.max(...losses) : null,
      roundTripTimeMs: rtts.length ? Math.max(...rtts) : null,
    },
    window: { entries },
  };
}

export interface NetworkQualitySnapshot {
  readonly quality: NetworkQuality;
  readonly tier: VideoQualityTier;
  readonly sample: NetworkSample;
  readonly adaptation: "idle" | "applied" | "unsupported" | "failed";
  readonly error: { stage: "stats" | "sender"; message: string } | null;
}

export interface NetworkQualitySender {
  readonly track: Pick<MediaStreamTrack, "kind"> | null;
  getParameters(): RTCRtpSendParameters;
  setParameters(parameters: RTCRtpSendParameters): Promise<void>;
}

export interface NetworkQualityPeer {
  readonly connectionState: RTCPeerConnectionState;
  getStats(): Promise<Pick<RTCStatsReport, "forEach">>;
  getSenders(): NetworkQualitySender[];
}

function emptySnapshot(): NetworkQualitySnapshot {
  return {
    quality: "unknown",
    tier: "full",
    sample: { packetLossRatio: null, roundTripTimeMs: null },
    adaptation: "idle",
    error: null,
  };
}

const browserError = z.object({ name: z.string(), message: z.string() });

function errorMessage(error: unknown): string {
  const parsed = browserError.safeParse(error);
  return parsed.success ? parsed.data.message : String(error);
}

const limits: Record<
  Exclude<VideoQualityTier, "full">,
  { maxBitrate: number; scaleResolutionDownBy: number }
> = {
  // Unmeasured starting budgets: preserve speech bandwidth before video detail.
  balanced: { maxBitrate: 700_000, scaleResolutionDownBy: 1.5 },
  low: { maxBitrate: 250_000, scaleResolutionDownBy: 2 },
};

/**
 * The connection owner must call attach(pc) for each actual RTCPeerConnection,
 * and dispose() when it closes. Use one controller per peer, receiving peers
 * through createP2PTransport's onPeerConnection callback.
 * subscribe/getSnapshot can be passed directly to useSyncExternalStore.
 */
export class NetworkQualityMonitor {
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private peer: NetworkQualityPeer | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private polling: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs = 2_000) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
      throw new RangeError("Network sample interval must be positive");
  }

  readonly getSnapshot = (): NetworkQualitySnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) throw new Error("NetworkQualityMonitor is disposed");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  attach(peer: NetworkQualityPeer): void {
    if (this.disposed) throw new Error("NetworkQualityMonitor is disposed");
    if (this.peer === peer) return;
    this.detach();
    this.peer = peer;
    const generation = this.generation;
    let window: NetworkStatsWindow = { entries: new Map() };
    let policy = initialQualityPolicy();
    const baselines = new Map<
      NetworkQualitySender,
      RTCRtpEncodingParameters[]
    >();
    const unsupported = new Set<NetworkQualitySender>();
    const active = () =>
      this.generation === generation &&
      this.peer === peer &&
      peer.connectionState !== "closed" &&
      !this.disposed;
    const enqueuePoll = () => {
      // getStats cannot be aborted. A reattachment waits for the old request
      // to settle rather than starting another request on the same connection.
      this.polling = this.polling.then(poll, poll);
    };
    const poll = async (): Promise<void> => {
      if (!active() || peer.connectionState === "closed") return;
      let next = this.snapshot;
      try {
        const report = await peer.getStats();
        if (!active()) return;
        const sampled = sampleNetworkStats(report, window);
        window = sampled.window;
        policy = advanceQualityPolicy(policy, sampled.sample);
        next = {
          quality: classifyNetwork(sampled.sample),
          tier: policy.tier,
          sample: sampled.sample,
          adaptation: "idle",
          error: null,
        };
        for (const sender of peer.getSenders()) {
          if (!active()) return;
          if (sender.track?.kind !== "video") continue;
          if (unsupported.has(sender)) {
            next = { ...next, adaptation: "unsupported" };
            continue;
          }
          try {
            const parameters = sender.getParameters();
            if (!parameters.encodings?.length) continue;
            let baseline = baselines.get(sender);
            if (
              !baseline ||
              baseline.length !== parameters.encodings.length ||
              baseline.some(
                (encoding, index) =>
                  encoding.rid !== parameters.encodings[index]?.rid,
              )
            ) {
              baseline = parameters.encodings.map((encoding) => ({
                ...encoding,
              }));
              baselines.set(sender, baseline);
            }
            let changed = false;
            parameters.encodings = parameters.encodings.map(
              (encoding, index) => {
                const original = baseline[index];
                const budget =
                  policy.tier === "full" ? null : limits[policy.tier];
                const maxBitrate = budget
                  ? Math.min(original.maxBitrate ?? Infinity, budget.maxBitrate)
                  : original.maxBitrate;
                const scaleResolutionDownBy = budget
                  ? Math.max(
                      original.scaleResolutionDownBy ?? 1,
                      budget.scaleResolutionDownBy,
                    )
                  : original.scaleResolutionDownBy;
                changed ||=
                  encoding.maxBitrate !== maxBitrate ||
                  encoding.scaleResolutionDownBy !== scaleResolutionDownBy;
                const adjusted = { ...encoding };
                if (maxBitrate === undefined) delete adjusted.maxBitrate;
                else adjusted.maxBitrate = maxBitrate;
                if (scaleResolutionDownBy === undefined)
                  delete adjusted.scaleResolutionDownBy;
                else adjusted.scaleResolutionDownBy = scaleResolutionDownBy;
                return adjusted;
              },
            );
            if (changed) await sender.setParameters(parameters);
            if (!active()) return;
            if (next.adaptation === "idle")
              next = { ...next, adaptation: "applied" };
          } catch (error) {
            if (!active()) return;
            const parsed = browserError.safeParse(error);
            const unavailable =
              parsed.success && parsed.data.name === "NotSupportedError";
            if (unavailable) unsupported.add(sender);
            next = {
              ...next,
              adaptation: unavailable ? "unsupported" : "failed",
              error: { stage: "sender", message: errorMessage(error) },
            };
          }
        }
      } catch (error) {
        if (!active()) return;
        window = { entries: new Map() };
        policy = { ...policy, badSamples: 0, healthySamples: 0 };
        next = {
          ...this.snapshot,
          quality: "unknown",
          sample: { packetLossRatio: null, roundTripTimeMs: null },
          error: { stage: "stats", message: errorMessage(error) },
        };
      }
      if (!active()) return;
      this.publish(next);
      if (active()) this.timer = setTimeout(enqueuePoll, this.intervalMs);
    };
    enqueuePoll();
  }

  detach(): void {
    this.generation += 1;
    this.peer = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.publish(emptySnapshot());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.peer = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private publish(snapshot: NetworkQualitySnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
