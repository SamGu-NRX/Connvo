#!/usr/bin/env node
/**
 * The shared-notes panel's seven states on the real call page over Convex,
 * at 1440x900 and 390x844, with an axe audit of the notes column in each,
 * a keyboard-only pass and a reduced-motion check.
 *
 * Each state runs in a fresh browser for person A (O for the last), joined to
 * the call. States the network decides are produced by tapping A's Convex
 * WebSocket in Playwright (the page, the panel and the server are untouched):
 * - synced:        A types; nothing interferes.
 * - saving:        the notes mutation's answer and the notes query's updates
 *                  are held back, so A's words stay on their way.
 * - unconfirmed:   the notes mutation answers with a generic server error
 *                  (the server did apply it; the answer is what was lost),
 *                  and query updates are held back.
 * - offline:       A's Convex socket is cut and the browser goes offline.
 * - recovered:     as saving, then A reloads before anything was confirmed:
 *                  the words come back from the tab's recovery store.
 * - error:         the notes query fails on the server side of the socket.
 * - not a participant: O, who is not in the meeting, opens the call page.
 *
 * Needs the local backend and next dev from scripts/local-backend.mjs.
 *
 *   node tools/call-eval/scripts/notes-states-shots.mjs --base-url=http://localhost:3035 \
 *     [--out=docs/notes-ledger-f1/screenshots] [--results=docs/notes-ledger-f1/a11y-results.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createEvalMeeting } from "../runner/convex-signaling.mjs";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(EVAL_DIR, "..", "..");
const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const baseUrl = flags["base-url"] ?? "http://localhost:3035";
const outDir = path.resolve(REPO, flags.out ?? "docs/notes-ledger-f1/screenshots");
const resultsPath = path.resolve(REPO, flags.results ?? "docs/notes-ledger-f1/a11y-results.json");
fs.mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const EDITOR = '[data-testid="notes-editor"]';
const STATUS = '[data-testid="notes-status"]';
const NOTES = 'aside[aria-label="Meeting notes"]';
const SYNC_SOCKET = /\/api\/[^/]+\/sync$/;

/**
 * A's Convex socket, routed through Playwright so the run can hold or
 * rewrite the notes traffic. Everything else passes through unchanged.
 * @param {import('@playwright/test').BrowserContext} context
 */
async function tapConvex(context) {
  const mode = { holdNotes: false, failNotesMutation: false, failNotesQuery: false, cut: false };
  /** @type {Array<{ page: import('@playwright/test').WebSocketRoute, server: import('@playwright/test').WebSocketRoute }>} */
  const live = [];
  await context.routeWebSocket(SYNC_SOCKET, (ws) => {
    if (mode.cut) {
      void ws.close({ code: 1011, reason: "" });
      return;
    }
    const server = ws.connectToServer();
    const notesQueries = new Set();
    const notesMutations = new Set();
    live.push({ page: ws, server });
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "ModifyQuerySet") {
        for (const mod of msg.modifications ?? []) {
          if (mod.type === "Add" && String(mod.udfPath).includes("getMeetingNotes")) notesQueries.add(mod.queryId);
        }
      }
      if (msg.type === "Mutation" && String(msg.udfPath).includes("batchApplyNoteOperations")) {
        notesMutations.add(msg.requestId);
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "MutationResponse" && notesMutations.has(msg.requestId)) {
        if (mode.failNotesMutation) {
          ws.send(JSON.stringify({ type: "MutationResponse", requestId: msg.requestId, success: false, result: "Server Error", logLines: [] }));
          return;
        }
        if (mode.holdNotes) return; // the answer never arrives
      }
      if (msg.type === "Transition" && (mode.holdNotes || mode.failNotesMutation || mode.failNotesQuery)) {
        msg.modifications = (msg.modifications ?? []).flatMap((mod) => {
          if (!notesQueries.has(mod.queryId) || mod.type !== "QueryUpdated") return [mod];
          if (mode.failNotesQuery) {
            return [{ type: "QueryFailed", queryId: mod.queryId, errorMessage: "Server Error", logLines: [], journal: mod.journal ?? null }];
          }
          return []; // held: this update is not delivered
        });
        ws.send(JSON.stringify(msg));
        return;
      }
      ws.send(raw);
    });
    ws.onClose(() => void server.close().catch(() => {}));
    server.onClose(() => void ws.close().catch(() => {}));
  });
  return {
    mode,
    async cut() {
      mode.cut = true;
      await context.setOffline(true);
      for (const pair of live.splice(0)) {
        await pair.server.close().catch(() => {});
        await pair.page.close({ code: 1011, reason: "" }).catch(() => {});
      }
    },
  };
}

