#!/usr/bin/env node
/**
 * After a call, over Convex, on the real pages: A and B take notes in a call
 * and leave; both see the same recap with those notes; O, who was not in the
 * meeting, cannot open it. Along the way every after-call state is captured
 * at 1440x900 and 390x844 and audited with axe. Where axe cannot judge text
 * contrast it is measured from pixels, and the recap and list pages are
 * walked with Tab and Shift+Tab, with the calendar button, the stay-in-touch
 * switch and a list row activated from the keyboard (a11y-manual.mjs).
 *
 * Needs the local backend and next dev from
 *   node tools/call-eval/scripts/local-backend.mjs --port=3035 --after-call
 *
 *   node tools/call-eval/scripts/after-call-proof.mjs --base-url=http://localhost:3035 \
 *     [--shots=docs/after-call/browser-proof] [--out=docs/after-call/browser-proof]
 */
import fs from "node:fs";
import { keyboardLeave, captureFocusControl } from "./after-call-keyboard.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import ICAL from "ical.js";
import { createEvalMeeting, storedNotes } from "../runner/convex-signaling.mjs";
import { tapConvex } from "../runner/convex-tap.mjs";
import { keyboardWalk, tabTo, textContrast, assertShellMeasurements } from "./a11y-manual.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const baseUrl = flags["base-url"] ?? "http://localhost:3035";
const shotsDir = path.resolve(REPO, flags.shots ?? "docs/after-call/browser-proof");
const outDir = path.resolve(REPO, flags.out ?? "docs/after-call/browser-proof");
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const EDITOR = '[data-testid="notes-editor"]';

/** @type {import('@playwright/test').Browser[]} */
const browsers = [];
async function person(id) {
  // Chromium's built-in fake devices (a file-backed one is labelled with
  // its file path, which the lobby would show).
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: VIEWPORTS[0], deviceScaleFactor: 1, acceptDownloads: true });
  const tap = await tapConvex(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`[pageerror ${id}]`, e.message.slice(0, 200)));
  // A blank page in its own context for decoding screenshots (a11y-manual.mjs).
  const scratch = await browser.newPage();
  return { id, browser, context, page, tap, scratch };
}

