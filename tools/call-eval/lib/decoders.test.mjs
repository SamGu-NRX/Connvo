// Unit tests for the pinned decoder API (CONTRACT.md "Decoder API"), on known
// inputs. Video frames are built by the encoder twin (fixture-media.mjs) and
// pushed through the same RGB->I420->RGB conversion the fixtures go through,
// so the suite also fails loudly if encoder and decoder geometry drift apart.
import { describe, it, expect } from "vitest";

import {
  decodeBarcodeColor,
  decodeFrameCounter,
  computeFps,
  decodeToneHz,
} from "./decoders.mjs";
import {
  WIDTH,
  HEIGHT,
  SAMPLE_RATE,
  TONE_AMPLITUDE,
  PEER_COLORS,
  PEER_TONES_HZ,
  counterForFrame,
  buildFrameRgb,
  frameToI420,
  i420ToImageDataLike,
  buildWavPcm,
  parseWavPcm,
  WHITE,
} from "./fixture-media.mjs";

// Fixture frame at frameNumber, carried through RGB -> I420 -> ImageData-like
// (the same conversion the y4m files undergo when a canvas decodes them).
function frameImage(frameNumber, color = PEER_COLORS.A) {
  return i420ToImageDataLike(frameToI420(buildFrameRgb(frameNumber, color)));
}

function paintRect(image, x0, x1, y0, y1, { r, g, b }) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

describe("decodeFrameCounter", () => {
  it.each([0, 1, 137, 4095])("decodes counter %i", (counter) => {
    expect(decodeFrameCounter(frameImage(counter))).toEqual({ counter, ok: true });
  });

  it("wraps: frameNumber 4096 decodes as counter 0", () => {
    expect(counterForFrame(4096)).toBe(0);
    expect(decodeFrameCounter(frameImage(4096))).toEqual({ counter: 0, ok: true });
  });

  it("decodes the same counter for every peer color", () => {
    for (const color of Object.values(PEER_COLORS)) {
      expect(decodeFrameCounter(frameImage(137, color))).toEqual({ counter: 137, ok: true });
    }
  });

  it("returns ok=false when the left sentinel is missing", () => {
    const image = frameImage(137);
    paintRect(image, 8, 24, 200, 240, WHITE); // sentinel painted white
    expect(decodeFrameCounter(image)).toEqual({ counter: 0, ok: false });
  });

  it("returns ok=false when the right sentinel is missing", () => {
    const image = frameImage(137);
    paintRect(image, 168, 184, 200, 240, WHITE);
    expect(decodeFrameCounter(image)).toEqual({ counter: 0, ok: false });
  });

  it("returns ok=false when the band is missing entirely", () => {
    const image = frameImage(137);
    paintRect(image, 0, WIDTH, 200, 240, PEER_COLORS.A); // no white margins, no sentinels
    expect(decodeFrameCounter(image)).toEqual({ counter: 0, ok: false });
  });
});