/** One person's browser on the call page, joined to the call. */
async function openPerson(id, meetingId, { reducedMotion = "no-preference", join = true } = {}) {
  // Chromium's built-in fake camera and microphone, not the harness fixture
  // files: a file-backed fake device is labelled with its file path, which
  // the lobby's device menu would show in the screenshot.
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  });
  const context = await browser.newContext({ viewport: VIEWPORTS[0], reducedMotion, deviceScaleFactor: 1 });
  const tap = await tapConvex(context);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/app/call/${meetingId}?as=${id}`, { waitUntil: "domcontentloaded" });
  if (join) {
    await page.locator('[data-testid="join-call"]:not([disabled])').click({ timeout: 60_000 });
    await page.waitForFunction(
      () => ["connected", "joining"].includes(document.querySelector("[data-call-phase]")?.getAttribute("data-call-phase") ?? ""),
      null,
      { timeout: 30_000 },
    );
  }
  return { browser, context, page, tap };
}

async function typeNotes(page, text) {
  const editor = page.locator(`${EDITOR}:not([disabled])`);
  await editor.waitFor({ timeout: 60_000 });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: 10 });
  await editor.blur();
}

const waitStatus = (page, re, timeout = 15_000) =>
  page.waitForFunction(
    ([sel, src]) => new RegExp(src, "i").test(document.querySelector(sel)?.textContent ?? ""),
    [STATUS, re.source],
    { timeout },
  );

/** Screenshots at both sizes with the notes in view, and an axe audit of the notes column. */
async function capture(page, name) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const shots = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    // Notes at the top of the view: on a phone they sit below the call, and
    // the app's floating navigation covers the bottom of the screen.
    await page.locator(NOTES).evaluate((el) => {
      window.scrollTo(0, 0);
      const box = el.getBoundingClientRect();
      if (box.bottom > window.innerHeight) {
        el.scrollIntoView({ block: "start" });
        window.scrollBy(0, -12);
      }
    });
    await page.waitForTimeout(450);
    const file = path.join(outDir, `${name}-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: file });
    shots.push(path.relative(REPO, file));
  }
  await page.setViewportSize(VIEWPORTS[0]);
  const axe = await new AxeBuilder({ page }).include(NOTES).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const status = (await page.locator(STATUS).textContent().catch(() => null)) ?? null;
  const unsaved = await page.locator('[data-testid="notes-unsaved-list"] li').allTextContents().catch(() => []);
  const notice = (await page.locator('[data-testid="notes-unavailable"]').textContent().catch(() => null)) ?? null;
  console.log(`${name}: status=${status ?? "-"} violations=${axe.violations.length}`);
  return {
    state: name,
    status,
    unsaved,
    notice,
    shots,
    axe: {
      violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
      passes: axe.passes.length,
      incomplete: axe.incomplete.map((v) => v.id),
    },
  };
}

const results = { baseUrl, ranAt: new Date().toISOString(), states: [], keyboard: null, reducedMotion: null };
const meetingId = createEvalMeeting("notes states");
const opened = [];
const person = async (...args) => {
  const p = await openPerson(...args);
  opened.push(p);
  return p;
};

