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
import { measureFps, toneMatches, toneIsSilent } from "./page-helpers.mjs";
import { decodeToneHz } from "../lib/decoders.mjs";

/** 0.5 s of a pure tone at 48 kHz (decodeToneHz caps its window at 12000 samples). */
/** @param {number} hz @param {number} [sampleRate] @param {number} [seconds] @param {number} [amp] */
function toneBuffer(hz, sampleRate = 48000, seconds = 0.5, amp = 0.6) {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/** Fake peer whose remote tile decodes to a synthetic stream at `fps`.
 * @param {number} fps */
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

describe("tone predicates over real decoders", () => {
  it("matches the sender's tone peak from the decoded object", () => {
    // Known inputs: decodeToneHz on a 440 Hz sine. The reviewed H-02 bug did
    // Math.abs(decode - expected) on the OBJECT — NaN arithmetic — so a
    // healthy tone never matched.
    const decoded = decodeToneHz(toneBuffer(440), 48000);
    expect(decoded.peakHz).toBeGreaterThan(439.5);
    expect(decoded.peakHz).toBeLessThan(440.5);
    expect(decoded.rms).toBeGreaterThan(0.3);
    expect(toneMatches(decoded, 440)).toBe(true);
    expect(toneMatches(decoded, 660)).toBe(false);
    expect(toneMatches(decoded, 660, 5)).toBe(false);
  });

  it("counts digital silence and nothing-heard as muted", () => {
    // Known inputs: an all-zero buffer decodes to { peakHz: 0, rms: 0 }.
    const silence = decodeToneHz(new Float32Array(24000), 48000);
    expect(silence.peakHz).toBe(0);
    expect(toneIsSilent(silence)).toBe(true);
    // The reviewed H-03 bug compared the decode OBJECT to 0 — always truthy —
    // and threw "muted remote still produced a peak" on every healthy call.
    expect(toneMatches(silence, 440)).toBe(false);
    expect(toneIsSilent(null)).toBe(true); // no stream/track: sampleRemoteTone returns null
    expect(toneIsSilent({ peakHz: 87, rms: 0.0005 })).toBe(true); // sub-floor noise bin
    expect(toneIsSilent({ peakHz: 660, rms: 0.4 })).toBe(false); // an actual tone is NOT silent
  });
});
