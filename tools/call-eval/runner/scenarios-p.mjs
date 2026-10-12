/// <reference lib="dom" />
// In-page code below runs in the browser through page.evaluate.
/**
 * P-01..P-05 polish checks on the bench page. Connected and ended states come
 * from a real two-peer call (A joins with B, and ended is A clicking Leave).
 * The lobby is a real pre-join page (?autojoin=0). Reconnecting and failed are
 * forced through ?state=, because neither holds still long enough on a healthy
 * reference call to screenshot; each check still reads [data-call-phase] and
 * fails if the page is not in the state it claims to show.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScenarioError, waitFor, waitForValue, phaseIs, click, leaveCall, joinPair } from "./scenario-kit.mjs";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
const SCREENSHOTS_DIR = path.join(OUT_DIR, "screenshots");

const STATES = ["lobby", "connected", "reconnecting", "failed", "ended"];
const EXPECTED_PHASE = { lobby: "idle", connected: "connected", reconnecting: "reconnecting", failed: "failed", ended: "left" };

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

/**
 * Put peer A in the named state and verify it. Returns A plus every other
 * peer the caller must close.
 * @param {import('./context.mjs').RunContext} ctx
 * @param {string} stateName
 * @param {Record<string, string>} [params]
 */
async function openState(ctx, stateName, params = {}) {
  /** @type {any} */
  let peer;
  /** @type {any[]} */
  const others = [];
  if (stateName === "lobby") {
    peer = await ctx.launchPeer("A", { autojoin: "0", ...params });
    await peer.page.waitForSelector('[data-testid="join-call"]', { timeout: 30000 });
  } else if (stateName === "connected" || stateName === "ended") {
    const pair = await joinPair(ctx, { paramsA: params });
    peer = pair.peerA;
    others.push(pair.peerB);
    if (stateName === "ended") {
      await leaveCall(peer);
      await waitFor(peer, phaseIs("left"), { timeoutMs: 5000, describe: "A's phase left" });
    }
  } else if (ctx.page === "real") {
    // The real page has no forced states, so reach them for real: join, then
    // refuse every new signaling connection from A and drop its socket. A
    // reconnects in vain (reconnecting), and gives up after 45 s (failed).
    const pair = await joinPair(ctx, { paramsA: params });
    peer = pair.peerA;
    others.push(pair.peerB);
    await peer.page.routeWebSocket(/.*/, (/** @type {{ close: () => Promise<void> }} */ ws) => void ws.close());
    await ctx.killPeerSocket("A");
  } else {
    peer = await ctx.launchPeer("A", { state: stateName, autojoin: "0", ...params });
  }
  const expected = /** @type {Record<string, string>} */ (EXPECTED_PHASE)[stateName];
  const reachMs = ctx.page === "real" && stateName === "failed" ? 70000 : 10000;
  await waitFor(peer, phaseIs(expected), { timeoutMs: reachMs, describe: `phase ${expected} for state ${stateName}` });
  return { peer, others, close: () => Promise.allSettled([peer, ...others].map((/** @type {{ close: () => Promise<void> }} */ p) => p.close())) };
}

function assertLayoutIntact(viewport, label) {
  return (page) =>
    page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      scrollH: document.documentElement.scrollHeight,
    })).then((m) => {
      if (m.scrollW > m.clientW + 1) {
        throw new ScenarioError(`${label}: horizontal overflow (${m.scrollW} > ${m.clientW}) at ${viewport.width}x${viewport.height}`, m);
      }
      return m;
    });
}

/** P-01 — lobby, connected, reconnecting, failed and ended states at 1440x900 and 390x844, screenshots committed */
export async function scenario_P_01(ctx) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const shots = [];
  for (const stateName of STATES) {
    const opened = await openState(ctx, stateName);
    try {
      for (const viewport of VIEWPORTS) {
        await opened.peer.page.setViewportSize(viewport);
        await assertLayoutIntact(viewport, `P-01 ${stateName}`)(opened.peer.page);
        const file = path.join(SCREENSHOTS_DIR, `p01-${stateName}-${viewport.width}x${viewport.height}.png`);
        await opened.peer.page.screenshot({ path: file, fullPage: false });
        shots.push(path.relative(path.resolve(OUT_DIR, "..", "..", ".."), file));
      }
    } finally {
      await opened.close();
    }
  }
  return { states: STATES, viewports: VIEWPORTS.map((v) => `${v.width}x${v.height}`), screenshots: shots };
}

