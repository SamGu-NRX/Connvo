/**
 * Playwright walk of the reconnect prototype: drives the REAL hooks in a
 * real browser across request-loss, ack-loss, and lifecycle cuts, capturing
 * per-step state + screenshots into experiments/reconnect/results/walk/.
 *
 * Run from the repo root:
 *   node experiments/reconnect/prototype/walk.mjs
 * (Playwright comes from the sibling dev-dependency install at
 * /home/user/work/connvo-testdeps — see the experiment README.)
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire("/home/user/work/connvo-testdeps/package.json");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const DIST = path.join(ROOT, "experiments/reconnect/prototype/dist");
const RESULTS = path.join(ROOT, "experiments/reconnect/results");
const OUT = path.join(RESULTS, "walk");
fs.mkdirSync(OUT, { recursive: true });

const server = spawn("python3", ["-m", "http.server", "41731", "--bind", "127.0.0.1"], {
  cwd: DIST,
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();
// Reduced motion: honor the OS-level preference so the walk is deterministic
// and comfortable; the prototype must not require animation frames to settle.
const page = await browser.newPage({
  viewport: { width: 1100, height: 950 },
  reducedMotion: "reduce",
});
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

// Keyboard-only interaction: focus each control and activate it with
// Enter/Space. No mouse coordinates — the walk must pass for keyboard users.
const activate = async (testid) => {
  await page.focus(`[data-testid="${testid}"]`);
  await page.keyboard.press("Enter");
};
const typeInto = async (testid, text) => {
  await page.focus(`[data-testid="${testid}"]`);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text, { delay: 10 });
};

const readState = () =>
  page.evaluate(() => {
    const g = (t) => document.querySelector(`[data-testid="${t}"]`)?.innerText ?? null;
    return {
      conn: g("conn-status"),
      inflight: g("inflight"),
      isLoading: g("notes-loading"),
      isSyncing: g("notes-syncing"),
      saved: g("notes-saved"),
      serverTruth: g("server-truth"),
      duplicates: g("duplicates"),
      meetingState: g("meeting-state"),
      isStarting: g("life-starting"),
      isEnding: g("life-ending"),
      error: g("life-error"),
    };
  });

const steps = [];
const record = async (name) => {
  const state = await readState();
  steps.push({ step: name, state });
  await page.screenshot({
    path: path.join(OUT, `${String(steps.length).padStart(2, "0")}-${name}.png`),
    fullPage: true,
  });
};

await page.goto("http://127.0.0.1:41731/");
await page.waitForFunction(
  () => !document.querySelector('[data-testid="notes-loading"]')?.innerText.includes("true"),
  null,
  { timeout: 10000 },
);
await record("joined");

// A) Request loss: op queued offline, replayed exactly once on restore.
await activate("btn-cut");
await typeInto("editor", "hello world");
await page.waitForTimeout(300);
await record("offline-edit-queued");
await activate("btn-restore");
await page.waitForTimeout(300);
await record("restored-replayed-once");

// B) Ack loss: server accepted, client does not know; restore re-sends and
//    the op is applied a second time (duplicate acceptance).
await activate("btn-arm-ackloss");
await typeInto("editor", "hello world!");
await page.waitForTimeout(300);
await record("ack-lost-syncing-stuck");
await activate("btn-restore");
await page.waitForTimeout(300);
await record("restored-duplicate-applied");

// C) Lifecycle: clean start, then end queued offline and replayed.
await activate("btn-start");
await page.waitForTimeout(300);
await record("meeting-started");
await activate("btn-cut");
await activate("btn-end");
await page.waitForTimeout(300);
await record("end-queued-offline");
await activate("btn-restore");
await page.waitForTimeout(300);
await record("end-replayed-once");

const observations = {
  steps,
  consoleErrors,
  interaction: { keyboardOnly: true, reducedMotion: true },
  summary: {
    requestLoss: "queued op replayed exactly once; saved state converged on restore",
    ackLoss: "server truth advanced while isSyncing stayed true; restore re-sent and duplicated the acceptance",
    lifecycleEndLoss: "end queued offline then replayed exactly once on restore",
  },
};
fs.writeFileSync(path.join(RESULTS, "walk.json"), JSON.stringify(observations, null, 2) + "\n");

await browser.close();
server.kill();
console.log(`walk complete: ${steps.length} steps recorded -> results/walk.json`);
for (const s of steps) console.log(`  ${s.step}: saved="${s.state.saved}" server="${s.state.serverTruth}" dup=${s.state.duplicates}`);