try {
  // synced
  {
    const a = await person("A", meetingId);
    await typeNotes(a.page, "Agenda: budget review. Owner: Bob. ");
    await waitStatus(a.page, /synced/);
    results.states.push(await capture(a.page, "synced"));

    // Keyboard only, from the top of the page: Tab until the editor has
    // focus, then Tab on (focus must leave the editor), then Shift+Tab back
    // into it and once more back to the call controls.
    await a.page.locator("body").click({ position: { x: 5, y: 5 } });
    const describe = () =>
      a.page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "body";
        return `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}${el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : el.textContent?.trim() ? ` "${el.textContent.trim().slice(0, 30)}"` : ""}`;
      });
    const path_ = [];
    let reachedEditor = false;
    for (let i = 0; i < 40 && !reachedEditor; i++) {
      await a.page.keyboard.press("Tab");
      const here = await describe();
      path_.push(here);
      reachedEditor = here.includes("notes-editor");
    }
    const focusVisible = reachedEditor
      ? await a.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          const style = el && getComputedStyle(el);
          return !!style && (style.boxShadow !== "none" || style.outlineStyle !== "none");
        }, EDITOR)
      : false;
    await a.page.keyboard.press("Tab");
    const afterEditor = await describe();
    await a.page.keyboard.press("Shift+Tab");
    const backIn = await describe();
    await a.page.keyboard.press("Shift+Tab");
    const beforeEditor = await describe();
    results.keyboard = {
      tabsToEditor: path_.length,
      path: path_,
      reachedEditor,
      editorShowsFocus: focusVisible,
      tabFromEditorGoesTo: afterEditor,
      leftEditor: !afterEditor.includes("notes-editor"),
      shiftTabReturnsTo: backIn,
      shiftTabFromEditorGoesTo: beforeEditor,
      reachesCallControls: path_.some((p) => /leave-call|toggle-mic|toggle-camera|device-settings/.test(p)),
    };
    await a.browser.close();
  }

  // saving
  {
    const a = await person("A", meetingId);
    await a.page.locator(`${EDITOR}:not([disabled])`).waitFor({ timeout: 60_000 });
    await waitStatus(a.page, /synced/);
    a.tap.mode.holdNotes = true;
    await typeNotes(a.page, "Decision: ship Friday. ");
    await waitStatus(a.page, /saving/);
    await a.page.waitForTimeout(1500);
    results.states.push(await capture(a.page, "saving"));

    // recovered: reload before anything was confirmed.
    await a.page.reload({ waitUntil: "domcontentloaded" });
    await a.page.locator('[data-testid="join-call"]:not([disabled])').click({ timeout: 60_000 });
    await a.page.locator(`${EDITOR}`).waitFor({ timeout: 60_000 });
    await a.page.waitForFunction((sel) => document.querySelector(sel)?.value.includes("Decision: ship Friday."), EDITOR, {
      timeout: 30_000,
    });
    results.states.push(await capture(a.page, "recovered"));
    await a.browser.close();
  }

  // unconfirmed
  {
    const a = await person("A", meetingId);
    await a.page.locator(`${EDITOR}:not([disabled])`).waitFor({ timeout: 60_000 });
    await waitStatus(a.page, /synced/);
    a.tap.mode.failNotesMutation = true;
    await typeNotes(a.page, "Risk: vendor delay. ");
    await waitStatus(a.page, /unconfirmed/);
    results.states.push(await capture(a.page, "unconfirmed"));
    await a.browser.close();
  }

  // offline
  {
    const a = await person("A", meetingId);
    await a.page.locator(`${EDITOR}:not([disabled])`).waitFor({ timeout: 60_000 });
    await waitStatus(a.page, /synced/);
    await a.tap.cut();
    await waitStatus(a.page, /offline/, 20_000);
    await typeNotes(a.page, "Written offline. ");
    results.states.push(await capture(a.page, "offline"));
    await a.browser.close();
  }

  // error
  {
    const a = await person("A", meetingId, { join: false });
    a.tap.mode.failNotesQuery = true;
    await a.page.reload({ waitUntil: "domcontentloaded" });
    await a.page.locator('[data-testid="join-call"]:not([disabled])').click({ timeout: 60_000 });
    await a.page.locator('[data-testid="notes-unavailable"]').waitFor({ timeout: 30_000 });
    results.states.push(await capture(a.page, "error"));
    await a.browser.close();
  }

  // not a participant
  {
    const o = await person("O", meetingId, { join: false });
    await o.page.locator('[data-testid="notes-unavailable"]').waitFor({ timeout: 60_000 });
    results.states.push(await capture(o.page, "not-a-participant"));
    await o.browser.close();
  }

  // reduced motion: the panel renders without its entrance animation.
  {
    const reduced = await person("A", meetingId, { reducedMotion: "reduce", join: false });
    await reduced.page.locator(`${EDITOR}:not([disabled])`).waitFor({ timeout: 60_000 });
    const motionReduced = await reduced.page.locator('[data-motion="fade-rise"]').count();
    const full = await person("A", meetingId, { join: false });
    await full.page.locator(`${EDITOR}:not([disabled])`).waitFor({ timeout: 60_000 });
    const motionFull = await full.page.locator('[data-motion="fade-rise"]').count();
    results.reducedMotion = {
      animatedElementsWithReduce: motionReduced,
      animatedElementsWithoutPreference: motionFull,
      pass: motionReduced === 0 && motionFull > 0,
    };
  }
} finally {
  await Promise.allSettled(opened.map((p) => p.browser.close()));
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + "\n");
}

const violations = results.states.reduce((n, s) => n + s.axe.violations.length, 0);
const ok =
  results.states.length === 7 &&
  violations === 0 &&
  results.keyboard?.reachedEditor &&
  results.keyboard?.leftEditor &&
  results.reducedMotion?.pass;
console.log(`states=${results.states.length} axe violations=${violations} keyboard=${JSON.stringify(results.keyboard && { reached: results.keyboard.reachedEditor, left: results.keyboard.leftEditor })} reducedMotion=${results.reducedMotion?.pass}`);
process.exit(ok ? 0 : 1);
