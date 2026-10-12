#!/usr/bin/env node
/**
 * Shared notes on the real call page, over Convex: two signed-in people
 * (A and B) in a call type notes at the same time, and both editors and the
 * stored text must end equal, with every phrase present exactly once.
 *
 * Scenarios, each in a fresh meeting:
 * - converge: A appends while B types at the start, at the same time, twice.
 * - reload:   A types and reloads before the debounce sends anything; B types
 *             meanwhile. A's words must come back from the tab's recovery
 *             store and reach the server.
 * - drop:     A's network goes down for 10 s (browser offline and its Convex
 *             socket cut, as H-07 does) while both type; then it comes back.
 *
 * Needs the local backend and next dev from scripts/local-backend.mjs.
 *
 *   node tools/call-eval/scripts/notes-proof.mjs --base-url=http://localhost:3035 \
 *     [--scenarios=converge,reload,drop] [--out=tools/call-eval/verification/<dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchPeer } from "../runner/peers.mjs";
import { createEvalMeeting, installSignalingCut, storedNotes } from "../runner/convex-signaling.mjs";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(EVAL_DIR, "..", "..");
const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const baseUrl = flags["base-url"] ?? "http://localhost:3035";
const scenarios = (flags.scenarios ?? "converge,reload,drop").split(",");
const outDir = path.resolve(REPO, flags.out ?? "tools/call-eval/out/notes-proof");
fs.mkdirSync(outDir, { recursive: true });

const EDITOR = '[data-testid="notes-editor"]';
const STATUS = '[data-testid="notes-status"]';
const CONVERGE_TIMEOUT_MS = 30_000;

/** @param {string} id */
async function openPeer(id, meetingId) {
  const peer = await launchPeer({
    fixtureVideo: path.join(EVAL_DIR, "fixtures", `peer-${id}.y4m`),
    fixtureAudio: path.join(EVAL_DIR, "fixtures", `peer-${id}.wav`),
    baseUrl,
    participant: id,
  });
  const cut = await installSignalingCut(peer.context);
  await peer.page.goto(`${baseUrl}/app/call/${meetingId}?as=${id}`, { waitUntil: "domcontentloaded" });
  await joinCall(peer.page);
  await peer.page.locator(`${EDITOR}:not([disabled])`).waitFor({ timeout: 60_000 });
  return { id, ...peer, cut };
}

/** Join from the lobby and wait for the call to connect (notes are in-call). */
async function joinCall(page) {
  await page.locator('[data-testid="join-call"]:not([disabled])').click({ timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const phase = document.querySelector("[data-call-phase]")?.getAttribute("data-call-phase");
      return phase === "connected" || phase === "joining";
    },
    null,
    { timeout: 30_000 },
  );
}

/**
 * Type like a person, at the start or the end of the notes.
 * @param {import('@playwright/test').Page} page
 * @param {"start" | "end"} where
 * @param {string} text
 */
async function typeAt(page, where, text) {
  const editor = page.locator(EDITOR);
  await editor.focus();
  await editor.evaluate((el, at) => {
    const ta = /** @type {HTMLTextAreaElement} */ (el);
    const pos = at === "start" ? 0 : ta.value.length;
    ta.setSelectionRange(pos, pos);
  }, where);
  await page.keyboard.type(text, { delay: 15 });
}

const editorText = (page) => page.locator(EDITOR).inputValue();
const statusText = (page) => page.locator(STATUS).innerText();

const count = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * Wait until both editors show the same text, both say Synced, and the stored
 * text matches; then check every phrase is there exactly once.
 */
async function converge(meetingId, peers, phrases, since) {
  const deadline = Date.now() + CONVERGE_TIMEOUT_MS;
  let last = null;
  for (;;) {
    // Leaving the editor flushes at once, as a person clicking away would.
    for (const p of peers) await p.page.locator(EDITOR).blur();
    const texts = await Promise.all(peers.map((p) => editorText(p.page)));
    const statuses = await Promise.all(peers.map((p) => statusText(p.page)));
    const stored = storedNotes(meetingId);
    last = { texts, statuses, stored };
    const equal = texts.every((t) => t === stored.content);
    const synced = statuses.every((s) => /synced/i.test(s));
    if (equal && synced) break;
    if (Date.now() > deadline) return { converged: false, ...last, phraseCounts: {}, convergeMs: null };
    await new Promise((r) => setTimeout(r, 500));
  }
  const phraseCounts = Object.fromEntries(phrases.map((ph) => [ph, count(last.stored.content, ph)]));
  return { converged: true, ...last, phraseCounts, convergeMs: Date.now() - since };
}

