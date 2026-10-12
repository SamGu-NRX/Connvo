#!/usr/bin/env node
/**
 * H-15 getStats evidence capture (CALL-PLAN.md self-proof; NOTES-h15-loss-method.md):
 * replays shaped loss windows against the reference bench and stores the RAW
 * per-sample RTCStats reports plus the derived loss percentages, so the
 * claim "the shaper's loss method affects real RTP" is backed by committed
 * evidence instead of assertion.
 *
 * Usage (bench dev server already running with the bench flag):
 *   node tools/call-eval/scripts/capture-h15-stats.mjs --base-url=http://localhost:3311 [--seed=3]
 *
 * Windows (same profiles as scenario_H_15's proof blocks):
 *   baseline (0% / 0 ms), 5% loss + 300 ms delay, recovery, 15% loss + 300 ms delay.
 *
 * Output under tools/call-eval/self-proof/h15-getstats/:
 *   raw-<label>.json   sampled raw inbound-rtp + resolved candidate pairs per sample
 *   summary.json       derived packets/loss%/RTT per window
 *   summary.md         human table citing the raw files
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RunContext } from "../runner/context.mjs";
import { joinPair, measureFps } from "../runner/scenario-kit.mjs";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(EVAL_DIR, "self-proof", "h15-getstats");

const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a !== "--").map((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`unrecognized argument "${a}"`);
    return [m[1], m[2] ?? "true"];
  }),
);
const seed = Number(flags.seed ?? 3);
const baseUrl = flags["base-url"];

if (!baseUrl) {
  console.error("capture-h15-stats: pass --base-url=<dev bench with the bench flag on>");
  process.exit(2);
}

/**
 * RAW stats sample for participantId's video tile: full inbound-rtp report
 * objects (JSON-cloned) plus the resolved succeeded candidate pairs. Unlike
 * readRtpStats this deliberately keeps every field — the raw evidence.
 * @param {any} peer @param {string} participantId
 */
async function rawStatsSample(peer, participantId) {
  return peer.page.evaluate(async (pid) => {
    const pcs = window.__wrappedPcs || [];
    const tile = document.querySelector(`[data-testid="remote-media"][data-participant-id="${pid}"]`);
    const tileStream = tile?.querySelector("video")?.srcObject ?? null;
    const tileTrackIds = tileStream ? new Set([...tileStream.getTracks()].map((t) => t.id)) : null;

    const candidates = new Map(); // candidateId -> {candidateType}
    const inbound = [];
    const pairs = [];
    for (let pcIndex = 0; pcIndex < pcs.length; pcIndex++) {
      const pc = pcs[pcIndex];
      let stats;
      try {
        stats = await pc.getStats();
      } catch {
        continue;
      }
      stats.forEach((s) => {
        if (s.type === "local-candidate" || s.type === "remote-candidate") {
          candidates.set(s.id, { candidateType: s.candidateType ?? null, type: s.type });
          return;
        }
        if (s.type === "candidate-pair" && s.state === "succeeded") {
          pairs.push({
            localCandidateId: s.localCandidateId,
            remoteCandidateId: s.remoteCandidateId,
            currentRoundTripTime: s.currentRoundTripTime ?? null,
            nominated: s.nominated ?? null,
          });
          return;
        }
        if (s.type === "inbound-rtp" && s.kind === "video" && (!tileTrackIds || tileTrackIds.has(s.trackId))) {
          inbound.push({ pcIndex, report: JSON.parse(JSON.stringify(s)) });
        }
      });
    }
    const resolvedPairs = pairs.map((p) => ({
      ...p,
      localType: candidates.get(p.localCandidateId)?.candidateType ?? null,
      remoteType: candidates.get(p.remoteCandidateId)?.candidateType ?? null,
    }));
    return { inbound, pairs: resolvedPairs };
  }, participantId);
}

