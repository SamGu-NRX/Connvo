#!/usr/bin/env node
/**
 * After a call, over Convex, on the real pages: A and B take notes in a call
 * and leave; both see the same recap with those notes; O, who was not in the
 * meeting, cannot open it. Along the way every after-call state is captured
 * at 1440x900 and 390x844 and audited with axe.
 *
 * Needs the local backend and next dev from
 *   node tools/call-eval/scripts/local-backend.mjs --port=3035 --after-call
 *
 *   node tools/call-eval/scripts/after-call-proof.mjs --base-url=http://localhost:3035 \
 *     [--shots=docs/after-call/screenshots] [--out=tools/call-eval/verification/<dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import ICAL from "ical.js";
import { createEvalMeeting, storedNotes } from "../runner/convex-signaling.mjs";
import { tapConvex } from "../runner/convex-tap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const baseUrl = flags["base-url"] ?? "http://localhost:3035";
const shotsDir = path.resolve(REPO, flags.shots ?? "docs/after-call/screenshots");
const outDir = path.resolve(REPO, flags.out ?? "tools/call-eval/out/after-call");
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
  return { id, browser, context, page, tap };
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
/** Screenshots at both sizes with `focus` in view, and an axe audit of `scope`. */
async function capture(page, name, { focus, scope }) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const shots = [];
  for (const viewport of VIEWPORTS) {
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
    const file = path.join(shotsDir, `${name}-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: file });
    shots.push(path.relative(REPO, file));
  }
  await page.setViewportSize(VIEWPORTS[0]);
  const axe = await new AxeBuilder({ page }).include(scope).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  a11y.push({
    state: name,
    shots,
    violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
    passes: axe.passes.length,
    incomplete: axe.incomplete.map((v) => v.id),
  });
  console.log(`${name}: axe violations=${axe.violations.length}`);
}

const recapNotes = (page) => page.locator('[data-testid="recap-notes"]').first().textContent();

const result = { baseUrl, startedAt: new Date().toISOString(), checks: {}, pass: false };
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

  // Both leave: the ended screen links to the recap and shows it.
  await leave(A.page);
  await leave(B.page);
  for (const p of [A, B]) {
    await p.page.locator('[data-testid="open-recap"]').waitFor({ timeout: 10_000 });
    await p.page.locator('[data-testid="ended-recap"] [data-testid="recap-notes"]').waitFor({ timeout: 20_000 });
  }
  const [endedA, endedB] = [await recapNotes(A.page), await recapNotes(B.page)];
  result.checks.endedRecap = { A: endedA, B: endedB, sameAsStored: endedA === stored && endedB === stored };
  if (!result.checks.endedRecap.sameAsStored) fail("ended recap differs from the stored notes");
  await capture(A.page, "call-ended", { focus: '[data-testid="ended-recap"]', scope: "main" });

  // The full recap page, for both: the same notes.
  await A.page.click('[data-testid="open-recap"]');
  await A.page.waitForURL(`**/app/meetings/${meetingId}`, { waitUntil: "commit", timeout: 120_000 });
  await B.page.goto(`${baseUrl}/app/meetings/${meetingId}?as=B`, { waitUntil: "domcontentloaded" });
  for (const p of [A, B]) await p.page.locator('[data-testid="recap-notes"]').waitFor({ timeout: 30_000 });
  const [detailA, detailB] = [await recapNotes(A.page), await recapNotes(B.page)];
  result.checks.detail = { A: detailA, B: detailB, same: detailA === detailB && detailA === stored };
  if (!result.checks.detail.same) fail("recap pages differ");
  await capture(A.page, "recap", { focus: '[data-testid="meeting-recap"]', scope: "main" });

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

  // Stay in touch: A says yes and sees nobody; B says yes; each sees the other.
  await A.page.click('[data-testid="stay-in-touch-switch"]');
  await A.page.getByText(/Nobody else has yet/).waitFor({ timeout: 10_000 });
  const bSeesBefore = await B.page.locator('[data-testid="stay-in-touch-contacts"]').count();
  await capture(A.page, "stay-in-touch-waiting", { focus: '[data-testid="stay-in-touch"]', scope: "main" });
  await B.page.click('[data-testid="stay-in-touch-switch"]');
  await A.page.locator('[data-testid="stay-in-touch-contacts"]').waitFor({ timeout: 10_000 });
  await B.page.locator('[data-testid="stay-in-touch-contacts"]').waitFor({ timeout: 10_000 });
  result.checks.stayInTouch = {
    bSawAnythingBeforeSayingYes: bSeesBefore > 0,
    aSees: await A.page.locator('[data-testid="stay-in-touch-contacts"]').innerText(),
    bSees: await B.page.locator('[data-testid="stay-in-touch-contacts"]').innerText(),
  };
  await capture(A.page, "stay-in-touch-both", { focus: '[data-testid="stay-in-touch"]', scope: "main" });

  // The list, newest first, with this meeting.
  await A.page.goto(`${baseUrl}/app/meetings?as=A`, { waitUntil: "domcontentloaded" });
  await A.page.locator('[data-testid="meeting-list"]').waitFor({ timeout: 30_000 });
  result.checks.listHasMeeting = (await A.page.locator(`a[href="/app/meetings/${meetingId}"]`).count()) === 1;
  await capture(A.page, "list", { focus: "main", scope: "main" });

  // Loading and error, by holding back or failing the history queries.
  A.tap.holdQueries = ["history/queries:"];
  await A.page.reload({ waitUntil: "domcontentloaded" });
  await A.page.locator('[data-testid="meeting-list-loading"]').waitFor({ timeout: 30_000 });
  await capture(A.page, "list-loading", { focus: "main", scope: "main" });
  A.tap.holdQueries = [];
  A.tap.failQueries = ["history/queries:"];
  await A.page.goto(`${baseUrl}/app/meetings/${meetingId}?as=A`, { waitUntil: "domcontentloaded" });
  await A.page.locator('[data-testid="history-error"]').first().waitFor({ timeout: 30_000 });
  await capture(A.page, "recap-error", { focus: "main", scope: "main" });

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
  await capture(O.page, "recap-not-a-participant", { focus: "main", scope: "main" });
  await O.page.goto(`${baseUrl}/app/meetings?as=O`, { waitUntil: "domcontentloaded" });
  await O.page.locator('[data-testid="meeting-list-empty"]').waitFor({ timeout: 30_000 });
  await capture(O.page, "list-empty", { focus: "main", scope: "main" });

  result.pass =
    result.checks.endedRecap.sameAsStored &&
    result.checks.detail.same &&
    result.checks.listHasMeeting &&
    !result.checks.stayInTouch.bSawAnythingBeforeSayingYes &&
    result.checks.outsider.kind === "refused" &&
    a11y.every((s) => s.violations.length === 0);
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
  fs.writeFileSync(path.join(shotsDir, "..", "a11y-results.json"), JSON.stringify({ ranAt: result.startedAt, states: a11y }, null, 2) + "\n");
}
console.log(`${result.pass ? "PASS" : "FAIL"}${result.error ? `: ${result.error}` : ""}`);
process.exit(result.pass ? 0 : 1);
