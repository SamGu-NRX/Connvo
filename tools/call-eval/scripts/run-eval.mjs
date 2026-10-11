#!/usr/bin/env node
/**
 * Call-eval CLI — runs the two-peer harness scenarios against one or more
 * transport URLs and writes results.json + summary.md under tools/call-eval/out/.
 *
 * Usage:
 *   node tools/call-eval/scripts/run-eval.mjs \
 *     [--transport=mock,bench] \
 *     [--scenarios=all | H-01,H-02 | H-01..H-16] \
 *     [--seeds=1,2 | 1..20] \
 *     [--suite=H|P|all] \
 *     [--base-url=https://<origin>] \
 *     [--list]
 *
 * Without --base-url each transport name maps to the bundled mock bench page
 * served by the harness relay; pass --base-url to point scenarios at the real
 * bench route (e.g. http://localhost:3000 — the URL must serve the DOM
 * contract at /dev/call-bench/[transport], which --base-url+benchPath selects).
 * Exit code 0 only when every executed run passed.
 */
import { runScenarios, H_IDS, P_IDS, ALL_SCENARIOS } from "../runner/run.mjs";

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

const args = process.argv.slice(2);
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
if (!["H", "P", "ALL"].includes(suite)) throw new Error(`--suite must be H, P or ALL (got "${flags.suite}")`);
const universe = suite === "H" ? H_IDS : suite === "P" ? P_IDS : ALL_SCENARIOS;
const scenarios = parseListRange(flags.scenarios, universe);
const seeds = parseSeeds(flags.seeds);
const transports = (flags.transport ?? "mock").split(",").map((s) => s.trim()).filter(Boolean);
const baseUrl = flags["base-url"] ?? null;

console.log(`call-eval: transports=${transports.join(",")} scenarios=${scenarios.length} seeds=${seeds.length} baseUrl=${baseUrl ?? "(mock)"}`);
const { results, wallMs, resultsPath, summaryPath } = await runScenarios({ transports, scenarios, seeds, baseUrl, log: console.log });
console.log(`results: ${resultsPath}`);
console.log(`summary: ${summaryPath}`);
const failed = results.filter((r) => !r.pass);
console.log(`done in ${(wallMs / 1000).toFixed(1)}s — ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
