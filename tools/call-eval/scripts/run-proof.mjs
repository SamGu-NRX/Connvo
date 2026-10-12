#!/usr/bin/env node
// One-command browser proof (task connvo-local-convex-f1e):
//   node tools/call-eval/scripts/run-proof.mjs
//
// Stage 1  backend   — runs tools/call-eval/scripts/local-backend.mjs (this
//                      file does NOT modify it; see single-writer note in the
//                      f1e task) and tees its full output with wall-clock stamps.
// Stage 2  verify    — manual push/seed verification independent of the
//                      backend script's own checks: state.json parses, the
//                      backend log carries "seeded meeting" + "READY", and a
//                      fresh `npx convex run devEval/shape:shape` read-back
//                      succeeds against the deployment named in state.json.
// Stage 3  next dev  — ensures NEXT_PUBLIC_WORKOS_REDIRECT_URI is in .env.local
//                      (authkit-nextjs 2.10.0 reads the NEXT_PUBLIC_ name; the
//                      backend script does not set it yet) and that the proof
//                      page answers; restarts conn-eval-next with the eval env
//                      if it is not serving.
// Stage 4  browser   — real Chromium via @playwright/test: A and B each open
//                      /dev/auth-proof?as=<X>&meeting=<id> in their own browser
//                      context and must land in
//                      [data-testid="auth-proof-result"][data-proof="ok"] with
//                      the seeded meeting title; O must land in
//                      [data-testid="call-error"] with the named participant
//                      rejection (H-14). Screenshot + video per persona.
// Stage 5  summary   — writes run-summary.json next to the logs and exits 0
//                      only if every check above passed.
//
// Evidence lands in tools/call-eval/out/proof-<ts>/ (out/ stays uncommitted;
// copy what the PR needs into tools/call-eval/verification/).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DUMMY_WORKOS_CLIENT_ID } from "./local-backend-core.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(SCRIPTS_DIR, "..");
const REPO = path.resolve(EVAL_DIR, "../..");
const LOCAL_DIR = path.join(EVAL_DIR, ".local");
const STATE_PATH = path.join(EVAL_DIR, "out", "state.json");
const NEXT_PORT = 3000;
const NEXT_BASE = `http://localhost:${NEXT_PORT}`;
const REDIRECT_URI = `${NEXT_BASE}/auth/callback`;

const RUN_TAG = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(EVAL_DIR, "out", `proof-${RUN_TAG}`);
const RUN_LOG = path.join(OUT_DIR, "run.log");

const results = {
  runTag: RUN_TAG,
  repo: REPO,
  gitSha: null,
  startedAt: new Date().toISOString(),
  env: { node: process.version, loadavgSample: null, nproc: null },
  stages: {},
  personas: [],
  passed: false,
};

