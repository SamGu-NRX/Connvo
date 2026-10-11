/**
 * In-page media helpers: everything a scenario asserts about media receipts is
 * decoded here from the DOM (remote <video> pixels, audio track samples) plus
 * the probe — never from app internals. Decoder functions come from the
 * pinned import-free module lib/decoders.mjs, serialized as a whole bundle
 * (stringifying one function would drop module-level helpers like
 * validateImageData); each page caches the initialized bundle once.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContracts } from "./contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let bundle = null;

/** The pinned decoder module as one bundle string (import-free by contract). */
export function decoderBundle() {
  if (!bundle) bundle = fs.readFileSync(path.join(ROOT, "tools/call-eval/lib/decoders.mjs"), "utf8");
  return bundle;
}

function initDecodersInNode(bundleSrc) {
  const fn = new Function(bundleSrc + "\nreturn { decodeBarcodeColor, decodeFrameCounter, computeFps, decodeToneHz };");
  return fn();
}

/** Node-side tolerant color classification (y4m round-trip shifts ~±13/ch). */
export function matchPeerColor(rgb) {
  const { PEER_COLORS, SECOND_CAMERA_COLOR, COLOR_TOLERANCE } = loadContracts();
  const candidates = [
    ["A", PEER_COLORS.A],
    ["B", PEER_COLORS.B],
    ["C", PEER_COLORS.C],
    ["second-camera", SECOND_CAMERA_COLOR],
  ];
  let best = null;
  for (const [label, ref] of candidates) {
    const d = Math.max(Math.abs(rgb.r - ref[0]), Math.abs(rgb.g - ref[1]), Math.abs(rgb.b - ref[2]));
    if (!best || d < best.distance) best = { label, distance: d };
  }
  return { ...best, ok: best.distance <= COLOR_TOLERANCE };
}

/** Sample the pinned counter band; classification stays Node-side. */
export async function decodeRemoteFrame(peer, participantId) {
  const bundleSrc = await decoderBundle();
  return peer.page.evaluate(
    async ({ participantId, bundleSrc }) => {
      if (!window.__connvoDecoders) {
        window.__connvoDecoders = new Function(
          bundleSrc + "\nreturn { decodeBarcodeColor, decodeFrameCounter, computeFps, decodeToneHz };",
        )();
      }
      const { decodeBarcodeColor, decodeFrameCounter } = window.__connvoDecoders;
      const tile = document.querySelector(
        `[data-testid="remote-media"][data-participant-id="${participantId}"]`,
      );
      const video = tile?.querySelector("video");
      if (!video || !video.videoWidth) return { present: false };
      const w = video.videoWidth;
      const h = video.videoHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      // Color region: everything above the barcode band (band pinned at
      // y=200..239 of the 320x240 fixture).
      const colorRegion = ctx.getImageData(0, 0, w, Math.min(200, h));
      const band = ctx.getImageData(0, 200, w, Math.min(40, h - 200));
      return {
        present: true,
        color: decodeBarcodeColor(colorRegion),
        counter: decodeFrameCounter(band),
        videoWidth: w,
        videoHeight: h,
      };
    },
    { participantId, bundleSrc },
  );
}

/** Remote audio tone via the remote MediaStream audio track (an AnalyserNode tap). */
export async function sampleRemoteTone(peer, participantId, durationMs = 700) {
  const bundleSrc = await decoderBundle();
  return peer.page.evaluate(
    async ({ participantId, durationMs, bundleSrc }) => {
      if (!window.__connvoDecoders) {
        window.__connvoDecoders = new Function(
          bundleSrc + "\nreturn { decodeBarcodeColor, decodeFrameCounter, computeFps, decodeToneHz };",
        )();
      }
      const { decodeToneHz } = window.__connvoDecoders;

      const tile = document.querySelector(
        `[data-testid="remote-media"][data-participant-id="${participantId}"]`,
      );
      const stream = tile?.querySelector("video")?.srcObject;
      if (!stream) return null;
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== "live") return null;

      window.__harnessAnalysers = window.__harnessAnalysers || new Map();
      let hook = window.__harnessAnalysers.get(participantId);
      if (!hook || hook.trackId !== audioTrack.id) {
        if (hook) {
          try {
            hook.actx.close();
          } catch {
            /* already closed */
          }
        }
        const ACtx = window.AudioContext || window.webkitAudioContext;
        const actx = new ACtx();
        await actx.resume();
        const analyser = actx.createAnalyser();
        analyser.fftSize = 4096;
        actx.createMediaStreamSource(new MediaStream([audioTrack])).connect(analyser);
        hook = { actx, analyser, buf: new Float32Array(analyser.fftSize), trackId: audioTrack.id };
        window.__harnessAnalysers.set(participantId, hook);
      }
      const { actx, analyser, buf } = hook;
      const chunks = [];
      const deadline = actx.currentTime + durationMs / 1000;
      while (actx.currentTime < deadline) {
        analyser.getFloatTimeDomainData(buf);
        chunks.push(Float32Array.from(buf));
        await new Promise((r) => setTimeout(r, 20));
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      return decodeToneHz(merged, actx.sampleRate);
    },
    { participantId, durationMs, bundleSrc },
  );
}

