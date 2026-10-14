#!/usr/bin/env node
/**
 * Harness self-proof (CALL-PLAN.md S0): the reference transport passes
 * H-01..H-13, and each broken variant fails exactly the scenarios its defect breaks.
 * Runs with no Convex and no sign-in: it starts `next dev` with
 * NEXT_PUBLIC_CONNVO_CALL_BENCH=1, and the runner starts the reference
 * signaling server, which mints the bench identities itself.
 *
 * Usage:
 *   pnpm call-eval:self-proof -- [--seeds=1..20] [--variant-seeds=1] \
 *     [--scenarios=H-01..H-13] [--variants=no-audio,never-close,no-reconnect] \
 *     [--variant-scenarios=all|target] [--port=3036] [--base-url=http://localhost:3036] [--fresh]
 *
 * --base-url skips starting Next and uses a server already running with the
 * bench flag. Every completed run is appended to self-proof/checkpoint.jsonl
 * before the proof is rewritten; a re-run RESUMES from that checkpoint
 * (skipping already-run cells) unless --fresh is given. Writes
 * tools/call-eval/self-proof/results.json and summary.md. Exit 0 only when
 * reference passes every run and every variant fails exactly its expected
 * scenario.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScenarios, H_IDS } from "../runner/run.mjs";
import { checkedNextEnvironment } from "./local-backend-core.mjs";
import {
  appendCheckpoint,
  checkpointKeys,
  loadCheckpoint,
  rowsForSection,
} from "./self-proof-checkpoint.mjs";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(EVAL_DIR, "..", "..");
const OUT = path.join(EVAL_DIR, "self-proof");

/** Which scenario each broken variant must fail (CALL-PLAN.md, harness self-proof). */
/** @type {Record<string, string>} */
const EXPECTED_FAILURE = { "no-audio": "H-02,H-03", "never-close": "H-11,H-13", "no-reconnect": "H-07" };
/** Why each variant fails what it fails; printed in summary.md. */
const EXPECTED_REASON = {
  "no-audio": "it never sends audio, so H-02 hears no tone, and H-03 cannot hear the tone come back after unmute",
  "never-close": "leave() closes nothing, so H-11 finds live connections and the signaling session still open, and H-13's leave/rejoin cycles cannot get back to baseline (seen in all three full-scope runs on obv/connvo-36-child-handoff)",
  "no-reconnect": "a lost connection goes straight to failed, so H-07 never recovers",
};

const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a !== "--").map((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`unrecognized argument "${a}"`);
    return [m[1], m[2] ?? "true"];
  }),
);