/** Sample rawStatsSample across a window at stepMs; keeps every sample. */
async function captureWindow(peer, participantId, ms, stepMs = 500) {
  const samples = [];
  const t0 = Date.now();
  for (;;) {
    const offset = Date.now() - t0;
    const sample = await rawStatsSample(peer, participantId);
    samples.push({ tMs: offset, ...sample });
    if (Date.now() - t0 >= ms) break;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return samples;
}

/**
 * Derived window summary from first/last raw samples (the aggregation
 * readRtpStats performs, applied to the raw evidence).
 * @param {Array<any>} samples
 */
function deriveWindow(samples) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const sums = (s) => ({
    packetsReceived: s.inbound.reduce((a, r) => a + (r.report.packetsReceived ?? 0), 0),
    packetsLost: s.inbound.reduce((a, r) => a + (r.report.packetsLost ?? 0), 0),
    bytesReceived: s.inbound.reduce((a, r) => a + (r.report.bytesReceived ?? 0), 0),
  });
  const a = sums(first);
  const b = sums(last);
  const deltaReceived = b.packetsReceived - a.packetsReceived;
  const deltaLost = b.packetsLost - a.packetsLost;
  const rtts = samples
    .flatMap((s) => s.pairs.map((p) => (p.currentRoundTripTime != null ? p.currentRoundTripTime * 1000 : null)))
    .filter((v) => v != null);
  const pairTypes = last.pairs.map((p) => `${p.localType}/${p.remoteType}`);
  return {
    windowMs: last.tMs,
    samples: samples.length,
    deltaPacketsReceived: deltaReceived,
    deltaPacketsLost: deltaLost,
    lossPct: deltaReceived + deltaLost > 0 ? +((deltaLost / (deltaReceived + deltaLost)) * 100).toFixed(2) : null,
    bytesReceived: b.bytesReceived - a.bytesReceived,
    rttMeanMs: rtts.length ? Math.round(rtts.reduce((x, y) => x + y, 0) / rtts.length) : null,
    selectedPairTypes: [...new Set(pairTypes)],
  };
}

const ctx = new RunContext({ transport: "reference", baseUrl, log: console.log });
await ctx.start();
const summary = { capturedAt: new Date().toISOString(), transport: "reference", seed, baseUrl, windows: [] };
try {
  ctx.setSeed(seed);
  ctx.enableRelay();
  await ctx.shaperFor("B").ready;
  ctx.newMeeting("H-15-capture");
  const { peerB } = await joinPair(ctx);
  console.log("capture: peers joined and media-connected");

  const windows = [
    { label: "baseline", lossPct: 0, delayMs: 0, windowMs: 5000 },
    { label: "loss-5pct", lossPct: 5, delayMs: 300, windowMs: 6000 },
    { label: "recovery", lossPct: 0, delayMs: 0, windowMs: 4000 },
    { label: "loss-15pct", lossPct: 15, delayMs: 300, windowMs: 6000 },
  ];
  fs.mkdirSync(OUT, { recursive: true });

  for (const w of windows) {
    if (w.lossPct > 0 || w.delayMs > 0) ctx.shaperFor("B").applyProfile({ lossPct: w.lossPct, delayMs: w.delayMs });
    const samples = await captureWindow(peerB, "A", w.windowMs);
    const fps = await measureFps(peerB, "A", 3000);
    const phase = await peerB.page.evaluate(`(() => document.querySelector('[data-call-phase]')?.getAttribute('data-call-phase'))()`);
    ctx.shaperFor("B").applyProfile({ lossPct: 0, delayMs: 0 });

    const derived = { label: w.label, lossPct: w.lossPct, delayMs: w.delayMs, ...deriveWindow(samples), sampledFps: fps.fps, phase, rawFile: `raw-${w.label}.json` };
    fs.writeFileSync(path.join(OUT, `raw-${w.label}.json`), JSON.stringify(samples, null, 2) + "\n");
    summary.windows.push(derived);
    console.log(
      `capture ${w.label}: received=${derived.deltaPacketsReceived} lost=${derived.deltaPacketsLost} lossPct=${derived.lossPct}% rttMean=${derived.rttMeanMs}ms fps=${derived.sampledFps} phase=${derived.phase} pair=${derived.selectedPairTypes.join(",")}`,
    );
  }

  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  const lines = [
    "# H-15 getStats evidence capture",
    "",
    `Replayed on the reference bench (${baseUrl}) with the shaper applied to participant B's path; raw per-sample RTCStats stored beside this file. Transport ${summary.transport}, seed ${summary.seed}, captured ${summary.capturedAt}.`,
    "",
    "| Window | Loss profile | Packets received | Packets lost | Loss % | Mean RTT (ms) | Sampled fps | Phase |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const w of summary.windows) {
    lines.push(`| ${w.label} (raw: \`${w.rawFile}\`) | ${w.lossPct}% / ${w.delayMs} ms | ${w.deltaPacketsReceived} | ${w.deltaPacketsLost} | ${w.lossPct ?? "n/a"} | ${w.rttMeanMs ?? "n/a"} | ${w.sampledFps ?? "n/a"} | ${w.phase} |`);
  }
  lines.push(
    "",
    "The loss percentages rising with the applied profile while the call stays connected is the getStats proof that the shaper's loss method affects real RTP.",
    "",
  );
  fs.writeFileSync(path.join(OUT, "summary.md"), lines.join("\n") + "\n");
  console.log(`capture: evidence written under ${path.relative(process.cwd(), OUT)}`);
} finally {
  await ctx.stop();
}
