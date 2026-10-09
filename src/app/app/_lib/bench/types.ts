/**
 * Shared types for the `src/app/app` benchmark harness.
 *
 * Protocol: see `src/app/app/_lib/README.md`.
 *
 * A "hot path" benchmark compares two implementations of the same logic:
 *  - `before`: a FROZEN copy of the original inline code, copied verbatim
 *    from the page before it was optimized.
 *  - `after`: the optimized/extracted helper that the page now uses.
 *
 * Both are measured interleaved on the same machine, and the median over
 * repeated samples is reported, together with the machine load average.
 */
export interface BenchMeasurement {
  /** Name of the suite that recorded the measurement. */
  suite: string;
  /** Human-readable hot-path name; stable across runs (used in the PR table). */
  name: string;
  /** Median milliseconds per call for the original (pre-change) implementation. */
  beforeMsPerCall: number;
  /** Median milliseconds per call for the optimized implementation. */
  afterMsPerCall: number;
  /** Number of timed samples per implementation (the median is taken over these). */
  samples: number;
  /** Number of calls to `before`/`after` inside each timed sample. */
  iterationsPerSample: number;
  /** Optional context, e.g. the input size used. */
  note?: string;
}

export interface Suite {
  /** Stable suite name, matches the part id (e.g. "01-dashboard-view"). */
  name: string;
  run: () => void | Promise<void>;
}
