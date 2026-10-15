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

/** @typedef {{scenario: string, transport: string, seed: number, pass: boolean, passCondition: string | null, measurements: Record<string, unknown> | null, failure: {message: string, stack?: string} | null, ms: number}} Result */
/** @typedef {(message: string) => void} Logger */
const CONTRACTS = loadContracts();

const RUNNER_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(RUNNER_DIR, "..", "out");

export const H_IDS = Array.from({ length: 18 }, (_, i) => `H-${String(i + 1).padStart(2, "0")}`);
export const P_IDS = Array.from({ length: 5 }, (_, i) => `P-0${i + 1}`);
export const ALL_SCENARIOS = [...H_IDS, ...P_IDS];

/**
 * H-14 needs local authentication. H-17 additionally changes local provider
 * settings, so it runs only when explicitly named, even with Convex signaling.
 */
const UNWIRED_SCENARIOS = new Set(["H-14", "H-17"]);

/**
 * @param {string} [suite]
 * @param {{ signaling?: "reference" | "convex", page?: "bench" | "real" }} [opts] over Convex the
 *   backend is live, so H-14 is wired too
 */
export function wiredScenarioIds(suite = "ALL", { signaling = "reference", page = "bench" } = {}) {
  const ids = suite === "H" ? H_IDS : suite === "P" ? P_IDS : ALL_SCENARIOS;
  // H-18 uses the product lobby to join without a camera. Bench pages have
  // no camera-off lobby, so include it only when driving the real page.
  return ids.filter((id) =>
    (id !== "H-18" || page === "real") &&
    id !== "H-17" && (signaling === "convex" || !UNWIRED_SCENARIOS.has(id)),
  );
}

const H_15_METHOD = {
  method:
    "In-process Node TURN relay (runner/turn-relay.mjs) with all media forced relay-only through one participant's user-space UDP shaper (seeded Node dgram proxy adding loss/delay in both directions)",
  rejected: [
    "Chromium network emulation / CDP Network interception — does not touch WebRTC UDP",
    "tc/netem or dummynet (pfctl) on loopback — needs root",
    "coturn — a system binary the harness cannot assume; replaced by the in-process relay",
    "netns via unshare — root again; same rejection",
  ],
  details: "See tools/call-eval/NOTES-h15-loss-method.md for the proof numbers and interactions.",
};

/** @param {number[]} values @param {number} p */
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx]);
}

/** @param {RunContext} ctx @param {Logger} log */
async function ensureFixtures(ctx, log) {
  const missing = ["A", "B", "C", "D"].filter((p) => !ctx.fixturesExist(p));
  if (!missing.length) return;
  const script = path.resolve(RUNNER_DIR, "..", "scripts", "generate-fixtures.mjs");
  if (fs.existsSync(script)) {
    log(`fixtures missing for ${missing.join(", ")} — regenerating via generate-fixtures.mjs`);
    execSync(`node ${JSON.stringify(script)}`, { stdio: "inherit" });
  }
  const still = ["A", "B", "C", "D"].filter((p) => !ctx.fixturesExist(p));
  if (still.length) {
    throw new Error(
      `fixtures missing (${still.join(", ")}) and no generator script at ${script} — run the fixtures branch generator first (pnpm call-eval:fixtures)`,
    );
  }
}

/** @param {RunContext} ctx @param {string} scenarioId @param {number} seed @param {Logger} log @returns {Promise<Result>} */
async function runOne(ctx, scenarioId, seed, log) {
  try {
    return await runOneInner(ctx, scenarioId, seed, log);
  } finally {
    // Every scenario closes its own browsers; the reviewed bug kept them all
    // open until the sweep ended, dozens of Chromium processes at 5 seeds.
    await ctx.closePeers();
  }
}

