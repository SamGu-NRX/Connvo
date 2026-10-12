#!/usr/bin/env node
/**
 * Call-eval CLI — runs the two-peer harness scenarios against one or more
 * transport URLs and writes results.json + summary.md under tools/call-eval/out/.
 *
 * Usage:
 *   node tools/call-eval/scripts/run-eval.mjs \
 *     [--transport=mock | reference | reference-<variant>] \
 *     [--scenarios=all | H-01,H-02 | H-01..H-16] \
 *     [--seeds=1,2 | 1..20] \
 *     [--suite=H|P|all] \
 *     [--base-url=https://<origin>] \
 *     [--page=bench|real] [--signaling=reference|convex] \
 *     [--list]
 *
 * Transport resolution:
 * - Without --base-url every transport name maps to the bundled mock bench
 *   page served by the harness relay (the name is then a reporting label).
 * - With --base-url, scenarios navigate the real bench route
 *   <base-url>/dev/call-bench/<transport>, which must serve the DOM contract
 *   (tools/call-eval/CONTRACT.md). Reference transports additionally get a
 *   runner-spawned signaling server fed --jwks-file / --members-file per the
 *   H-14 design note (docs/plan/handoffs/connvo-call-harness-f1.md), and its
 *   ws:// address is passed to the page additively as ?signal=.
 *
 * --signaling=convex (with --page=real) signals over the local Convex backend
 * that scripts/local-backend.mjs starts: a fresh meeting per scenario, the
 * signed-in test users A..O, and H-14 wired in.
 *
 * Suite wiring: H-14 is excluded from the default/all suite of this shard
 * (its verification machinery ships; the scenario itself needs a live local
 * backend) — name it explicitly via --scenarios=H-14 to run it anyway.
 * Exit code 0 only when every executed run passed.
 */
import { runScenarios, H_IDS, P_IDS, ALL_SCENARIOS, wiredScenarioIds } from "../runner/run.mjs";

/**
 * @param {string} raw comma list, a..b range, "all", or empty
 * @param {string[]} universe ids ranges resolve against
 * @returns {string[]}
 */
function parseListRange(raw, universe) {
  if (!raw || raw === "all") return [...universe];
  if (raw.includes("..")) {
    const [from, to] = raw.split("..");
    const a = universe.indexOf(from.trim());
    const b = universe.indexOf(to.trim());
    if (a === -1 || b === -1) throw new Error(`unknown range bounds in "${raw}"`);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return universe.slice(lo, hi + 1);
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string} raw seed list or range
 * @returns {number[]}
 */
function parseSeeds(raw) {
  if (!raw) return [1];
  if (raw.includes("..")) {
    const [from, to] = raw.split("..").map((s) => Number(s.trim()));
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`bad seed range "${raw}"`);
    const out = [];
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) out.push(i);
    return out;
  }
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
}

// pnpm forwards `pnpm call-eval -- --flag=x` with a literal `--` separator
// before the flags; the CLI is all-flag so separator tokens never matter.
const args = process.argv.slice(2).filter((a) => a !== "--");
if (args.includes("--help") || args.includes("-h")) {
  console.log((await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*[\s\S]*?\*\//)?.[0]?.replace(/^\*\*[ \t]*/gm, "") ?? "");
  process.exit(0);
}
if (args.includes("--list")) {
  console.log(`H scenarios: ${H_IDS.join(" ")}`);
  console.log(`P checks:    ${P_IDS.join(" ")}`);
  process.exit(0);
}

const flags = {};
for (const arg of args) {
  const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/i);
  if (!m) throw new Error(`unrecognized argument "${arg}"`);
  flags[m[1]] = m[2] ?? "true";
}

const suite = (flags.suite ?? "H").toUpperCase();
const signaling = flags.signaling ?? "reference";
if (!["reference", "convex"].includes(signaling)) throw new Error(`--signaling must be reference or convex (got "${flags.signaling}")`);
if (!["H", "P", "ALL"].includes(suite)) throw new Error(`--suite must be H, P or ALL (got "${flags.suite}")`);
// Defaults (no --scenarios / "all" / ranges) select the WIRED suite of this
// shard; explicitly NAMED scenarios run as requested — the escape hatch.
const fullUniverse = suite === "H" ? H_IDS : suite === "P" ? P_IDS : ALL_SCENARIOS;
const wired = new Set(wiredScenarioIds(suite, { signaling }));
const rawScenarios = flags.scenarios;
let scenarios;
if (rawScenarios && !rawScenarios.includes("..") && rawScenarios !== "all") {
  scenarios = rawScenarios.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of scenarios) {
    if (!wired.has(id)) {
      console.log(`call-eval: WARNING ${id} is outside the wired ${suite} suite — running because it was named explicitly (needs a live local backend)`);
    }
  }
} else if (rawScenarios && rawScenarios.includes("..")) {
  scenarios = parseListRange(rawScenarios, fullUniverse).filter((id) => {
    if (wired.has(id)) return true;
    console.log(`call-eval: skipping ${id} — not wired (name it explicitly to run)`);
    return false;
  });
} else {
  scenarios = [...wired];
}
const seeds = parseSeeds(flags.seeds);
const transports = (flags.transport ?? "mock").split(",").map((s) => s.trim()).filter(Boolean);
const baseUrl = flags["base-url"] ?? null;

console.log(`call-eval: transports=${transports.join(",")} scenarios=${scenarios.length} seeds=${seeds.length} baseUrl=${baseUrl ?? "(mock)"}`);
// --page=real drives the real call page (/app/call/<id>) instead of the
// bench; it needs next dev with NEXT_PUBLIC_CONNVO_REAL_CALL=1 as well.
const page = flags.page ?? "bench";
if (!["bench", "real"].includes(page)) throw new Error(`--page must be bench or real (got "${page}")`);
if (page === "real" && !baseUrl) throw new Error("--page=real needs --base-url");
if (signaling === "convex" && page !== "real") throw new Error("--signaling=convex needs --page=real");
const { results, wallMs, resultsPath, summaryPath } = await runScenarios({ transports, scenarios, seeds, baseUrl, page, signaling, log: console.log });
console.log(`results: ${resultsPath}`);
console.log(`summary: ${summaryPath}`);
const failed = results.filter((r) => !r.pass);
console.log(`done in ${(wallMs / 1000).toFixed(1)}s — ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