/** @param {string} raw */
function range(raw) {
  if (raw.includes("..")) {
    const [a, b] = raw.split("..").map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return raw.split(",").map(Number);
}

/** @param {string} raw */
function scenarioRange(raw) {
  if (!raw.includes("..")) return raw.split(",");
  const [a, b] = raw.split("..");
  return H_IDS.slice(H_IDS.indexOf(a), H_IDS.indexOf(b) + 1);
}

const seeds = range(flags.seeds ?? "1..20");
const variantSeeds = range(flags["variant-seeds"] ?? "1");
// "target" runs each variant only on the scenarios it must fail (a smaller
// matrix); "all" also shows it passing everything else.
const variantScope = flags["variant-scenarios"] ?? "all";
if (!["all", "target"].includes(variantScope)) throw new Error(`--variant-scenarios must be all or target`);
const scenarios = scenarioRange(flags.scenarios ?? "H-01..H-13");
const variants = flags.variants === "none" ? [] : (flags.variants ?? Object.keys(EXPECTED_FAILURE).join(",")).split(",");
for (const v of variants) if (!(v in EXPECTED_FAILURE)) throw new Error(`unknown variant "${v}"`);
const port = Number(flags.port ?? 3036);
let baseUrl = flags["base-url"] ?? null;

// Crash-safe checkpoint: every completed run is appended here before the
// proof files are rewritten, and a re-run resumes from it. --fresh discards
// the checkpoint and starts the matrix from zero.
const checkpointPath = path.join(OUT, "checkpoint.jsonl");
if (flags.fresh && fs.existsSync(checkpointPath)) fs.rmSync(checkpointPath);
const priorRows = loadCheckpoint(checkpointPath);
if (priorRows.length) {
  console.log(`self-proof: resuming — ${priorRows.length} checkpointed run(s) in ${path.relative(REPO, checkpointPath)}${flags.fresh ? " (--fresh ignored: file was deleted)" : ""}`);
}

/** @param {string} url @param {number} timeoutMs */
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not answer 200 within ${timeoutMs} ms`);
}

/** @type {import("node:child_process").ChildProcess | null} */
let next = null;
if (!baseUrl) {
  baseUrl = `http://localhost:${port}`;
  /** @param {string} name */
  const envFile = (name) => {
    const file = path.join(REPO, name);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  };
  // Refuse cloud selectors, keys and URLs in the caller's environment or any
  // env file Next loads, and pass only allowlisted settings, so no inherited
  // URL, key or loader hook (NODE_OPTIONS, BASH_ENV) reaches Next.
  const nextEnv = checkedNextEnvironment({
    env: process.env,
    files: [".env.development.local", ".env.local", ".env.development", ".env"].map(envFile),
  });
  next = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["dev", "-p", String(port)], {
    cwd: REPO,
    env: { ...nextEnv, NEXT_PUBLIC_CONNVO_CALL_BENCH: "1" },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  // A time cap (SIGALRM) or SIGTERM must not orphan the detached server.
  for (const signal of /** @type {const} */ (["SIGALRM", "SIGTERM", "SIGINT"])) {
    process.on(signal, () => {
      try {
        if (next?.pid) process.kill(-next.pid, "SIGTERM");
      } finally {
        process.exit(124);
      }
    });
  }
  await waitForHttp(`${baseUrl}/dev/call-bench/reference?as=A&autojoin=0`, 180000);
}

const wallStart = Date.now();
// Order: reference seed one, then each variant, then the remaining
// reference seeds. A run cut short still covers every transport.
/** @typedef {{ transport: string, expected: string[] | null, reason: string | null, scenarios: string[], plannedSeeds: number[], results: any[] }} Section */
/** @type {Section[]} */
const sections = [
  { transport: "reference", expected: null, reason: null, scenarios, plannedSeeds: seeds.slice(0, 1), results: [] },
  ...variants.map((v) => {
    const expected = EXPECTED_FAILURE[v].split(",");
    return {
      transport: `reference-${v}`,
      expected,
      reason: /** @type {Record<string, string>} */ (EXPECTED_REASON)[v],
      scenarios: variantScope === "target" ? expected : scenarios,
      plannedSeeds: variantSeeds,
      results: [],
    };
  }),
  ...(seeds.length > 1 ? [{ transport: "reference", expected: null, reason: null, scenarios, plannedSeeds: seeds.slice(1), results: [] }] : []),
];
// Restore completed cells so an interrupted run neither loses results nor
// repeats them (rows outside this invocation's seeds/scenarios stay in the
// checkpoint file but never enter this proof).
for (const section of sections) section.results.push(...rowsForSection(priorRows, section, scenarios));
const priorKeys = checkpointKeys(priorRows);
let finished = false;
try {
  for (const section of sections) {
    console.log(`self-proof: ${section.transport} ${section.scenarios.length} scenarios x ${section.plannedSeeds.length} seeds`);
    await runScenarios({
      transports: [section.transport],
      scenarios: section.scenarios,
      seeds: section.plannedSeeds,
      baseUrl,
      write: false,
      // Resume: never re-run a cell the checkpoint already holds.
      skipCell: (scenario, seed, transport) => priorKeys.has(`${transport}|${scenario}|${seed}`),
      // Rewrite the proof after every run, so a run cut short still leaves
      // exact counts of what completed. The checkpoint append lands FIRST:
      // results.json is a rendered view, the JSONL is the durable record.
      onResult: (/** @type {any} */ r) => {
        section.results.push(r);
        appendCheckpoint(checkpointPath, r);
        writeProof();
      },
    });
  }
  finished = true;
} finally {
  if (next?.pid) {
    try {
      process.kill(-next.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
const ok = writeProof();
process.exit(ok ? 0 : 1);

function writeProof() {
const wallMs = Date.now() - wallStart;
const all = sections.flatMap((s) => s.results);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "results.json"),
  JSON.stringify(all.map(({ scenario, transport, seed, pass, measurements, failure, ms }) => ({ scenario, transport, seed, pass, measurements, failure: failure ? { message: failure.message } : null, ms })), null, 2) + "\n",
);

let ok = true;
const lines = [
  "# Harness self-proof",
  "",
  `Command: \`pnpm call-eval:self-proof -- ${process.argv.slice(2).filter((a) => a !== "--").join(" ")}\``,
  `Wall time so far: ${(wallMs / 1000).toFixed(1)} s${finished ? " (complete)" : " (run in progress or cut short)"}; peers run sequentially, scenario by scenario.`,
  `Host: ${os.platform()} ${os.arch()}, ${os.cpus().length} CPUs, node ${process.version}. No Convex, no sign-in.`,
  "",
];
/** @type {Map<string, Section>} */
const byTransport = new Map();
for (const s of sections) {
  const merged = byTransport.get(s.transport) ?? { ...s, plannedSeeds: [], results: [] };
  merged.plannedSeeds.push(...s.plannedSeeds);
  merged.results.push(...s.results);
  byTransport.set(s.transport, merged);
}
for (const section of byTransport.values()) {
  if (!section.results.length) {
    lines.push(`## ${section.transport}`, "", "Not run yet.", "");
    ok = false;
    continue;
  }
  /** @type {Map<string, { pass: number, total: number }>} */
  const byScenario = new Map(section.scenarios.map((s) => [s, { pass: 0, total: 0 }]));
  for (const r of section.results) {
    const e = byScenario.get(r.scenario);
    if (!e) continue;
    e.total++;
    if (r.pass) e.pass++;
  }
  const failing = [...byScenario].filter(([, e]) => e.pass < e.total).map(([s]) => s);
  let verdict;
  if (section.expected === null) {
    verdict = failing.length === 0 ? "PASS: every run passed" : `FAIL: ${failing.join(", ")} had failures`;
    if (failing.length) ok = false;
  } else {
    const want = section.expected;
    const exact =
      failing.length === want.length &&
      want.every((id) => failing.includes(id) && byScenario.get(id)?.pass === 0);
    const scope = variantScope === "target" ? " (run on those scenarios only)" : "";
    verdict = exact
      ? `PASS: fails exactly ${want.join(" and ")}${scope}, because ${section.reason}`
      : `FAIL: expected exactly ${want.join(", ")} to fail, got [${failing.join(", ")}]`;
    if (!exact) ok = false;
  }
  const planned = section.scenarios.length * section.plannedSeeds.length;
  if (section.results.length < planned) {
    verdict = `INCOMPLETE (${section.results.length} of ${planned} runs): ${verdict}`;
    ok = false;
  }
  lines.push(`## ${section.transport}`, "", verdict, "", "| Scenario | Pass | Total |", "|---|---|---|");
  for (const [s, e] of byScenario) lines.push(`| ${s} | ${e.pass} | ${e.total} |`);
  const failures = section.results.filter((r) => !r.pass);
  if (failures.length) {
    lines.push("", "Failures:");
    for (const r of failures) lines.push(`- ${r.scenario} seed ${r.seed}: ${String(r.failure?.message ?? "").split(" | ")[0].slice(0, 220)}`);
  }
  lines.push("");
}
const ttf = all.filter((r) => r.transport === "reference" && r.measurements?.timeToFirstRemoteFrameMs != null).map((r) => r.measurements.timeToFirstRemoteFrameMs);
const rec = all.filter((r) => r.transport === "reference" && r.measurements?.recovery10sMs != null).map((r) => r.measurements.recovery10sMs);
/** @param {number[]} v */
const p95 = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)] : null);
lines.push(
  "## Reference timings",
  "",
  `- p95 time to first remote frame (H-01): ${p95(ttf) ?? "n/a"} ms (n=${ttf.length}); bar 3000 ms.`,
  `- p95 recovery after H-07's 10 s drop: ${p95(rec) ?? "n/a"} ms (n=${rec.length}); bar 8000 ms.`,
  "",
);
fs.writeFileSync(path.join(OUT, "summary.md"), lines.join("\n"));
return ok;
}
