import { loadavg, cpus } from "node:os";
import type { BenchMeasurement, Suite } from "./types";

/**
 * Global sink so V8 cannot dead-code-eliminate measured calls.
 * Results of measured functions are pushed here and truncated periodically.
 */
const sink: unknown[] = [];
export function keepAlive(value: unknown): void {
  sink.push(value);
  if (sink.length > 1 << 16) sink.length = 0;
}

/** Median of an array of numbers (does not mutate the input). */
export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timeSample(fn: () => unknown, iterations: number): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) keepAlive(fn());
  const end = process.hrtime.bigint();
  // Milliseconds per single call.
  return Number(end - start) / 1e6 / iterations;
}

export interface BenchPairOptions {
  suite: string;
  name: string;
  /** FROZEN original implementation (copied verbatim from the page). */
  before: () => unknown;
  /** Optimized implementation (the helper the page now uses). */
  after: () => unknown;
  /** Calls per timed sample. Default 1000. */
  iterations?: number;
  /** Timed samples per implementation; medians are reported. Default 9. */
  samples?: number;
  /** Optional note, e.g. input size ("n=10000"). */
  note?: string;
}

/** All measurements recorded so far, across suites. */
const results: BenchMeasurement[] = [];

export function record(measurement: BenchMeasurement): void {
  results.push(measurement);
}

export function getResults(): BenchMeasurement[] {
  return results.slice();
}

/**
 * Measure a before/after pair interleaved (sample-by-sample) so machine
 * drift hits both sides equally, then record the medians.
 */
export function benchPair(options: BenchPairOptions): BenchMeasurement {
  const {
    suite,
    name,
    before,
    after,
    iterations = 1_000,
    samples = 9,
    note,
  } = options;

  // Untimed warmup for both sides.
  timeSample(before, Math.min(iterations, 100));
  timeSample(after, Math.min(iterations, 100));

  const beforeSamples: number[] = [];
  const afterSamples: number[] = [];
  for (let s = 0; s < samples; s++) {
    beforeSamples.push(timeSample(before, iterations));
    afterSamples.push(timeSample(after, iterations));
  }

  const measurement: BenchMeasurement = {
    suite,
    name,
    beforeMsPerCall: median(beforeSamples),
    afterMsPerCall: median(afterSamples),
    samples,
    iterationsPerSample: iterations,
    note,
  };
  record(measurement);
  return measurement;
}

export function machineInfo(): string {
  const [l1, l5, l15] = loadavg();
  const cpu = cpus()[0];
  return (
    `node ${process.version} | cpus ${cpus().length} ` +
    `(${cpu?.model ?? "unknown"}) | loadavg 1m/5m/15m ` +
    `${l1.toFixed(2)}/${l5.toFixed(2)}/${l15.toFixed(2)}`
  );
}

export function loadavgSnapshot(): string {
  const [l1, l5, l15] = loadavg();
  return `${l1.toFixed(2)}/${l5.toFixed(2)}/${l15.toFixed(2)}`;
}

/** Format milliseconds as a compact human string (µs below 1 ms). */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "n/a";
  if (ms >= 1) return `${ms.toFixed(3)} ms`;
  return `${(ms * 1000).toFixed(3)} µs`;
}

export type { BenchMeasurement, Suite };
