/**
 * Scenario orchestration: one RunContext per transport, a fresh meeting per
 * scenario-seed, results collection, and the summary writer. Scenario
 * implementations are imported lazily so this module can be exercised
 * (e.g. --list) before they exist.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RunContext } from "./context.mjs";
import { loadContracts } from "./contracts.mjs";

const CONTRACTS = loadContracts();

const RUNNER_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(RUNNER_DIR, "..", "out");

export const H_IDS = Array.from({ length: 16 }, (_, i) => `H-${String(i + 1).padStart(2, "0")}`);
export const P_IDS = Array.from({ length: 5 }, (_, i) => `P-0${i + 1}`);
export const ALL_SCENARIOS = [...H_IDS, ...P_IDS];

const H_15_METHOD = {
  method:
    "Local coturn TURN with all media forced relay-only through a per-participant user-space UDP shaper (seeded Node dgram proxy adding loss/delay)",
  rejected: [
    "Chromium network emulation / CDP Network interception — does not touch WebRTC UDP",
    "tc/netem on a loopback interface — needs root; used only as a fallback if the shaper proved insufficient",
    "netns via unshare — root again; same rejection",
  ],
  details: "See tools/call-eval/NOTES-h15-loss-method.md for the proof numbers and interactions.",
};

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx]);
}

async function ensureFixtures(ctx, log) {
  const missing = ["A", "B", "C"].filter((p) => !ctx.fixturesExist(p));
  if (!missing.length) return;
  const script = path.resolve(RUNNER_DIR, "..", "scripts", "generate-fixtures.mjs");
  if (fs.existsSync(script)) {
    log(`fixtures missing for ${missing.join(", ")} — regenerating via generate-fixtures.mjs`);
    execSync(`node ${JSON.stringify(script)}`, { stdio: "inherit" });
  }
  const still = ["A", "B", "C"].filter((p) => !ctx.fixturesExist(p));
  if (still.length) {
    throw new Error(
      `fixtures missing (${still.join(", ")}) and no generator script at ${script} — run the fixtures branch generator first (pnpm call-eval:fixtures)`,
    );
  }
}

async function runOne(ctx, scenarioId, seed, log) {
  const t0 = Date.now();
  try {
    const mod =
      scenarioId.startsWith("H")
        ? await import("./scenarios-h.mjs")
        : await import("./scenarios-p.mjs");
    const fn = mod[`scenario_${scenarioId.replace("-", "_")}`];
    if (typeof fn !== "function") {
      throw new Error(`scenario ${scenarioId} is not implemented in ${scenarioId.startsWith("H") ? "scenarios-h.mjs" : "scenarios-p.mjs"}`);
    }
    ctx.newMeeting(scenarioId);
    const measurements = await fn(ctx, { seed, log });
    const conds = scenarioId.startsWith("H") ? CONTRACTS.H_PASS_CONDITIONS : CONTRACTS.P_PASS_CONDITIONS;
    const passCondition = (conds instanceof Map ? conds.get(scenarioId) : conds?.[scenarioId]) ?? null;
    return { scenario: scenarioId, transport: ctx.transport, seed, pass: true, passCondition, measurements, failure: null, ms: Date.now() - t0 };
  } catch (err) {
    log(`${scenarioId} seed ${seed} FAILED: ${err?.message}`);
    const conds = scenarioId.startsWith("H") ? CONTRACTS.H_PASS_CONDITIONS : CONTRACTS.P_PASS_CONDITIONS;
    const passCondition = (conds instanceof Map ? conds.get(scenarioId) : conds?.[scenarioId]) ?? null;
    return {
      scenario: scenarioId,
      transport: ctx.transport,
      seed,
      pass: false,
      passCondition,
      measurements: null,
      failure: { message: err?.message ?? String(err), stack: err?.stack?.split("\n").slice(0, 4).join("\n") },
      ms: Date.now() - t0,
    };
  }
}

export async function runScenarios({ transports = ["mock"], scenarios = ["H-01"], seeds = [1], baseUrl = null, log = console.log } = {}) {
  const results = [];
  const wallStart = Date.now();
  for (const transport of transports) {
    const ctx = new RunContext({ transport, baseUrl, log });
    await ctx.start();
    try {
      if (scenarios.some((s) => s.startsWith("H"))) await ensureFixtures(ctx, log);
      for (const scenarioId of scenarios) {
        for (const seed of seeds) {
          log(`▶ ${scenarioId} seed ${seed} on ${transport}`);
          results.push(await runOne(ctx, scenarioId, seed, log));
        }
      }
    } finally {
      await ctx.stop();
    }
  }
  const wallMs = Date.now() - wallStart;
  const written = await writeOutputs(results, wallMs);
  return { results, wallMs, ...written };
}

async function environmentInfo() {
  let chromium = "unknown";
  try {
    chromium = (await import("@playwright/test")).chromium.name();
  } catch { /* best-effort */ }
  let coturnVersion = "unknown";
  try {
    coturnVersion = execSync("turnserver --version 2>&1 | head -1").toString().trim();
  } catch { /* best-effort */ }
  return {
    node: process.version,
    chromium,
    coturn: coturnVersion,
    platform: `${process.platform} ${process.arch}`,
  };
}

export async function writeOutputs(results, wallMs, { outDir = OUT_DIR } = {}) {
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  const resultsPath = path.join(outDir, "results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  const byScenario = new Map();
  for (const r of results) {
    const entry = byScenario.get(r.scenario) ?? { pass: 0, total: 0, failures: [] };
    entry.total++;
    if (r.pass) entry.pass++;
    else entry.failures.push(`seed ${r.seed}: ${r.failure?.message ?? "failed"}`);
    byScenario.set(r.scenario, entry);
  }

  const ttf = results
    .filter((r) => r.measurements?.timeToFirstRemoteFrameMs != null)
    .map((r) => r.measurements.timeToFirstRemoteFrameMs);
  const recovery10 = results
    .filter((r) => r.scenario === "H-07" && r.measurements?.recovery10sMs != null)
    .map((r) => r.measurements.recovery10sMs);

  const env = await environmentInfo();
  const lines = [
    "# Call eval summary",
    "",
    `Whole-run wall time: ${(wallMs / 1000).toFixed(1)} s`,
    "",
    "| Scenario | Pass | Total |",
    "|---|---|---|",
  ];
  for (const [scenario, entry] of byScenario) {
    lines.push(`| ${scenario} | ${entry.pass} | ${entry.total} |`);
  }
  lines.push(
    "",
    `p95 time-to-first-remote-frame: ${percentile(ttf, 95) ?? "n/a"} ms (n=${ttf.length})`,
    `p95 H-07 10 s-drop recovery: ${percentile(recovery10, 95) ?? "n/a"} ms (n=${recovery10.length})`,
    "",
    "## H-15 loss/delay method",
    "",
    `Chosen: ${H_15_METHOD.method}`,
    ...H_15_METHOD.rejected.map((r) => `- Rejected: ${r}`),
    H_15_METHOD.details,
    "",
    "## Environment",
    "",
    ...Object.entries(env).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "Failures:" + (results.some((r) => !r.pass) ? "" : " none"),
    ...(results.some((r) => !r.pass)
      ? results.filter((r) => !r.pass).map((r) => `- ${r.scenario} seed ${r.seed} (${r.transport}): ${r.failure?.message}`)
      : []),
  );
  const summaryPath = path.join(outDir, "summary.md");
  fs.writeFileSync(summaryPath, lines.join("\n") + "\n");
  return { resultsPath, summaryPath };
}