/** P-02 — axe shows no serious or critical violations in any state */
export async function scenario_P_02(ctx) {
  const { AxeBuilder } = await import("@axe-core/playwright");
  const allStates = [];
  /** @type {any[]} */
  const shellFindings = [];
  for (const stateName of STATES) {
    const opened = await openState(ctx, stateName);
    try {
      await opened.peer.page.setViewportSize({ width: 1440, height: 900 });
      // On the real page, axe covers the call itself; the app shell around
      // it is someone else's code, so its findings are recorded, not scored.
      const builder = new AxeBuilder({ page: opened.peer.page });
      if (ctx.page === "real") builder.include("[data-call-phase]");
      const results = await builder.analyze();
      if (ctx.page === "real") {
        const shell = await new AxeBuilder({ page: opened.peer.page }).exclude("[data-call-phase]").analyze();
        shellFindings.push({
          state: stateName,
          seriousOrCritical: shell.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}(${v.nodes.length})`),
        });
      }
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      if (bad.length) {
        throw new ScenarioError(
          `P-02: axe ${bad.length} serious/critical violations in state ${stateName}: ${bad.map((v) => `${v.id}(${v.nodes.length})`).join(", ")}`,
          { stateName, violations: bad.map((v) => ({ id: v.id, impact: v.impact })) },
        );
      }
      allStates.push({ state: stateName, violations: results.violations.length, passes: results.passes?.length ?? 0 });
    } finally {
      await opened.close();
    }
  }
  return { states: allStates, ...(ctx.page === "real" ? { appShellFindings: shellFindings } : {}) };
}

const focusedId = `() => { const el = document.activeElement; return el && el !== document.body ? el.getAttribute('data-testid') || el.tagName.toLowerCase() : null; }`;
const focusIndicator = `() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { visible: false };
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
  const ring = (cs.boxShadow ?? "none") !== "none";
  return { visible: outline || ring, outline, ring, focusVisible: el.matches(":focus-visible") };
}`;
// A toggle's state as announced: its accessible label when it has one (the
// real page's icon buttons), else its visible text (the bench).
const buttonText = (/** @type {string} */ id) =>
  `() => { const el = document.querySelector('[data-testid="${id}"]'); return el ? el.getAttribute('aria-label') || el.textContent.trim() : null; }`;
const localVideoTrackId = `() => document.querySelector('[data-testid="local-video"]')?.srcObject?.getVideoTracks()[0]?.id ?? null`;

/**
 * Tab from wherever focus is until `id` has focus; fails if it never does.
 * @param {{ page: import('@playwright/test').Page, peerId: string }} peer @param {string} id
 */
async function tabTo(peer, id) {
  for (let i = 0; i < 25; i++) {
    await peer.page.keyboard.press("Tab");
    if ((await peer.page.evaluate(`(${focusedId})()`)) === id) return;
  }
  throw new ScenarioError(`P-03: ${id} is not reachable by Tab`);
}

/** P-03 — every control is reachable and operable by keyboard, with visible focus */
export async function scenario_P_03(ctx) {
  /** @type {any[]} */
  const results = [];
  const opened = await openState(ctx, "connected");
  const peer = opened.peer;
  try {
    await peer.page.setViewportSize({ width: 1440, height: 900 });
    /** @param {string} id @param {string} key @param {() => Promise<unknown>} effect */
    const operate = async (id, key, effect) => {
      await peer.page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
      await tabTo(peer, id);
      const indicator = await peer.page.evaluate(`(${focusIndicator})()`);
      if (!indicator.visible) throw new ScenarioError(`P-03: ${id} has no visible focus indicator`, indicator);
      await peer.page.keyboard.press(key);
      const observed = await effect();
      results.push({ id, key, indicator, observed });
    };
    const textBefore = (/** @type {string} */ id) => peer.page.evaluate(`(${buttonText(id)})()`);
    const textChanges = (/** @type {string} */ id, /** @type {string} */ before) =>
      waitForValue(peer, buttonText(id), (/** @type {string} */ t) => t !== before, { timeoutMs: 3000, describe: `${id} label changes` });

    for (const id of ["toggle-mic", "toggle-camera"]) {
      const before = await textBefore(id);
      await operate(id, "Enter", () => textChanges(id, before));
      const flipped = await textBefore(id);
      await operate(id, " ", () => textChanges(id, flipped));
    }
    if (ctx.page === "real") {
      // The real page switches devices from a settings popover: Enter opens
      // it with the device pickers, Escape closes it and returns focus.
      await operate("device-settings", "Enter", async () => {
        await peer.page.waitForSelector("#device-camera", { state: "visible", timeout: 3000 });
        await peer.page.keyboard.press("Escape");
        await peer.page.waitForSelector("#device-camera", { state: "detached", timeout: 3000 });
        const back = await peer.page.evaluate(`(${focusedId})()`);
        if (back !== "device-settings") throw new ScenarioError(`P-03: Escape left focus on ${back}, not device-settings`);
        return "popover opened and closed";
      });
    } else {
      const trackBefore = await peer.page.evaluate(`(${localVideoTrackId})()`);
      await operate("switch-camera", "Enter", () =>
        waitForValue(peer, localVideoTrackId, (/** @type {string | null} */ t) => !!t && t !== trackBefore, { timeoutMs: 5000, describe: "local video track replaced" }),
      );
    }
    await operate("leave-call", "Enter", async () => {
      // The real call page asks first: reach "Leave call" in the dialog by
      // keyboard and confirm it. The bench leaves on the first press.
      const confirm = await peer.page
        .waitForSelector('[data-testid="leave-call-confirm"]', { timeout: 1500 })
        .catch(() => null);
      if (confirm) await tabTo(peer, "leave-call-confirm").then(() => peer.page.keyboard.press("Enter"));
      return waitFor(peer, phaseIs("left"), { timeoutMs: 5000, describe: "phase left" });
    });
    await operate("join-call", "Enter", async () => {
      // The real page's Rejoin returns to the lobby first; Join call there.
      const settled = `() => { const p = document.querySelector('[data-call-phase]')?.getAttribute('data-call-phase'); return p === 'connected' || p === 'idle' ? p : null; }`;
      const phase = await waitFor(peer, settled, { timeoutMs: 30000, describe: "rejoined or back in the lobby" });
      if (phase === "idle") {
        await peer.page.waitForSelector('[data-testid="join-call"]:not([disabled])', { timeout: 15000 });
        await tabTo(peer, "join-call");
        await peer.page.keyboard.press("Enter");
      }
      return waitFor(peer, phaseIs("connected"), { timeoutMs: 30000, describe: "rejoined" });
    });
  } finally {
    await opened.close();
  }

  // The failed-capture state: retry-media must be reachable and operable by
  // keyboard too. A runs the full Chromium build with no fake-UI flag, so its
  // camera prompt is really denied; granting and pressing Enter must clear
  // the error.
  const denied = await ctx.launchPeer("A", {}, undefined, { fullChromium: true });
  try {
    await denied.page.setViewportSize({ width: 1440, height: 900 });
    await denied.page.waitForSelector('[data-testid="retry-media"]', { timeout: 20000 });
    await denied.page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
    await tabTo(denied, "retry-media");
    const indicator = await denied.page.evaluate(`(${focusIndicator})()`);
    if (!indicator.visible) throw new ScenarioError("P-03: retry-media has no visible focus indicator", indicator);
    await denied.context.grantPermissions(["camera", "microphone"], { origin: ctx.url });
    await denied.page.keyboard.press("Enter");
    await waitFor(denied, `() => !document.querySelector('[data-testid="retry-media"]') && !document.querySelector('[data-testid="call-error"]')?.textContent`, {
      timeoutMs: 15000,
      describe: "retry-media by keyboard clears the capture error",
    });
    results.push({ id: "retry-media", key: "Enter", indicator, observed: "capture error cleared" });
  } finally {
    await denied.close();
  }
  return { controls: results };
}

/** P-04 — prefers-reduced-motion removes non-essential motion */
export async function scenario_P_04(ctx) {
  const opened = await openState(ctx, "connected");
  const peer = opened.peer;
  try {
    await peer.page.setViewportSize({ width: 1440, height: 900 });
    await peer.page.emulateMedia({ reducedMotion: "reduce" });
    // Hover and focus every control so transitions that only run on
    // interaction get a chance to start.
    for (const id of ["toggle-mic", "toggle-camera", "leave-call"]) await peer.page.hover(`[data-testid="${id}"]`);
    const check = await peer.page.evaluate(() => {
      const anims = document.getAnimations();
      const durations = anims.map((a) => {
        const t = a.effect?.getTiming?.() ?? {};
        return typeof t.duration === "number" ? t.duration : 0;
      });
      const mq = matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Movement only: color and opacity fades stay under reduced motion.
      const MOTION = /^(all|transform|translate|scale|rotate|top|left|right|bottom|margin.*|inset.*)$/;
      const transitions = [...document.querySelectorAll("button")].flatMap((b) => {
        const cs = getComputedStyle(b);
        const props = cs.transitionProperty.split(",").map((x) => x.trim());
        const durs = cs.transitionDuration.split(",").map((x) => parseFloat(x));
        return props.map((prop, i) => ({ prop, s: durs[i % durs.length] })).filter((t) => MOTION.test(t.prop) && t.s > 0.05).map((t) => `${t.prop} ${t.s}s`);
      });
      return { mq, animationCount: anims.length, maxDurationMs: durations.length ? Math.max(...durations) : 0, transitions };
    });
    if (!check.mq) throw new ScenarioError("P-04: reduced-motion media query not active", check);
    if (check.animationCount > 0 && check.maxDurationMs > 50) {
      throw new ScenarioError(`P-04: ${check.animationCount} animations still run (max ${check.maxDurationMs} ms)`, check);
    }
    const moving = check.transitions;
    if (moving.length) throw new ScenarioError(`P-04: ${moving.length} buttons keep transitions under reduced motion`, check);
    return { ...check };
  } finally {
    await opened.close();
  }
}

/** P-05 — long names (40+ characters), missing avatar and a slow join (5 s) keep the layout intact */
export async function scenario_P_05(ctx) {
  const longName = "LongDisplayNameParticipantFromInternationalStudies";
  const viewport = { width: 390, height: 844 };
  const results = [];
  /** @type {Array<{ label: string, params: Record<string, string> }>} */
  const cases = [
    { label: "long-name", params: { name: longName } },
    { label: "missing-avatar", params: { avatar: "0" } },
  ];
  for (const c of cases) {
    const opened = await openState(ctx, "connected", c.params);
    try {
      await opened.peer.page.setViewportSize(viewport);
      results.push({ label: c.label, connected: await assertLayoutIntact(viewport, `P-05 ${c.label}`)(opened.peer.page) });
    } finally {
      await opened.close();
    }
  }

  // Slow join: A auto-joins after a 5 s delay (the bench's delayJoin path),
  // B is already in the call. The layout must hold while A waits and after.
  const peerB = await ctx.launchPeer("B");
  const t0 = Date.now();
  const peerA = await ctx.launchPeer("A", { delayJoin: "5000" });
  try {
    await peerA.page.setViewportSize(viewport);
    await new Promise((r) => setTimeout(r, 1500));
    const waitingPhase = await peerA.page.evaluate(`(() => document.querySelector('[data-call-phase]')?.getAttribute('data-call-phase'))()`);
    if (waitingPhase !== "idle") throw new ScenarioError(`P-05 slow-join: phase ${waitingPhase} before the 5 s delay ran out`);
    const during = await assertLayoutIntact(viewport, "P-05 slow-join waiting")(peerA.page);
    await waitFor(peerA, phaseIs("connected"), { timeoutMs: 40000, describe: "P-05 slow-join connected" });
    const joinMs = Date.now() - t0;
    if (joinMs < 5000) throw new ScenarioError(`P-05 slow-join: connected after ${joinMs} ms, so the 5 s delay never applied`);
    const after = await assertLayoutIntact(viewport, "P-05 slow-join connected")(peerA.page);
    const errorShown = await peerA.page.evaluate(`(() => { const el = document.querySelector('[data-testid="call-error"]'); return !!el && !el.hidden && el.textContent.length > 0; })()`);
    if (errorShown) throw new ScenarioError("P-05 slow-join: error box appeared");
    results.push({ label: "slow-join", joinMs, during, after });
  } finally {
    await Promise.allSettled([peerA.close(), peerB.close()]);
  }
  return { cases: results, nameLength: longName.length };
}
