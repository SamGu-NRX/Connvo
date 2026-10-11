/**
 * measureFps sampling tests (reviewed bug: 250 ms sampling saturates
 * observed-advance fps near 4).
 *
 * computeFps counts one advance per sample step, so the sampling step caps
 * the measurable rate at 1000/stepMs fps. The old default (250 ms) topped
 * out near 4 fps and failed H-01's >= 15 fps bar on a perfectly healthy
 * 30 fps stream. The fix samples every 20 ms, which tracks real frame rates
 * up to 50 fps. The fake peer synthesizes a 30 fps stream by deriving the
 * frame counter from wall-clock time, so no browser is involved.
 */
import { describe, expect, it } from "vitest";
import { measureFps } from "./page-helpers.mjs";

/** Fake peer whose remote tile decodes to a synthetic stream at `fps`. */
function fakePeerAt(fps) {
  const t0 = Date.now();
  let evalCalls = 0;
  return {
    peerId: "A",
    __evalCalls: () => evalCalls,
    page: {
      evaluate: async () => {
        evalCalls++;
        return {
          present: true,
          counter: { ok: true, counter: Math.floor(((Date.now() - t0) * fps) / 1000) % 4096 },
        };
      },
    },
  };
}

describe("measureFps default sampling", () => {
  it("measures a healthy 30 fps stream above the H-01 bar with the default step", { timeout: 15000 }, async () => {
    const peer = fakePeerAt(30);
    const result = await measureFps(peer, "B", 2000);
    // Old code: ~4 fps (250 ms step saturates observed advances) — fails here.
    expect(result.fps).toBeGreaterThanOrEqual(15);
    expect(result.implausible).toBe(false);
  });

  it("samples densely enough to resolve per-frame advances", { timeout: 15000 }, async () => {
    const peer = fakePeerAt(30);
    await measureFps(peer, "B", 2000);
    // Old code: 2000/250 = 8 samples for the window — fails here. The new
    // 20 ms step yields ~100 nominal; the floor absorbs timer stretch on a
    // loaded box.
    expect(peer.__evalCalls()).toBeGreaterThanOrEqual(12);
  });

  it("reports a frozen stream as 0 fps, not a sampling artifact", { timeout: 15000 }, async () => {
    const peer = fakePeerAt(0); // counter never advances
    const result = await measureFps(peer, "B", 1500);
    expect(result.fps).toBe(0);
  });
});
