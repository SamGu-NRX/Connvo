#!/usr/bin/env node
// One command, from a clean checkout, for the local Convex half of S0:
//   pnpm call-eval:proof [-- --port=3035] [--fresh] [--evidence=<dir>]
//
// 1. backend  local-backend.mjs: anonymous local Convex deployment, deployment
//             env, a completed push, the seed (users A/B/C, outsider O, one
//             active meeting) read back and checked, next dev with the eval env.
// 2. browser  real Chromium: A and B each open /dev/auth-proof for the seeded
//             meeting and must read it through getMeeting (behind
//             assertMeetingAccess); O must get the named refusal (H-14).
// 3. summary  run-summary.json and summary.md with per-stage wall times, plus
//             a screenshot and a recording per person.
//
// Rerunning is the recovery path: the backend script reuses a running
// deployment and Next, and restarts Next if its env or signing key changed.
// Exit 0 only when every check passed.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(SCRIPTS_DIR, "..");
const REPO = path.resolve(EVAL_DIR, "../..");
const STATE_PATH = path.join(EVAL_DIR, "out", "state.json");

const args = process.argv.slice(2).filter((a) => a !== "--");
const flagValue = (/** @type {string} */ name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const PORT = Number(flagValue("port") ?? 3035);
const BASE = `http://localhost:${PORT}`;
const EVIDENCE = flagValue("evidence") ? path.resolve(REPO, /** @type {string} */ (flagValue("evidence"))) : null;

const RUN_TAG = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join(EVAL_DIR, "out", `proof-${RUN_TAG}`);
const RUN_LOG = path.join(OUT, "run.log");
mkdirSync(OUT, { recursive: true });

/** @param {string} msg */
function log(msg) {
  const line = `${new Date().toISOString()} [proof] ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + "\n");
}

/**
 * Run a command with an argument array (no shell), teeing output to the log.
 * @param {string} cmd @param {string[]} argv @param {number} timeoutMs
 * @returns {Promise<{ code: number | null, out: string, ms: number }>}
 */
function run(cmd, argv, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, argv, { cwd: REPO });
    let out = "";
    const collect = (/** @type {Buffer} */ chunk) => {
      out += chunk.toString();
      process.stdout.write(chunk);
      appendFileSync(RUN_LOG, chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, ms: Date.now() - t0 });
    });
  });
}

/** @type {any} */
const summary = {
  startedAt: new Date().toISOString(),
  gitSha: null,
  host: `${os.platform()} ${os.arch()}, ${os.cpus().length} CPUs, node ${process.version}`,
  loadavgStart: os.loadavg().map((x) => x.toFixed(2)).join(" "),
  port: PORT,
  stages: {},
  personas: [],
  passed: false,
};

async function main() {
  summary.gitSha = (await run("git", ["rev-parse", "HEAD"], 10_000)).out.trim();
  log(`start at ${summary.gitSha}, load ${summary.loadavgStart}`);

  // 1. Backend.
  const backendArgs = [path.join(SCRIPTS_DIR, "local-backend.mjs"), `--port=${PORT}`];
  if (args.includes("--fresh")) backendArgs.push("--fresh");
  const backend = await run("node", backendArgs, 1_500_000);
  const ready =
    backend.code === 0 &&
    backend.out.includes("[backend] READY") &&
    backend.out.includes("[backend] push completed after the deployment env was set") &&
    backend.out.includes("seed shape verified");
  summary.stages.backend = {
    exitCode: backend.code,
    ms: backend.ms,
    ready,
    pushCompleted: backend.out.includes("[backend] push completed after the deployment env was set"),
    seedShapeVerified: backend.out.includes("seed shape verified"),
  };
  log(`stage 1/3 backend: exit ${backend.code}, ready ${ready}, ${(backend.ms / 1000).toFixed(1)} s`);
  if (!ready) return finish();

  // 2. Browser proof.
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  summary.meetingId = state.meetingId;
  const t2 = Date.now();
  const { chromium } = createRequire(import.meta.url)("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const p of [
      { as: "A", expect: "read" },
      { as: "B", expect: "read" },
      { as: "O", expect: "refused" },
    ]) {
      const t0 = Date.now();
      /** @type {any} */
      const entry = { as: p.as, expect: p.expect, ok: false, url: `${BASE}/dev/auth-proof?as=${p.as}&meeting=${state.meetingId}` };
      const videoDir = path.join(OUT, `video-${p.as}`);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } });
      const page = await ctx.newPage();
      /** @type {string[]} */
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
      try {
        await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
        await page.waitForSelector('[data-testid="auth-proof-result"]:not([data-proof="pending"])', { timeout: 120_000 });
        const proof = await page.getAttribute('[data-testid="auth-proof-result"]', "data-proof");
        const text = ((await page.textContent('[data-testid="auth-proof-result"]')) ?? "").trim();
        const identity = ((await page.textContent('[data-testid="auth-proof-user"]')) ?? "").trim();
        entry.observed = text.slice(0, 300);
        entry.proof = proof;
        entry.ok =
          identity === p.as &&
          (p.expect === "read"
            ? proof === "ok" && text.includes("Eval harness smoke meeting")
            : proof === "error" && text.includes("Access denied") && text.includes("Not a meeting participant"));
        await page.screenshot({ path: path.join(OUT, `${p.as}.png`) });
      } catch (err) {
        entry.error = String(err).slice(0, 400);
        await page.screenshot({ path: path.join(OUT, `${p.as}-failure.png`) }).catch(() => {});
      }
      entry.pageErrors = pageErrors.slice(0, 5);
      await ctx.close();
      const video = existsSync(videoDir) ? readdirSync(videoDir)[0] : null;
      if (video) renameSync(path.join(videoDir, video), path.join(OUT, `${p.as}.webm`));
      entry.ms = Date.now() - t0;
      summary.personas.push(entry);
      log(`stage 2/3 ${p.as} (${p.expect}): ok ${entry.ok}, ${(entry.ms / 1000).toFixed(1)} s${entry.error ? `, error ${entry.error.slice(0, 160)}` : ""}`);
    }
  } finally {
    await browser.close();
  }
  summary.stages.browser = { ms: Date.now() - t2 };
  finish();
}

function finish() {
  summary.finishedAt = new Date().toISOString();
  summary.loadavgEnd = os.loadavg().map((x) => x.toFixed(2)).join(" ");
  summary.passed = summary.stages.backend?.ready === true && summary.personas.length === 3 && summary.personas.every((/** @type {any} */ p) => p.ok);
  writeFileSync(path.join(OUT, "run-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  const b = summary.stages.backend ?? {};
  const md = [
    "# Local Convex proof",
    "",
    `Commit ${summary.gitSha}, ${summary.host}, load ${summary.loadavgStart} at start, ${summary.loadavgEnd} at end.`,
    `Command: \`pnpm call-eval:proof${args.length ? " -- " + args.join(" ") : ""}\`. Result: **${summary.passed ? "PASS" : "FAIL"}**.`,
    "",
    "| Stage | Result | Wall time |",
    "|---|---|---|",
    `| Backend: provision, env, push, seed, shape check, next dev | ${b.ready ? "ready" : `not ready (exit ${b.exitCode})`}; push completed ${b.pushCompleted}; seed shape verified ${b.seedShapeVerified} | ${((b.ms ?? 0) / 1000).toFixed(1)} s |`,
    ...summary.personas.map(
      (/** @type {any} */ p) => `| ${p.as} opens the meeting (expects ${p.expect}) | ${p.ok ? "pass" : "FAIL"}: ${String(p.observed ?? p.error ?? "").split("\n")[0].slice(0, 120)} | ${(p.ms / 1000).toFixed(1)} s |`,
    ),
    "",
    summary.meetingId ? `Seeded meeting: \`${summary.meetingId}\`.` : "",
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, "summary.md"), md);
  if (EVIDENCE) {
    mkdirSync(EVIDENCE, { recursive: true });
    for (const f of readdirSync(OUT)) {
      if (/\.(png|webm|json|md|log)$/.test(f)) copyFileSync(path.join(OUT, f), path.join(EVIDENCE, f));
    }
  }
  log(`stage 3/3 ${summary.passed ? "PASS" : "FAIL"}; evidence in ${EVIDENCE ?? OUT}`);
  process.exit(summary.passed ? 0 : 1);
}

main().catch((err) => {
  log(`FATAL: ${err?.stack ?? err}`);
  finish();
});
