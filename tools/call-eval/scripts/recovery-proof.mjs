#!/usr/bin/env node
// Recovery driver for the f1e browser proof (task connvo-local-convex-f1e):
//   node tools/call-eval/scripts/recovery-proof.mjs
//
// Used when the one-command run (run-proof.mjs) proved provisioning + push +
// seed but its next-dev stage missed its window on the contended 2-core box.
// The local deployment is assumed up (tmux session conn-eval; verify the
// deployment URL in .env.local). Stages:
//   A  seed read-back — idempotent `npx convex run devEval/seed` returns the
//      meetingId (proves the deployment still serves the pushed functions),
//      then `devEval/shape:shape` with that id proves the full seeded shape.
//   B  next dev — restart conn-eval-next with the complete eval env (test
//      auth on, redirect URI, dummy WorkOS client id, base64 private JWK)
//      and wait for the proof page to answer.
//   C  browser — real Chromium: A and B read the seeded meeting, O gets the
//      H-14 named rejection. Screenshot + video per persona.
//   D  summary — run-summary.json; exit 0 only if every check passed.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(SCRIPTS_DIR, "..");
const REPO = path.resolve(EVAL_DIR, "../..");
const LOCAL_DIR = path.join(EVAL_DIR, ".local");
const NEXT_PORT = 3000;
const NEXT_BASE = `http://localhost:${NEXT_PORT}`;
const REDIRECT_URI = `${NEXT_BASE}/auth/callback`;
const DUMMY_WORKOS_CLIENT_ID = "client_connvo_local_dummy"; // exact value run 1 set on the deployment
const MEETING_TITLE = "Eval harness smoke meeting";

const RUN_TAG = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(EVAL_DIR, "out", `proof-recovery-${RUN_TAG}`);
const RUN_LOG = path.join(OUT_DIR, "run.log");

const results = {
  runTag: RUN_TAG,
  kind: "recovery",
  startedAt: new Date().toISOString(),
  env: { loadavgSample: null },
  stages: {},
  personas: [],
  passed: false,
};