/** @param {RunContext} ctx @param {string} scenarioId @param {number} seed @param {Logger} log @returns {Promise<Result>} */
async function runOneInner(ctx, scenarioId, seed, log) {
  const t0 = Date.now();
  ctx.setSeed(seed); // shapers re-derive from THIS run's seed (reviewed bug: the constructor seed served every run)
  try {
    const mod =
      scenarioId.startsWith("H")
        ? await import("./scenarios-h.mjs")
        : await import("./scenarios-p.mjs");
    const fn = /** @type {unknown} */ (mod[/** @type {keyof typeof mod} */ (`scenario_${scenarioId.replace("-", "_")}`)]);
    if (typeof fn !== "function") {
      throw new Error(`scenario ${scenarioId} is not implemented in ${scenarioId.startsWith("H") ? "scenarios-h.mjs" : "scenarios-p.mjs"}`);
    }
    ctx.newMeeting(scenarioId);
    const measurements = await (/** @type {(ctx: RunContext, options: {seed: number, log: Logger}) => Promise<Record<string, unknown>>} */ (fn))(ctx, { seed, log });
    const conds = scenarioId.startsWith("H") ? CONTRACTS.H_PASS_CONDITIONS : CONTRACTS.P_PASS_CONDITIONS;
    const passCondition = conds[scenarioId] ?? null;
    return { scenario: scenarioId, transport: ctx.transport, seed, pass: true, passCondition, measurements, failure: null, ms: Date.now() - t0 };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log(`${scenarioId} seed ${seed} FAILED: ${error.message}`);
    const conds = scenarioId.startsWith("H") ? CONTRACTS.H_PASS_CONDITIONS : CONTRACTS.P_PASS_CONDITIONS;
    const passCondition = conds[scenarioId] ?? null;
    return {
      scenario: scenarioId,
      transport: ctx.transport,
      seed,
      pass: false,
      passCondition,
      measurements: null,
      failure: { message: error.message, stack: error.stack?.split("\n").slice(0, 4).join("\n") },
      ms: Date.now() - t0,
    };
  }
}

/**
 * Run a matrix of scenario x seed cells over the given transports.
 * @param {{ transports?: string[], scenarios?: string[], seeds?: number[], baseUrl?: string | null, page?: "bench" | "real", signaling?: "reference" | "convex", log?: (msg: string) => void, write?: boolean, onResult?: (result: any) => void, skipCell?: ((scenario: string, seed: number, transport: string) => boolean) | null }} [options]
 */
export async function runScenarios({ transports = ["mock"], scenarios = ["H-01"], seeds = [1], baseUrl = null, page = "bench", signaling = "reference", log = console.log, write = true, onResult = /** @type {(result: any) => void} */ (() => {}), skipCell = /** @type {((scenario: string, seed: number, transport: string) => boolean) | null} */ (null) } = {}) {
  const results = [];
  const wallStart = Date.now();
  for (const transport of transports) {
    const ctx = new RunContext({ transport, baseUrl, page, log, signaling });
    await ctx.start();
    try {
      if (scenarios.some((s) => s.startsWith("H"))) await ensureFixtures(ctx, log);
      for (const scenarioId of scenarios) {
        for (const seed of seeds) {
          if (skipCell && skipCell(scenarioId, seed, transport)) {
            log(`↷ ${scenarioId} seed ${seed} on ${transport} (checkpointed — skipping)`);
            continue;
          }
          log(`▶ ${scenarioId} seed ${seed} on ${transport}`);
          const result = await runOne(ctx, scenarioId, seed, log);
          results.push(result);
          onResult(result);
        }
      }
    } finally {
      await ctx.stop();
    }
  }
  const wallMs = Date.now() - wallStart;
  if (!write) return { results, wallMs };
  const written = await writeOutputs(results, wallMs);
  return { results, wallMs, ...written };
}

async function environmentInfo() {
  let chromium = "unknown";
  try {
    chromium = (await import("@playwright/test")).chromium.name();
  } catch { /* best-effort */ }
  return {
    node: process.version,
    chromium,
    turn: "in-process Node relay (runner/turn-relay.mjs)",
    platform: `${process.platform} ${process.arch}`,
  };
}

/** @param {Result[]} results @param {number} wallMs @param {{outDir?: string}} [options] */
export async function writeOutputs(results, wallMs, { outDir = OUT_DIR } = {}) {
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  const resultsPath = path.join(outDir, "results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  /** @type {Map<string, {pass: number, total: number, failures: string[]}>} */
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
    .map((r) => Number(r.measurements?.timeToFirstRemoteFrameMs));
  const recovery10 = results
    .filter((r) => r.scenario === "H-07" && r.measurements?.recovery10sMs != null)
    .map((r) => Number(r.measurements?.recovery10sMs));

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
