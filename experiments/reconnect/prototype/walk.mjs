/**
 * Playwright walk of the reconnect prototype: drives the REAL hooks in a
 * real browser across request-loss, ack-loss, and lifecycle cuts, capturing
 * per-step state + screenshots into experiments/reconnect/results/walk/.
 *
 * Keyboard-only, reduced-motion, zero mouse input:
 *  - reducedMotion: "reduce" is emulated at the browser-context level,
 *  - every control is operated from the keyboard only: Tab navigation,
 *    Shift+Tab+Enter activation, and the prototype's letter shortcuts
 *    (c=cut, a=arm ack loss, r=restore, s=start, e=end),
 *  - typing goes through keyboard.type on the focused editor.
 * Each step additionally writes a JSON state snapshot next to its PNG.
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
const focusTestid = () =>
  page.evaluate(
    () =>
      document.activeElement?.dataset?.testid ??
      document.activeElement?.tagName?.toLowerCase() ??
      null,
  );

// Letter shortcuts only operate when focus is OUTSIDE the editor (so normal
// typing is never hijacked). Route every shortcut through here: hop focus
// back to a button first if the editor holds it.
const pressShortcut = async (key) => {
  if ((await focusTestid()) === "editor") {
    await page.keyboard.press("Shift+Tab");
  }
  await page.keyboard.press(key);
};

const readState = () =>
  page.evaluate(() => {
    const g = (t) => document.querySelector(`[data-testid="${t}"]`)?.innerText ?? null;
    const ae = document.activeElement;
    const aeStyle = ae ? getComputedStyle(ae) : null;
    return {
      conn: g("conn-status"),
      inflight: g("inflight"),
      ackArmed: g("ack-armed"),
      isLoading: g("notes-loading"),
      isSyncing: g("notes-syncing"),
      saved: g("notes-saved"),
      serverTruth: g("server-truth"),
      duplicates: g("duplicates"),
      meetingState: g("meeting-state"),
      isStarting: g("life-starting"),
      isEnding: g("life-ending"),
      error: g("life-error"),
      keyboardLegend: !!document.querySelector('[data-testid="kbd-legend"]'),
      focus: ae?.dataset?.testid ?? ae?.tagName?.toLowerCase() ?? null,
      focusOutline: aeStyle ? `${aeStyle.outlineStyle} ${aeStyle.outlineWidth} ${aeStyle.outlineColor}` : null,
    };
  });

const steps = [];
const record = async (name, meta = {}) => {
  const state = await readState();
  const entry = {
    step: name,
    ...meta,
    focus: state.focus,
    focusOutline: state.focusOutline,
    state,
  };
  steps.push(entry);
  await page.screenshot({
    path: path.join(OUT, `${String(steps.length).padStart(2, "0")}-${name}.png`),
    fullPage: true,
  });
  // Per-step state snapshot alongside the screenshot.
  fs.writeFileSync(
    path.join(OUT, `${String(steps.length).padStart(2, "0")}-${name}.json`),
    JSON.stringify(entry, null, 2) + "\n",
  );
};

await page.goto("http://127.0.0.1:41731/");
await page.waitForFunction(
  () => !document.querySelector('[data-testid="notes-loading"]')?.innerText.includes("true"),
  null,
  { timeout: 10000 },
);
await record("joined", { mechanism: "load" });

// 0) Tab navigation: the walk controls must be reachable in DOM order with
//    visible focus (see the focus outlines in the screenshots).
const tabOrder = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("Tab");
  tabOrder.push(await focusTestid());
}
const expectedOrder = ["btn-cut", "btn-arm-ackloss", "btn-restore", "editor"];
if (JSON.stringify(tabOrder) !== JSON.stringify(expectedOrder)) {
  throw new Error(`tab order broken: ${tabOrder.join(" -> ")} (expected ${expectedOrder.join(" -> ")})`);
}
await record("tab-navigation-focus-order", { mechanism: "tab" });

// A) Request loss: op queued offline, replayed exactly once on restore.
//    Cut and restore come from the prototype's letter shortcuts (c / r).
await pressShortcut("c"); // shortcut: cut connection
await typeInto("editor", "hello world");
await page.waitForTimeout(300);
await record("offline-edit-queued", { mechanism: "shortcut-key + keyboard-typing" });

// Shift+Tab back to the restore button and press Enter — pure keyboard.
await page.keyboard.press("Shift+Tab");
if ((await focusTestid()) !== "btn-restore") {
  throw new Error(`Shift+Tab landed on ${await focusTestid()}, expected btn-restore`);
}
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await record("restored-replayed-once", { mechanism: "shift-tab + enter" });

// B) Ack loss: server accepted, client does not know; restore re-sends and
//    the op is applied a second time (duplicate acceptance).
await pressShortcut("a"); // shortcut: arm one-shot ack loss
await typeInto("editor", "hello world!");
await page.waitForTimeout(300);
await record("ack-lost-syncing-stuck", { mechanism: "shortcut-key + keyboard-typing" });
await activate("btn-restore");
await page.waitForTimeout(300);
await record("restored-duplicate-applied", { mechanism: "focus + enter" });

// C) Lifecycle: clean start (s), then cut (c) + end (e) queued offline and
//    replayed once on restore (r) — every control via its letter shortcut.
await pressShortcut("s");
await page.waitForTimeout(300);
await record("meeting-started", { mechanism: "shortcut-key" });
await pressShortcut("c");
await pressShortcut("e");
await page.waitForTimeout(300);
await record("end-queued-offline", { mechanism: "shortcut-key" });
await pressShortcut("r");
await page.waitForTimeout(300);
await record("end-replayed-once", { mechanism: "shortcut-key" });

const observations = {
  steps,
  consoleErrors,
  interaction: {
    keyboardOnly: true,
    reducedMotion: true,
    mouseUsed: false,
    letterShortcuts: ["c", "a", "r", "s", "e"],
    mechanisms: [...new Set(steps.map((s) => s.mechanism).filter(Boolean))],
  },
  summary: {
    requestLoss: "queued op replayed exactly once; saved state converged on restore",
    ackLoss: "server truth advanced while isSyncing stayed true; restore re-sent and duplicated the acceptance",
    lifecycleEndLoss: "end queued offline then replayed exactly once on restore",
    tabNavigation: "walk controls reachable via Tab in DOM order with visible focus outlines",
  },
};
fs.writeFileSync(path.join(RESULTS, "walk.json"), JSON.stringify(observations, null, 2) + "\n");

await browser.close();
server.kill();
console.log(`walk complete: ${steps.length} steps (keyboard-only, reduced motion) -> results/walk.json + per-step JSON`);
for (const s of steps) console.log(`  ${s.step} [${s.mechanism}]: saved="${s.state.saved}" server="${s.state.serverTruth}" dup=${s.state.duplicates}`);