function stamp() { return new Date().toISOString(); }
function loadavg() { return readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" "); }
function log(msg) {
  const line = `${stamp()} [proof] ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + "\n");
}

function runTee(cmd, args, { timeoutMs = 600000, env = process.env, cwd = REPO } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd, env, shell: false });
    let out = "";
    const collect = (chunk) => { const text = chunk.toString(); out += text; appendFileSync(RUN_LOG, text); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out, durationMs: Date.now() - t0 });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      log(`spawn error ${cmd}: ${err}`);
      resolve({ code: -1, signal: null, out, durationMs: Date.now() - t0 });
    });
  });
}

function envLocalValue(name) {
  const p = path.join(REPO, ".env.local");
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  results.env.loadavgSample = loadavg();
  const convexUrl = envLocalValue("NEXT_PUBLIC_CONVEX_URL");
  log(`start load=${results.env.loadavgSample} convexUrl=${convexUrl}`);
  if (!convexUrl) { log("FATAL: NEXT_PUBLIC_CONVEX_URL missing from .env.local"); process.exit(1); }

  // Stage A: idempotent seed → meetingId, then the full shape read-back.
  const ta = Date.now();
  const seed = await runTee("npx", ["convex", "run", "devEval/seed"], { timeoutMs: 180000 });
  const m = seed.out.match(/"meetingId"\s*:\s*"([a-z0-9]+)"/) ?? seed.out.match(/meetingId[=: "]+([a-z0-9]+)/);
  const meetingId = m ? m[1] : null;
  const seedOk = seed.code === 0 && Boolean(meetingId);
  let shapeOk = false;
  let shapeOut = null;
  if (seedOk) {
    const shape = await runTee("npx", ["convex", "run", "devEval/shape:shape", `--meetingId=${JSON.stringify(meetingId)}`], { timeoutMs: 180000 });
    shapeOk = shape.code === 0 && shape.out.includes("local-test-a");
    shapeOut = shape.out.slice(0, 1200);
    if (!shapeOk) log(`shape read-back failed: ${shape.out.slice(0, 300)}`);
  } else {
    log(`seed read-back failed (exit=${seed.code}): ${seed.out.slice(0, 300)}`);
  }
  results.stages.seedReadBack = { seedOk, meetingId, shapeOk, durationMs: Date.now() - ta };
  log(`stage A seed/shape read-back: seedOk=${seedOk} meetingId=${meetingId} shapeOk=${shapeOk}`);

  // Stage B: next dev with the full eval env.
  const tb = Date.now();
  const authKeyPath = path.join(LOCAL_DIR, "keys", "private.jwk.json");
  const authKeyB64 = existsSync(authKeyPath) ? Buffer.from(readFileSync(authKeyPath, "utf8")).toString("base64") : "";
  const check = await runTee("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "10", `${NEXT_BASE}/dev/auth-proof?as=A`], { timeoutMs: 30000 });
  let httpCode = check.out.trim().slice(-3);
  if (!(httpCode.startsWith("2") || httpCode.startsWith("3"))) {
    log(`next dev not answering (${httpCode}); restarting conn-eval-next with the full eval env`);
    await runTee("tmux", ["kill-session", "-t", "conn-eval-next"], { timeoutMs: 15000 });
    const nextCmd = [
      `cd ${JSON.stringify(REPO)}`,
      `NEXT_PUBLIC_CONVEX_URL=${JSON.stringify(convexUrl)}`,
      "NEXT_PUBLIC_CONNVO_TEST_AUTH=1",
      "NEXT_PUBLIC_CONNVO_CALL_BENCH=1",
      `WORKOS_CLIENT_ID=${JSON.stringify(DUMMY_WORKOS_CLIENT_ID)}`,
      `NEXT_PUBLIC_WORKOS_REDIRECT_URI=${JSON.stringify(REDIRECT_URI)}`,
      `CONNVO_LOCAL_TEST_AUTH_KEY=${JSON.stringify(authKeyB64)}`,
      `pnpm exec next dev -p ${NEXT_PORT} 2>&1 | tee ${JSON.stringify(path.join(LOCAL_DIR, "next-dev.log"))}`,
    ].join(" && ");
    // tmux takes the shell command as ONE argv element; passing bash/-c/cmd
    // separately makes tmux concatenate them and mangle the quoting
    // ("cd: too many arguments" — seen in the 03:44 run).
    await runTee("tmux", ["new-session", "-d", "-s", "conn-eval-next", `bash -c ${JSON.stringify(nextCmd)}`], { timeoutMs: 15000 });
    for (let i = 0; i < 48; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const c = await runTee("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "10", `${NEXT_BASE}/dev/auth-proof?as=A`], { timeoutMs: 30000 });
      httpCode = c.out.trim().slice(-3);
      if (httpCode.startsWith("2") || httpCode.startsWith("3")) break;
    }
  }
  const nextServing = httpCode.startsWith("2") || httpCode.startsWith("3");
  results.stages.nextDev = { httpCode, nextServing, durationMs: Date.now() - tb };
  log(`stage B next dev serving=${nextServing} http=${httpCode}`);

  // Stage C: the real browser proof.
  const tc = Date.now();
  if (seedOk && nextServing) {
    const { chromium } = createRequire(import.meta.url)("@playwright/test");
    let browser = null;
    try {
      browser = await chromium.launch();
    } catch (err) {
      log(`chromium launch failed (${String(err).slice(0, 200)}); attempting playwright install chromium`);
      await runTee("pnpm", ["exec", "playwright", "install", "chromium"], { timeoutMs: 600000 });
      browser = await chromium.launch();
    }
    for (const p of [{ as: "A", expect: "ok" }, { as: "B", expect: "ok" }, { as: "O", expect: "refusal" }]) {
      const t0 = Date.now();
      const entry = { as: p.as, expect: p.expect, ok: false, url: `${NEXT_BASE}/dev/auth-proof?as=${p.as}&meeting=${meetingId}` };
      const videoDir = path.join(OUT_DIR, `video-${p.as}`);
      mkdirSync(videoDir, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on("console", (cm) => { if (cm.type() === "error") consoleErrors.push(cm.text().slice(0, 300)); });
      page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
      try {
        await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 120000 });
        if (p.expect === "ok") {
          const sel = '[data-testid="auth-proof-result"][data-proof="ok"]';
          await page.waitForSelector(sel, { timeout: 120000 });
          const observed = (await page.textContent(sel)) ?? "";
          const user = ((await page.textContent('[data-testid="auth-proof-user"]')) ?? "").trim();
          entry.observed = observed.slice(0, 400);
          entry.ok = observed.includes(`OK: ${MEETING_TITLE}`) && user === p.as;
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
      await ctx.close();
      const vids = existsSync(videoDir) ? readdirSync(videoDir) : [];
      if (vids.length > 0) renameSync(path.join(videoDir, vids[0]), path.join(OUT_DIR, `${p.as}.webm`));
      entry.durationMs = Date.now() - t0;
      results.personas.push(entry);
      log(`stage C persona ${p.as}: ok=${entry.ok} (${(entry.durationMs / 1000).toFixed(1)}s)${entry.error ? ` error=${entry.error.slice(0, 120)}` : ""}`);
    }
    await browser.close();
  } else {
    log("stage C skipped: seed read-back or next dev failed — recorded as failing witness");
  }
  results.stages.browser = { durationMs: Date.now() - tc, loadavgEnd: loadavg() };

  // Stage D: summary.
  results.finishedAt = new Date().toISOString();
  results.passed =
    results.stages.seedReadBack?.seedOk === true &&
    results.stages.seedReadBack?.shapeOk === true &&
    results.stages.nextDev?.nextServing === true &&
    results.personas.length === 3 &&
    results.personas.every((p) => p.ok === true);
  writeFileSync(path.join(OUT_DIR, "run-summary.json"), JSON.stringify(results, null, 2));
  log(`stage D PASSED=${results.passed} — evidence in ${OUT_DIR}`);
  process.exit(results.passed ? 0 : 1);
}

main().catch((err) => {
  log(`FATAL: ${err?.stack ?? err}`);
  try { writeFileSync(path.join(OUT_DIR, "run-summary.json"), JSON.stringify(results, null, 2)); } catch {}
  process.exit(1);
});
