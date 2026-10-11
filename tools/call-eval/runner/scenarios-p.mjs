/**
 * P-01..P-05 polish checks against the same URL as the H scenarios (the mock
 * page by default; the real bench route at integration). Visual states are
 * driven by the bench query conventions: ?state=failed|reconnecting|ended,
 * ?autojoin=0 for the lobby, ?name=, ?avatar=0 and ?delayJoin=<ms>.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScenarioError, waitFor, phaseIs } from "./scenario-kit.mjs";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
const SCREENSHOTS_DIR = path.join(OUT_DIR, "screenshots");

const STATE_PARAMS = {
  lobby: { autojoin: "0" },
  connected: {},
  reconnecting: { state: "reconnecting" },
  failed: { state: "failed" },
  ended: { state: "ended" },
};

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

async function openState(ctx, stateName, params = {}) {
  const peer = await ctx.launchPeer("A", { ...STATE_PARAMS[stateName], ...params });
  const settle = { lobby: 1500, connected: 1500, reconnecting: 2500, failed: 2500, ended: 2500 }[stateName] ?? 1500;
  await new Promise((r) => setTimeout(r, settle));
  return peer;
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
  for (const viewport of VIEWPORTS) {
    for (const stateName of Object.keys(STATE_PARAMS)) {
      const peer = await openState(ctx, stateName);
      try {
        await peer.page.setViewportSize({ width: viewport.width, height: viewport.height });
        await assertLayoutIntact(viewport, `P-01 ${stateName}`)(peer.page);
        const file = path.join(SCREENSHOTS_DIR, `p01-${stateName}-${viewport.width}x${viewport.height}.png`);
        await peer.page.screenshot({ path: file, fullPage: false });
        shots.push(path.relative(path.resolve(OUT_DIR, "..", "..", ".."), file));
      } finally {
        await peer.close();
      }
    }
  }
  return { states: Object.keys(STATE_PARAMS), viewports: VIEWPORTS.map((v) => `${v.width}x${v.height}`), screenshots: shots };
}

/** P-02 — axe shows no serious or critical violations in any state */
export async function scenario_P_02(ctx) {
  const { AxeBuilder } = await import("@axe-core/playwright");
  const allStates = [];
  for (const stateName of Object.keys(STATE_PARAMS)) {
    const peer = await openState(ctx, stateName);
    try {
      await peer.page.setViewportSize({ width: 1440, height: 900 });
      const results = await new AxeBuilder({ page: peer.page }).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      if (bad.length) {
        throw new ScenarioError(
          `P-02: axe ${bad.length} serious/critical violations in state ${stateName}: ${bad.map((v) => `${v.id}(${v.nodes.length})`).join(", ")}`,
          { stateName, violations: bad.map((v) => ({ id: v.id, impact: v.impact })) },
        );
      }
      allStates.push({ state: stateName, violations: results.violations.length, passes: results.passes?.length ?? 0 });
    } finally {
      await peer.close();
    }
  }
  return { states: allStates };
}

/** P-03 — every control is reachable and operable by keyboard, with visible focus */
export async function scenario_P_03(ctx) {
  const peer = await openState(ctx, "connected");
  try {
    await peer.page.setViewportSize({ width: 1440, height: 900 });
    const interactive = await peer.page.evaluate(
      `() => [...document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null)
        .map(el => el.getAttribute('data-testid') || el.tagName.toLowerCase())`,
    );
    if (!interactive.length) throw new ScenarioError("P-03: no interactive controls found");

    const focused = [];
    for (let i = 0; i < interactive.length + 3; i++) {
      await peer.page.keyboard.press("Tab");
      const cur = await peer.page.evaluate(
        `() => { const el = document.activeElement; return el ? (el.getAttribute('data-testid') || el.tagName.toLowerCase()) : null; }`,
      );
      focused.push(cur);
      if (focused.filter(Boolean).length >= interactive.length) break;
    }
    const missing = interactive.filter((id) => !focused.includes(id));
    if (missing.length) {
      throw new ScenarioError(`P-03: controls not reachable by keyboard: ${missing.join(", ")}`, { interactive, focused });
    }

    const focusVisible = await peer.page.evaluate(`() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { visible: false, reason: "no focused element" };
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const ring = (cs.boxShadow ?? "none") !== "none";
      const el2 = el;
      const pseudo = getComputedStyle(el2, "::after");
      return { visible: outline || ring || pseudo.content !== "none", outline, ring };
    }`);
    if (!focusVisible.visible) {
      throw new ScenarioError("P-03: focused control has no visible focus indicator", focusVisible);
    }
    return { interactive, focusedOrder: focused, focusVisible };
  } finally {
    await peer.close();
  }
}

/** P-04 — prefers-reduced-motion removes non-essential motion */
export async function scenario_P_04(ctx) {
  const peer = await ctx.launchPeer("A", {});
  try {
    // Playwright applies reducedMotion at the context level; emulate per page
    // here so the default context setup stays untouched.
    await peer.page.setViewportSize({ width: 1440, height: 900 });
    await peer.page.emulateMedia({ reducedMotion: "reduce" });
    await waitFor(peer, phaseIs("connected"), { timeoutMs: 30000, describe: "connected under reduced motion" });
    const check = await peer.page.evaluate(() => {
      const anims = document.getAnimations();
      const durations = anims.map((a) => {
        const t = a.effect?.getTiming?.() ?? {};
        return typeof t.duration === "number" ? t.duration : 0;
      });
      const mq = matchMedia("(prefers-reduced-motion: reduce)").matches;
      return { mq, animationCount: anims.length, maxDurationMs: durations.length ? Math.max(...durations) : 0 };
    });
    if (!check.mq) throw new ScenarioError("P-04: reduced-motion media query not active", check);
    if (check.animationCount > 0 && check.maxDurationMs > 50) {
      throw new ScenarioError(`P-04: ${check.animationCount} animations still run (max ${check.maxDurationMs} ms)`, check);
    }
    return { ...check };
  } finally {
    await peer.close();
  }
}

/** P-05 — long names (40+ characters), missing avatar and a slow join (5 s) keep the layout intact */
export async function scenario_P_05(ctx) {
  const longName = "LongDisplayNameParticipantFromInternationalStudies";
  const cases = [
    { label: "long-name", params: { name: longName }, expectConnected: true },
    { label: "missing-avatar", params: { avatar: "0" }, expectConnected: true },
    { label: "slow-join", params: { delayJoin: "5000" }, expectConnected: true },
  ];
  const results = [];
  for (const c of cases) {
    const peer = await openState(ctx, "lobby", c.params);
    try {
      await peer.page.setViewportSize({ width: 1440, height: 900 });
      const layout = await assertLayoutIntact({ width: 1440, height: 900 }, `P-05 ${c.label} lobby`)(peer.page);
      await waitFor(peer, phaseIs("connected"), { timeoutMs: 30000, describe: `P-05 ${c.label} connected` });
      const post = await assertLayoutIntact({ width: 1440, height: 900 }, `P-05 ${c.label} connected`)(peer.page);
      const errorShown = await peer.page.evaluate(
        `() => { const el = document.querySelector('[data-testid="call-error"]'); return !!el && !el.hidden && el.textContent.length > 0; }`,
      );
      if (errorShown) throw new ScenarioError(`P-05 ${c.label}: error box appeared`, { errorShown });
      results.push({ label: c.label, lobby: layout, connected: post });
    } finally {
      await peer.close();
    }
  }
  return { cases: results, nameLength: longName.length };
}
