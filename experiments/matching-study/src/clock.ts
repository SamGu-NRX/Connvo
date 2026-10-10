/**
 * Logical clock for the study.
 *
 * The engine reads Date.now() in every handler. The runner installs a patched
 * Date.now backed by a mutable logical time so scenarios can advance hours in
 * microseconds and produce deterministic, replayable measurements. Wall time
 * is taken from performance.now() (never patched).
 *
 * Under the vitest bridge the clock control is provided by vi fake timers
 * (toFake: ["Date"], leaving `performance` real) instead of patching; the
 * scenario code only depends on the ClockControl interface.
 */

export interface ClockControl {
  /** Current logical time in epoch ms. */
  now(): number;
  /** Advance logical time. */
  advance(ms: number): void;
}

/**
 * Clock control for plain-node runs (tsx). Patches global Date.now for the
 * process; restore() puts the original back.
 */
export function installPatchedClock(startMs: number): ClockControl & { restore(): void } {
  const state = { current: startMs };
  const originalNow = Date.now.bind(Date);
  const patched = () => state.current;
  // eslint-disable-next-line no-restricted-globals
  (Date as { now: () => number }).now = patched;
  return {
    now: () => state.current,
    advance(ms: number) {
      state.current += ms;
    },
    restore() {
      // eslint-disable-next-line no-restricted-globals
      (Date as { now: () => number }).now = originalNow;
    },
  };
}