async function joinCall(page, meetingId, id) {
  await page.goto(`${baseUrl}/app/call/${meetingId}?as=${id}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="join-call"]:not([disabled])').click({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector("[data-call-phase]")?.getAttribute("data-call-phase") === "connected", null, {
    timeout: 45_000,
  });
}

async function typeNotes(page, where, text) {
  const editor = page.locator(`${EDITOR}:not([disabled])`);
  await editor.waitFor({ timeout: 60_000 });
  await editor.click();
  await editor.evaluate((el, at) => {
    const ta = /** @type {HTMLTextAreaElement} */ (el);
    const pos = at === "start" ? 0 : ta.value.length;
    ta.setSelectionRange(pos, pos);
  }, where);
  await page.keyboard.type(text, { delay: 10 });
  await editor.blur();
}

async function leave(page) {
  await page.click('[data-testid="leave-call"]');
  await page.click('[data-testid="leave-call-confirm"]');
  await page.waitForFunction(() => document.querySelector("[data-call-phase]")?.getAttribute("data-call-phase") === "left", null, {
    timeout: 10_000,
  });
}

const a11y = [];
/**
 * Screenshots at both sizes with `focus` in view, an axe audit of `scope`,
 * and a pixel contrast check of every node axe left incomplete.
 */
async function capture({ page, scratch }, name, { focus, scope }) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const shots = [];
  /** @type {Record<string, unknown[]>} */
  const violations = {};
  /** @type {Record<string, Awaited<ReturnType<typeof textContrast>>>} */
  const measured = {};
  let passes = 0;
  const incomplete = new Set();
  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    if (focus) {
      await page.locator(focus).first().evaluate((el) => {
        window.scrollTo(0, 0);
        if (el.getBoundingClientRect().bottom > window.innerHeight) {
          el.scrollIntoView({ block: "start" });
          window.scrollBy(0, -12);
        }
      });
    }
    await page.waitForTimeout(450);
    const file = path.join(shotsDir, `${name}-${size}.png`);
    await page.screenshot({ path: file });
    shots.push(path.relative(REPO, file));
    // axe runs at each size: elements shown only on a phone (the mobile
    // navigation) or only on a desktop are judged where they are visible.
    const axe = await new AxeBuilder({ page }).include(scope).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    violations[size] = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
    passes = Math.max(passes, axe.passes.length);
    axe.incomplete.forEach((v) => incomplete.add(v.id));
    const unjudged = axe.incomplete
      .filter((v) => v.id === "color-contrast")
      .flatMap((v) => v.nodes.map((n) => n.target))
      .filter((t) => t.length === 1 && typeof t[0] === "string")
      .map((t) => /** @type {string} */ (t[0]));
    // Measure shell text even when axe has already judged it: these labels
    // previously failed on every page and must remain part of acceptance.
    const shellText = await page.locator([
      '[data-testid="app-wordmark"]',
      '[data-testid="desktop-navigation"] p',
      '[data-testid="desktop-navigation"] a > span:last-child > span',
      '[data-testid="desktop-navigation"] button',
      '[data-testid="mobile-navigation"] a > span:last-child',
    ].join(", ")).evaluateAll(
      (/** @type {{ setAttribute(name: string, value: string): void }[]} */ nodes) =>
        nodes.map((node, index) => {
          node.setAttribute("data-shell-contrast", String(index));
          return `[data-shell-contrast="${index}"]`;
        }),
    );
    if (shellText.length === 0) throw new Error(`No shell contrast targets at ${size} in ${name}`);
    measured[size] = await textContrast(page, scratch, [...new Set([...unjudged, ...shellText])]);
    assertShellMeasurements(measured[size]);
  }
  await page.setViewportSize(VIEWPORTS[0]);
  // Keep shell failures separate in the receipt, but fail on either group.
  const contrastFailures = Object.values(measured).flat().filter((row) => !row.pass && row.inPage);
  const shellContrastFailures = Object.values(measured).flat().filter((row) => !row.pass && !row.inPage);
  const violationCount = Object.values(violations).flat().length;
  a11y.push({
    state: name,
    shots,
    violations,
    violationCount,
    passes,
    incomplete: [...incomplete],
    contrastMeasured: measured,
    contrastFailures,
    shellContrastFailures,
  });
  console.log(`${name}: axe violations=${violationCount}, measured contrast failures=${contrastFailures.length}`);
}

/**
 * The walk reached the page's last stop, every stop (app shell included)
 * shows focus with a 2px-equivalent 3:1 change, and Shift+Tab retraces Tab.
 */
const walkPasses = (walk) =>
  !walk.focusLost && !walk.truncated && walk.reverseMatches && walk.forward.every((s) => s.focusVisible && s.indicator.pass);

/** Tab and Shift+Tab through the page at both sizes; each focused stop is saved under <out>/focus/. */
async function walkBothSizes({ page, scratch }, name) {
  const out = {};
  fs.mkdirSync(path.join(outDir, "focus"), { recursive: true });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const size = `${viewport.width}x${viewport.height}`;
    out[size] = await keyboardWalk(page, scratch, { shots: path.join(outDir, "focus", `${name}-${size}`) });
  }
  await page.setViewportSize(VIEWPORTS[0]);
  return out;
}

const recapNotes = (page) => page.locator('[data-testid="recap-notes"]').first().textContent();

const result = { dirty: execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).trim().length > 0, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(), baseUrl, startedAt: new Date().toISOString(), checks: {}, pass: false };
const meetingId = createEvalMeeting("Budget review");
result.meetingId = meetingId;
const fail = (msg) => {
  throw new Error(msg);
};

try {
  // next dev compiles a route on its first request; do that before any
  // timing matters.
  const warm = await person("O");
  for (const route of ["/app/meetings", `/app/meetings/${meetingId}`]) {
    await warm.page.goto(`${baseUrl}${route}?as=O`, { waitUntil: "networkidle", timeout: 180_000 });
  }
  await warm.browser.close();

  const [A, B] = [await person("A"), await person("B")];
  await Promise.all([joinCall(A.page, meetingId, "A"), joinCall(B.page, meetingId, "B")]);
  await Promise.all([typeNotes(A.page, "end", "Agenda: budget review. "), typeNotes(B.page, "start", "Owner: Bob. ")]);
  await typeNotes(A.page, "end", "Decision: ship Friday. ");
  // Both editors settle on the stored text.
  const deadline = Date.now() + 30_000;
  let stored = storedNotes(meetingId).content;
  for (;;) {
    const [ta, tb] = await Promise.all([A.page.locator(EDITOR).inputValue(), B.page.locator(EDITOR).inputValue()]);
    stored = storedNotes(meetingId).content;
    if (ta === stored && tb === stored && stored.includes("Decision: ship Friday.") && stored.includes("Owner: Bob.")) break;
    if (Date.now() > deadline) fail(`notes did not converge: A=${JSON.stringify(ta)} B=${JSON.stringify(tb)} stored=${JSON.stringify(stored)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  result.checks.notesInCall = stored;
  // Show the actual call-room ring on a control before leaving the stage.
  await tabTo(A.page, '[data-testid="leave-call"]');
  await captureFocusControl(A.page, A.page.locator('[data-testid="leave-call"]').locator('..'), path.join(shotsDir, "call-room-focus.png"));

  // Both leave: the ended screen links to the recap and shows it.
  result.checks.keyboardLeaveHeading = await keyboardLeave(A.page);
  await A.page.screenshot({ path: path.join(shotsDir, "ended-heading-keyboard.png") });
  await leave(B.page);
  for (const p of [A, B]) {
    await p.page.locator('[data-testid="open-recap"]').waitFor({ timeout: 10_000 });
    await p.page.locator('[data-testid="ended-recap"] [data-testid="recap-notes"]').waitFor({ timeout: 20_000 });
  }
  const [endedA, endedB] = [await recapNotes(A.page), await recapNotes(B.page)];
  result.checks.endedRecap = { A: endedA, B: endedB, sameAsStored: endedA === stored && endedB === stored };
  if (!result.checks.endedRecap.sameAsStored) fail("ended recap differs from the stored notes");
  await capture(A, "call-ended", { focus: '[data-testid="ended-recap"]', scope: "main" });

  // The full recap page, for both: the same notes.
  await A.page.click('[data-testid="open-recap"]');
  await A.page.waitForURL(`**/app/meetings/${meetingId}`, { waitUntil: "commit", timeout: 120_000 });
  await B.page.goto(`${baseUrl}/app/meetings/${meetingId}?as=B`, { waitUntil: "domcontentloaded" });
  for (const p of [A, B]) await p.page.locator('[data-testid="recap-notes"]').waitFor({ timeout: 30_000 });
  const [detailA, detailB] = [await recapNotes(A.page), await recapNotes(B.page)];
  result.checks.detail = { A: detailA, B: detailB, same: detailA === detailB && detailA === stored };
  if (!result.checks.detail.same) fail("recap pages differ");
  await capture(A, "recap", { focus: '[data-testid="meeting-recap"]', scope: "main" });

  // Calendar file: downloaded and read back by ical.js.
  const [download] = await Promise.all([A.page.waitForEvent("download"), A.page.click('[data-testid="calendar-download"]')]);
  const icsPath = path.join(outDir, "meeting.ics");
  await download.saveAs(icsPath);
  const vevent = new ICAL.Component(ICAL.parse(fs.readFileSync(icsPath, "utf8"))).getFirstSubcomponent("vevent");
  result.checks.calendar = {
    fileName: download.suggestedFilename(),
    summary: vevent?.getFirstPropertyValue("summary") ?? null,
    start: vevent?.getFirstPropertyValue("dtstart")?.toString() ?? null,
  };
  if (result.checks.calendar.summary !== "Budget review") fail("calendar summary wrong");

  // B uses the keyboard only: Tab and Shift+Tab through the recap page, then
  // Enter and Space on "Add to calendar", each of which should download.
  result.checks.keyboard = { recapWalk: await walkBothSizes(B, "recap"), calendar: {} };
  for (const key of ["Enter", "Space"]) {
    await tabTo(B.page, '[data-testid="calendar-download"]');
    if (key === "Enter") await captureFocusControl(B.page, B.page.locator('[data-testid="calendar-download"]'), path.join(shotsDir, "calendar-focus-after.png"));
    const [file] = await Promise.all([B.page.waitForEvent("download", { timeout: 10_000 }).catch(() => null), B.page.keyboard.press(key)]);
    result.checks.keyboard.calendar[key] = file?.suggestedFilename() ?? null;
  }

  // Stay in touch: A says yes and sees nobody; B says yes; each sees the other.
  await A.page.click('[data-testid="stay-in-touch-switch"]');
  await A.page.getByText(/Nobody else has yet/).waitFor({ timeout: 10_000 });
  const bSeesBefore = await B.page.locator('[data-testid="stay-in-touch-contacts"]').count();
  await capture(A, "stay-in-touch-waiting", { focus: '[data-testid="stay-in-touch"]', scope: "main" });
  // B flips the switch with Space; focus should still be on it after the save.
  await tabTo(B.page, '[data-testid="stay-in-touch-switch"]');
  await B.page.keyboard.press("Space");
  result.checks.keyboard.switchSpace = await B.page
    .locator('[data-testid="stay-in-touch-switch"][aria-checked="true"]')
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  await B.page.waitForTimeout(500);
  result.checks.keyboard.switchKeepsFocus = await B.page
    .locator('[data-testid="stay-in-touch-switch"]')
    .evaluate((el) => el === document.activeElement);
  await A.page.locator('[data-testid="stay-in-touch-contacts"]').waitFor({ timeout: 10_000 });
  await B.page.locator('[data-testid="stay-in-touch-contacts"]').waitFor({ timeout: 10_000 });
  result.checks.stayInTouch = {
    bSawAnythingBeforeSayingYes: bSeesBefore > 0,
    aSees: await A.page.locator('[data-testid="stay-in-touch-contacts"]').innerText(),
    bSees: await B.page.locator('[data-testid="stay-in-touch-contacts"]').innerText(),
  };
  await capture(A, "stay-in-touch-both", { focus: '[data-testid="stay-in-touch"]', scope: "main" });

  // The list, newest first, with this meeting.
  await A.page.goto(`${baseUrl}/app/meetings?as=A`, { waitUntil: "domcontentloaded" });
  await A.page.locator('[data-testid="meeting-list"]').waitFor({ timeout: 30_000 });
  result.checks.listHasMeeting = (await A.page.locator(`a[href="/app/meetings/${meetingId}"]`).count()) === 1;
  await capture(A, "list", { focus: "main", scope: "main" });
  // The list from the keyboard: walk it, then open the meeting with Enter.
  result.checks.keyboard.listWalk = await walkBothSizes(A, "list");
  await tabTo(A.page, `a[href="/app/meetings/${meetingId}"]`);
  await A.page.keyboard.press("Enter");
  result.checks.keyboard.listRowEnter = await A.page.waitForURL(`**/app/meetings/${meetingId}`, { timeout: 30_000 }).then(
    () => true,
    () => false,
  );
  await A.page.goto(`${baseUrl}/app/meetings?as=A`, { waitUntil: "domcontentloaded" });
  await A.page.locator('[data-testid="meeting-list"]').waitFor({ timeout: 30_000 });

  // Loading and error, by holding back or failing the history queries.
  A.tap.holdQueries = ["history/queries:"];
  await A.page.reload({ waitUntil: "domcontentloaded" });
  await A.page.locator('[data-testid="meeting-list-loading"]').waitFor({ timeout: 30_000 });
  await capture(A, "list-loading", { focus: "main", scope: "main" });
  A.tap.holdQueries = [];
  A.tap.failQueries = ["history/queries:"];
  await A.page.goto(`${baseUrl}/app/meetings/${meetingId}?as=A`, { waitUntil: "domcontentloaded" });
  await A.page.locator('[data-testid="history-error"]').first().waitFor({ timeout: 30_000 });
  await capture(A, "recap-error", { focus: "main", scope: "main" });

  // O was not in the meeting: refused; and O's own list is empty.
  const O = await person("O");
  await O.page.goto(`${baseUrl}/app/meetings/${meetingId}?as=O`, { waitUntil: "domcontentloaded" });
  const refusal = O.page.locator('[data-testid="history-error"]').first();
  await refusal.waitFor({ timeout: 30_000 });
  result.checks.outsider = {
    kind: await refusal.getAttribute("data-kind"),
    text: await refusal.innerText(),
    sawNotes: (await O.page.locator('[data-testid="recap-notes"]').count()) > 0,
  };
  if (result.checks.outsider.kind !== "refused" || result.checks.outsider.sawNotes) fail("O was not refused");
  await capture(O, "recap-not-a-participant", { focus: "main", scope: "main" });
  await O.page.goto(`${baseUrl}/app/meetings?as=O`, { waitUntil: "domcontentloaded" });
  await O.page.locator('[data-testid="meeting-list-empty"]').waitFor({ timeout: 30_000 });
  await capture(O, "list-empty", { focus: "main", scope: "main" });

  result.pass =
    !result.checks.keyboardLeaveHeading.visibleSpread &&
    result.checks.endedRecap.sameAsStored &&
    result.checks.detail.same &&
    result.checks.listHasMeeting &&
    !result.checks.stayInTouch.bSawAnythingBeforeSayingYes &&
    result.checks.outsider.kind === "refused" &&
    a11y.every((s) => s.violationCount === 0 && s.contrastFailures.length === 0 && s.shellContrastFailures.length === 0) &&
    Object.values(result.checks.keyboard.recapWalk).every(walkPasses) &&
    Object.values(result.checks.keyboard.listWalk).every(walkPasses) &&
    result.checks.keyboard.calendar.Enter !== null &&
    result.checks.keyboard.calendar.Space !== null &&
    result.checks.keyboard.switchSpace &&
    result.checks.keyboard.switchKeepsFocus &&
    result.checks.keyboard.listRowEnter;
} catch (err) {
  result.error = err instanceof Error ? err.message : String(err);
  // What each open page showed when it failed.
  let n = 0;
  for (const browser of browsers) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        await page.screenshot({ path: path.join(outDir, `failure-${++n}.png`) }).catch(() => {});
        result[`failure-${n}`] = { url: page.url(), text: (await page.locator("body").innerText().catch(() => "")).slice(0, 600) };
      }
    }
  }
} finally {
  await Promise.allSettled(browsers.map((b) => b.close()));
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "a11y-results.json"), JSON.stringify({ commit: result.commit, dirty: result.dirty, ranAt: result.startedAt, states: a11y }, null, 2) + "\n");
}
console.log(`${result.pass ? "PASS" : "FAIL"}${result.error ? `: ${result.error}` : ""}`);
process.exit(result.pass ? 0 : 1);