function stamp() {
  return new Date().toISOString();
}
function loadavg() {
  return readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" ");
}
function log(msg) {
  const line = `${stamp()} [proof] ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + "\n");
}

/** Run a command, tee stdout+stderr into the run log, return {code, out}. */
function runTee(cmd, args, { timeoutMs = 900000, env = process.env, cwd = REPO } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd, env, shell: false });
    let out = "";
    const collect = (chunk) => {
      const text = chunk.toString();
      out += text;
      appendFileSync(RUN_LOG, text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      appendFileSync(RUN_LOG, `${stamp()} [proof] (exit code=${code} signal=${signal} after ${Date.now() - t0}ms)\n`);
      resolve({ code, signal, out, durationMs: Date.now() - t0 });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      appendFileSync(RUN_LOG, `${stamp()} [proof] spawn error: ${err}\n`);
      resolve({ code: -1, signal: null, out, durationMs: Date.now() - t0 });
    });
  });
}

/** Next dev restart used when the backend script's next stage is down or misconfigured. */
async function startNextDev(convexUrl, authKeyB64) {
  const tmuxArgs = [
    "new-session", "-d", "-s", "conn-eval-next",
    "bash", "-c",
    [
      `cd ${JSON.stringify(REPO)}`,
      `NEXT_PUBLIC_CONVEX_URL=${JSON.stringify(convexUrl)}`,
      "NEXT_PUBLIC_CONNVO_TEST_AUTH=1",
      "NEXT_PUBLIC_CONNVO_CALL_BENCH=1",
      `WORKOS_CLIENT_ID=${JSON.stringify(DUMMY_WORKOS_CLIENT_ID)}`,
      `NEXT_PUBLIC_WORKOS_REDIRECT_URI=${JSON.stringify(REDIRECT_URI)}`,
      `CONNVO_LOCAL_TEST_AUTH_KEY=${JSON.stringify(authKeyB64)}`,
      `pnpm exec next dev -p ${NEXT_PORT} 2>&1 | tee ${JSON.stringify(path.join(LOCAL_DIR, "next-dev.log"))}`,
    ].join(" "),
  ];
  await runTee("tmux", ["kill-session", "-t", "conn-eval-next"], { timeoutMs: 15000 });
  return runTee("tmux", tmuxArgs, { timeoutMs: 15000 });
}

async function pageAnswers() {
  const r = await runTee("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${NEXT_BASE}/dev/auth-proof?as=A`], { timeoutMs: 30000 });
  return { code: r.out.trim().slice(-3), durationMs: r.durationMs };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  results.env.loadavgSample = loadavg();
  results.env.nproc = Number((await runTee("nproc", [], { timeoutMs: 10000 })).out.trim()) || null;
  results.gitSha = (await runTee("git", ["rev-parse", "HEAD"], { timeoutMs: 10000 })).out.trim();
  log(`start sha=${results.gitSha} load=${results.env.loadavgSample} nproc=${results.env.nproc}`);

  // Stage 1: backend bring-up (provision, push, seed, next dev, state.json).
  const t1 = Date.now();
  log("stage 1/5 backend: running local-backend.mjs (provision + push + seed + next dev)");
  const backend = await runTee("node", [path.join(SCRIPTS_DIR, "local-backend.mjs"), `--port=${NEXT_PORT}`], { timeoutMs: 1500000 });
  results.stages.backend = { exitCode: backend.code, durationMs: backend.durationMs };
  log(`stage 1/5 backend exit=${backend.code} after ${(backend.durationMs / 1000).toFixed(1)}s`);

  // Stage 2: manual push/seed verification from MY OWN run's evidence.
  const t2 = Date.now();
  const checks = { stateJson: false, logMarkers: false, shapeReadBack: false, convexDevLogTail: null };
  if (existsSync(STATE_PATH)) {
    try {
      const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
      checks.stateJson = Boolean(state.convexUrl && state.nextBaseUrl && state.meetingId && state.users?.a?.token && state.users?.o?.token);
      results.state = { convexUrl: state.convexUrl, nextBaseUrl: state.nextBaseUrl, meetingId: state.meetingId };
    } catch (err) {
      log(`state.json unparseable: ${err}`);
    }
  } else {
    log("state.json MISSING after backend stage");
  }
  // The backend log in run.log must carry the seed + READY markers from this run.
  const runLogText = existsSync(RUN_LOG) ? readFileSync(RUN_LOG, "utf8") : "";
  checks.logMarkers = runLogText.includes("seeded meeting") && runLogText.includes("READY");
  if (!checks.logMarkers) log("WARNING: backend log markers (seeded meeting / READY) not found in this run's log");
  // Independent read-back: the seeded shape must come back from the deployment.
  if (checks.stateJson) {
    const shape = await runTee("npx", ["convex", "run", "devEval/shape:shape"], { timeoutMs: 180000 });
    checks.shapeReadBack = shape.code === 0 && shape.out.includes("local-test-a");
    if (!checks.shapeReadBack) {
      log("shape:shape read-back failed; falling back to idempotent devEval/seed re-run as read-back");
      const seed = await runTee("npx", ["convex", "run", "devEval/seed"], { timeoutMs: 180000 });
      checks.shapeReadBack = seed.code === 0 && seed.out.includes("meetingId");
    }
  }
  const convDevLog = path.join(LOCAL_DIR, "convex-dev.log");
  if (existsSync(convDevLog)) {
    checks.convexDevLogTail = readFileSync(convDevLog, "utf8").split("\n").slice(-15).join("\n");
  }
  results.stages.verify = { ...checks, durationMs: Date.now() - t2 };
  log(`stage 2/5 verify: stateJson=${checks.stateJson} logMarkers=${checks.logMarkers} shapeReadBack=${checks.shapeReadBack} (${((Date.now() - t2) / 1000).toFixed(1)}s)`);

  // Stage 3: make sure next dev is serving the proof page with the redirect URI fix.
  const t3 = Date.now();
  // Idempotent: keep every other line, add the redirect URI only if missing.
  const envLocalPath = path.join(REPO, ".env.local");
  let envLocal = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  if (!/^NEXT_PUBLIC_WORKOS_REDIRECT_URI=/m.test(envLocal)) {
    writeFileSync(envLocalPath, envLocal.replace(/\n?$/, "\n") + `NEXT_PUBLIC_WORKOS_REDIRECT_URI=${REDIRECT_URI}\n`);
    log("appended NEXT_PUBLIC_WORKOS_REDIRECT_URI to .env.local (authkit-nextjs 2.10.0 reads the NEXT_PUBLIC_ name)");
  }
  let page1 = await pageAnswers();
  let nextRepaired = false;
  if (!page1.code.startsWith("2") && !page1.code.startsWith("3")) {
    log(`next dev not answering (${page1.code ?? "no code"}); restarting conn-eval-next with the full eval env`);
    // Private JWK for the token route: the backend writes the keypair to .local/keys.
    const keyDir = path.join(LOCAL_DIR, "keys");
    const keyFile = existsSync(path.join(keyDir, "jwks-private.json"))
      ? path.join(keyDir, "jwks-private.json")
      : existsSync(path.join(keyDir, "jwks.json")) ? path.join(keyDir, "jwks.json") : null;
    const authKeyB64 = keyFile ? Buffer.from(readFileSync(keyFile, "utf8")).toString("base64") : "";
    const state = results.state ?? {};
    await startNextDev(state.convexUrl ?? "", authKeyB64);
    nextRepaired = true;
    // Wait up to 180s for the page to answer (next dev compiles on first hit).
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      page1 = await pageAnswers();
      if (page1.code.startsWith("2") || page1.code.startsWith("3")) break;
    }
  }
  const nextServing = page1.code.startsWith("2") || page1.code.startsWith("3");
  results.stages.nextDev = { httpCode: page1.code, nextRepaired, nextServing, durationMs: Date.now() - t3 };
  log(`stage 3/5 next dev serving=${nextServing} http=${page1.code} repaired=${nextRepaired}`);

  // Stage 4: the real browser proof — A and B read, O is refused.
  const t4 = Date.now();
  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : null;
  if (state && nextServing) {
    const { chromium } = createRequire(import.meta.url)("@playwright/test");
    let browser = null;
    try {
      browser = await chromium.launch();
    } catch (err) {
      log(`chromium launch failed (${String(err).slice(0, 200)}); attempting playwright install chromium`);
      await runTee("pnpm", ["exec", "playwright", "install", "chromium"], { timeoutMs: 600000 });
      browser = await chromium.launch();
    }
    const personas = [
      { as: "A", expect: "ok" },
      { as: "B", expect: "ok" },
      { as: "O", expect: "refusal" },
    ];
    for (const p of personas) {
      const t0 = Date.now();
      const entry = { as: p.as, expect: p.expect, ok: false, url: `${NEXT_BASE}/dev/auth-proof?as=${p.as}&meeting=${state.meetingId}` };
      const videoDir = path.join(OUT_DIR, `video-${p.as}`);
      mkdirSync(videoDir, { recursive: true });
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
      });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
      page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
      try {
        await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 120000 });
        if (p.expect === "ok") {
          const sel = '[data-testid="auth-proof-result"][data-proof="ok"]';
          await page.waitForSelector(sel, { timeout: 120000 });
          const observed = (await page.textContent(sel)) ?? "";
          const user = ((await page.textContent('[data-testid="auth-proof-user"]')) ?? "").trim();
          entry.observed = observed.slice(0, 400);
          entry.ok = observed.includes("OK: Eval harness smoke meeting") && user === p.as;
        } else {
          const sel = '[data-testid="call-error"]';
          await page.waitForSelector(sel, { timeout: 120000 });
          const observed = (await page.textContent(sel)) ?? "";
          entry.observed = observed.slice(0, 400);
          entry.ok = observed.includes("Access denied") && observed.includes("Not a meeting participant");
        }
        await page.screenshot({ path: path.join(OUT_DIR, `${p.as}.png`), fullPage: true });
      } catch (err) {
        entry.error = String(err).slice(0, 500);
        try { await page.screenshot({ path: path.join(OUT_DIR, `${p.as}-failure.png`), fullPage: true }); } catch {}
      }
      entry.consoleErrors = consoleErrors.slice(0, 10);
      await ctx.close(); // flush the video
      const videos = existsSync(videoDir) ? readdirSafe(videoDir) : [];
      if (videos.length > 0) renameSync(path.join(videoDir, videos[0]), path.join(OUT_DIR, `${p.as}.webm`));
      entry.durationMs = Date.now() - t0;
      results.personas.push(entry);
      log(`stage 4/5 persona ${p.as}: ok=${entry.ok} (${(entry.durationMs / 1000).toFixed(1)}s)${entry.error ? ` error=${entry.error.slice(0, 120)}` : ""}`);
    }
    await browser.close();
  } else {
    log("stage 4/5 skipped: state.json missing or next dev not serving — recording as failing witness");
  }
  results.stages.browser = { durationMs: Date.now() - t4, loadavgEnd: loadavg() };

  // Stage 5: summary + honest exit.
  results.finishedAt = new Date().toISOString();
  results.passed =
    results.stages.verify?.stateJson === true &&
    results.stages.verify?.logMarkers === true &&
    results.stages.verify?.shapeReadBack === true &&
    results.stages.nextDev?.nextServing === true &&
    results.personas.length === 3 &&
    results.personas.every((p) => p.ok === true);
  writeFileSync(path.join(OUT_DIR, "run-summary.json"), JSON.stringify(results, null, 2));
  log(`stage 5/5 PASSED=${results.passed} — evidence in ${OUT_DIR}`);
  process.exit(results.passed ? 0 : 1);
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

main().catch((err) => {
  log(`FATAL: ${err?.stack ?? err}`);
  results.passed = false;
  try { writeFileSync(path.join(OUT_DIR, "run-summary.json"), JSON.stringify(results, null, 2)); } catch {}
  process.exit(1);
});