describe("decodeBarcodeColor", () => {
  it.each(Object.entries(PEER_COLORS))(
    "decodes %s's identity color through the YUV round-trip",
    (_name, color) => {
      const decoded = decodeBarcodeColor(frameImage(137, color));
      expect(Math.abs(decoded.r - color.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(decoded.g - color.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(decoded.b - color.b)).toBeLessThanOrEqual(1);
    },
  );

  it("ignores sparse noise pixels in the frame region", () => {
    const image = frameImage(137, PEER_COLORS.C);
    for (let i = 0; i < 64; i++) {
      const x = (i * 37) % WIDTH;
      const y = (i * 53) % 200;
      paintRect(image, x, x + 1, y, y + 1, { r: 255, g: 255, b: 255 });
    }
    const decoded = decodeBarcodeColor(image);
    expect(Math.abs(decoded.r - PEER_COLORS.C.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(decoded.g - PEER_COLORS.C.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(decoded.b - PEER_COLORS.C.b)).toBeLessThanOrEqual(1);
  });
});

describe("computeFps", () => {
  const frameMs = 1000 / 30;

  it("measures a steady 30 fps stream", () => {
    const samples = Array.from({ length: 90 }, (_, i) => ({
      t: i * frameMs,
      counter: i,
    }));
    expect(computeFps(samples)).toBeCloseTo(30, 6);
  });

  it("handles the mod-4096 counter wrap", () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({
      t: i * frameMs,
      counter: (4090 + i) % 4096,
    }));
    expect(computeFps(samples)).toBeCloseTo(30, 6);
  });

  it("counts a skipped counter (dropped frame) via its gap, keeping the true rate", () => {
    const samples = [
      { t: 0.0, counter: 0 },
      { t: 33.33, counter: 1 },
      { t: 66.67, counter: 2 },
      { t: 100.0, counter: 3 },
      { t: 166.67, counter: 5 }, // frame 4 never arrived
    ];
    expect(computeFps(samples)).toBeCloseTo(30, 2);
  });

  it("lowers the rate across a real stall gap", () => {
    const samples = Array.from({ length: 31 }, (_, i) => ({
      t: i * frameMs + (i >= 30 ? 500 : 0), // 500 ms stall before sample 30
      counter: i,
    }));
    // 30 advances over 1.5 s.
    expect(computeFps(samples)).toBeCloseTo(20, 2);
  });

  it("duplicate counters (repeated frames) do not inflate the rate", () => {
    const samples = [
      { t: 0, counter: 0 },
      { t: frameMs, counter: 1 },
      { t: 2 * frameMs, counter: 1 }, // repeated frame: no advance
      { t: 3 * frameMs, counter: 2 },
    ];
    // Two counter advances over 100 ms.
    expect(computeFps(samples)).toBeCloseTo(20, 2);
  });

  it("returns 0 for fewer than two samples or a non-advancing window", () => {
    expect(computeFps([])).toBe(0);
    expect(computeFps([{ t: 0, counter: 5 }])).toBe(0);
    expect(computeFps([{ t: 100, counter: 5 }, { t: 90, counter: 6 }])).toBe(0);
  });
});

describe("decodeToneHz", () => {
  const windowS = 0.25;

  function sine(freqHz, { sampleRate = SAMPLE_RATE, amplitude = TONE_AMPLITUDE } = {}) {
    const n = Math.round(sampleRate * windowS);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
    }
    return x;
  }

  it.each([440, 660, 880])("resolves a %i Hz sine within the spec tolerance", (freqHz) => {
    const { peakHz, rms } = decodeToneHz(sine(freqHz), SAMPLE_RATE);
    expect(Math.abs(peakHz - freqHz)).toBeLessThanOrEqual(2); // spec allows +-5
    expect(rms).toBeCloseTo(TONE_AMPLITUDE / Math.SQRT2, 2);
  });

  it("reports peakHz 0 for silence", () => {
    const { peakHz, rms } = decodeToneHz(new Float32Array(SAMPLE_RATE / 2), SAMPLE_RATE);
    expect(peakHz).toBe(0);
    expect(rms).toBe(0);
  });

  it("also accepts plain arrays", () => {
    const { peakHz } = decodeToneHz(Array.from(sine(880)), SAMPLE_RATE);
    expect(Math.abs(peakHz - 880)).toBeLessThanOrEqual(2);
  });

  it("decodes the actual fixture wav content (fades included)", () => {
    const wav = parseWavPcm(buildWavPcm({ freqHz: PEER_TONES_HZ.B }));
    expect(wav.sampleRate).toBe(SAMPLE_RATE);
    expect(wav.channels).toBe(1);
    expect(wav.bitsPerSample).toBe(16);
    const { peakHz, rms } = decodeToneHz(wav.samples, wav.sampleRate);
    expect(Math.abs(peakHz - PEER_TONES_HZ.B)).toBeLessThanOrEqual(2);
    expect(rms).toBeGreaterThan(0.3); // 0.6 amplitude -> ~0.424 rms
  });
});