const SCENARIOS = {
  async converge(meetingId, a, b) {
    const phrases = ["Agenda: budget review. ", "Owner: Bob. ", "Decision: ship Friday. ", "Risk: vendor delay. "];
    const t0 = Date.now();
    await Promise.all([typeAt(a.page, "end", phrases[0]), typeAt(b.page, "start", phrases[1])]);
    await Promise.all([typeAt(a.page, "end", phrases[2]), typeAt(b.page, "start", phrases[3])]);
    const result = await converge(meetingId, [a, b], phrases, t0);
    // What the page looks like: the call with the notes beside it.
    await a.page.setViewportSize({ width: 1440, height: 900 });
    await a.page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await a.page.waitForTimeout(400);
    await a.page.screenshot({ path: path.join(outDir, "converge-A-1440x900.png") });
    return { phrases, steps: ["A appends, B types at the start, at once, twice"], ...result };
  },

  async reload(meetingId, a, b) {
    const phrases = ["Before reload from A. ", "Meanwhile from B. "];
    const t0 = Date.now();
    await typeAt(a.page, "end", phrases[0]);
    // Reload at once: the 800 ms debounce has not sent A's words yet.
    const reloading = a.page.reload({ waitUntil: "domcontentloaded" });
    await typeAt(b.page, "start", phrases[1]);
    await reloading;
    await joinCall(a.page);
    await a.page.locator(`${EDITOR}:not([disabled])`).waitFor({ timeout: 60_000 });
    return {
      phrases,
      steps: ["A types, reloads before the debounce fires; B types meanwhile; A rejoins"],
      ...(await converge(meetingId, [a, b], phrases, t0)),
    };
  },

  async drop(meetingId, a, b) {
    const phrases = ["Typed by A while offline. ", "Typed by B while A was away. "];
    const t0 = Date.now();
    await a.cut.cut();
    await Promise.all([typeAt(a.page, "end", phrases[0]), typeAt(b.page, "start", phrases[1])]);
    await a.page.locator(EDITOR).blur();
    const elapsed = Date.now() - t0;
    await new Promise((r) => setTimeout(r, Math.max(0, 10_000 - elapsed)));
    const offlineFor = Date.now() - t0;
    const whileOffline = {
      aText: await editorText(a.page),
      aStatus: await statusText(a.page),
      stored: storedNotes(meetingId).content,
    };
    await a.cut.restore();
    const restoredAt = Date.now();
    const result = await converge(meetingId, [a, b], phrases, restoredAt);
    return {
      phrases,
      steps: ["A offline (browser offline + Convex socket cut); both type; A back after 10 s"],
      offlineMs: offlineFor,
      whileOffline,
      ...result,
    };
  },
};

const results = [];
for (const name of scenarios) {
  const run = SCENARIOS[/** @type {keyof typeof SCENARIOS} */ (name)];
  if (!run) throw new Error(`unknown scenario ${name}`);
  const meetingId = createEvalMeeting(`notes ${name}`);
  const startedAt = new Date().toISOString();
  let record;
  const peers = [];
  try {
    const a = await openPeer("A", meetingId);
    peers.push(a);
    const b = await openPeer("B", meetingId);
    peers.push(b);
    const outcome = await run(meetingId, a, b);
    const exactlyOnce = Object.values(outcome.phraseCounts ?? {}).every((n) => n === 1);
    record = { scenario: name, meetingId, startedAt, pass: outcome.converged && exactlyOnce, ...outcome };
  } catch (err) {
    record = { scenario: name, meetingId, startedAt, pass: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await Promise.allSettled(peers.map((p) => p.close()));
  }
  results.push(record);
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(record, null, 2) + "\n");
  console.log(`${record.pass ? "PASS" : "FAIL"} ${name}${record.convergeMs != null ? ` converged in ${record.convergeMs} ms` : ""}${record.error ? `: ${record.error}` : ""}`);
}
process.exit(results.every((r) => r.pass) ? 0 : 1);