/**
 * Remote video fps from consecutive counter reads. computeFps interprets
 * counters modulo 4096; a lost/late decode's backward transition reads as a
 * near-full-cycle advance (an H-15 run reported ~1345 fps this way), so
 * implausible results fall back to the median of plausible per-step rates.
 */
export async function measureFps(peer, participantId, ms = 5000, { stepMs = 250 } = {}) {
  const samples = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const frame = await decodeRemoteFrame(peer, participantId);
    if (frame.present && frame.counter?.ok) {
      samples.push({ t: Date.now(), counter: frame.counter.counter });
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (samples.length < 3) return { fps: 0, samples: samples.length, implausible: true };
  const { computeFps } = initDecodersInNode(await decoderBundle());
  const plausible = (v) => Number.isFinite(v) && v > 0 && v <= 60;
  let computed = computeFps(samples);
  let implausible = !plausible(computed);
  if (implausible) {
    computed = robustFps(samples);
    implausible = !plausible(computed);
  }
  return { fps: Number(computed.toFixed(1)), samples: samples.length, implausible };
}

/** Median of plausible per-step rates (mod-4096 wrap aware). */
export function robustFps(samples) {
  const rates = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    let dc = samples[i].counter - samples[i - 1].counter;
    if (dc < -2048) dc += 4096; // wrap
    if (dc < 0 || (dt > 0.05 && dc / dt > 60)) continue; // implausible step
    if (dt > 0.05) rates.push(dc / dt);
  }
  if (!rates.length) return 0;
  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
}

/**
 * Full stats sweep for one participant: calls getStats on each matching
 * receiver through the wrapped pc and aggregates inbound-rtp + the best
 * candidate-pair RTT. Returns null-shaped zeros when nothing flows yet.
 */
export async function readRtpStats(peer, kind = "video", participantId = null) {
  return peer.page.evaluate(
    async ({ kindName, participantId }) => {
      const pcs = window.__wrappedPcs || [];
      const tile = participantId
        ? document.querySelector(`[data-testid="remote-media"][data-participant-id="${participantId}"]`)
        : null;
      const tileStream = tile?.querySelector("video")?.srcObject ?? null;
      const tileTrackIds = tileStream ? new Set([...tileStream.getTracks()].map((t) => t.id)) : null;

      const out = { packetsReceived: 0, packetsLost: 0, bytesReceived: 0, rttMs: null, reports: 0 };
      for (const pc of pcs) {
        let receivers;
        try {
          receivers = pc.getReceivers();
        } catch {
          continue;
        }
        for (const receiver of receivers) {
          const track = receiver.track;
          if (!track || track.kind !== kindName) continue;
          if (tileTrackIds && !tileTrackIds.has(track.id)) continue;
          const stats = await pc.getStats(); // wrapped: increments getStatsCalls
          stats.forEach((s) => {
            if (s.type === "inbound-rtp" && s.kind === kindName) {
              out.packetsReceived += s.packetsReceived ?? 0;
              out.packetsLost += s.packetsLost ?? 0;
              out.bytesReceived += s.bytesReceived ?? 0;
              out.reports++;
            }
            if (s.type === "candidate-pair" && s.state === "succeeded" && s.currentRoundTripTime != null) {
              const rtt = Math.round(s.currentRoundTripTime * 1000);
              if (out.rttMs === null || rtt < out.rttMs) out.rttMs = rtt;
            }
          });
        }
      }
      return out;
    },
    { kindName: kind, participantId },
  );
}

/**
 * Samples readRtpStats across a window (single reads can return null RTT
 * between consent checks); returns start/end packet counts and the mean of
 * non-null RTT readings. Used by H-15's getStats proof and H-07 recovery.
 */
export async function collectRtpStatsWindow(peer, kind, ms, { stepMs = 500, participantId = null } = {}) {
  const start = await readRtpStats(peer, kind, participantId);
  const t0 = Date.now();
  const rtts = [];
  let end = start;
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, stepMs));
    end = await readRtpStats(peer, kind, participantId);
    if (end.rttMs != null) rtts.push(end.rttMs);
  }
  return {
    packetsLostStart: start.packetsLost,
    packetsLostEnd: end.packetsLost,
    deltaLost: end.packetsLost - start.packetsLost,
    packetsReceived: end.packetsReceived - start.packetsReceived,
    bytesReceived: end.bytesReceived - start.bytesReceived,
    rttMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : end.rttMs,
    rttSamples: rtts,
    reports: end.reports,
  };
}

/** Probe snapshot (connection/track lifecycle + getStatsCalls). */
export async function probeState(peer) {
  return peer.page.evaluate(() => JSON.parse(JSON.stringify(window.__callProbe)));
}
