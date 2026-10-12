#!/usr/bin/env node
/**
 * Screenshots of every state of the real call page (/app/call/[id]) and a
 * frame strip of a real two-person call, at 1440x900 and 390x844.
 *
 * Needs `next dev` running with NEXT_PUBLIC_CONNVO_CALL_BENCH=1 and
 * NEXT_PUBLIC_CONNVO_REAL_CALL=1 (pass --base-url). It starts its own
 * reference signaling server. Every state is reached for real: permission
 * denial with a real denied prompt, no devices with no fake devices, and
 * reconnecting then failed by stopping the signaling server mid-call.
 *
 *   node tools/call-eval/scripts/call-page-shots.mjs --base-url=http://localhost:3036 [--out=docs/call-page/screenshots]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startReferenceSignaling } from "../runner/reference-signaling.mjs";
import { probeInit } from "../runner/probe.mjs";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(EVAL_DIR, "..", "..");
const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const baseUrl = flags["base-url"] ?? "http://localhost:3036";
const outDir = path.resolve(REPO, flags.out ?? "docs/call-page/screenshots");
fs.mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const fixture = (id) => {
  const f = id === "A" || id === "B" ? id : "C";
  return { video: path.join(EVAL_DIR, "fixtures", `peer-${f}.y4m`), audio: path.join(EVAL_DIR, "fixtures", `peer-${f}.wav`) };
};

/** @type {import('@playwright/test').Browser[]} */
const browsers = [];
async function peer(id, { devices = true, deny = false, viewport = VIEWPORTS[0] } = {}) {
  const { video, audio } = fixture(id);
  const args = ["--autoplay-policy=no-user-gesture-required", "--mute-audio"];
  if (devices) args.push("--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`, `--use-file-for-fake-audio-capture=${audio}`);
  if (!deny) args.push("--use-fake-ui-for-media-stream");
  const browser = await chromium.launch({ headless: true, args, ...(deny ? { channel: "chromium" } : {}) });
  browsers.push(browser);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(probeInit);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`[pageerror ${id}]`, e.message.slice(0, 200)));
  return { id, browser, context, page };
}

const phaseOf = (p) => p.page.evaluate(() => document.querySelector("[data-call-phase]")?.getAttribute("data-call-phase"));
async function waitPhase(p, phase, timeout = 30000) {
  await p.page.waitForFunction((want) => document.querySelector("[data-call-phase]")?.getAttribute("data-call-phase") === want, phase, { timeout });
}
async function shoot(p, name) {
  const shots = [];
  for (const viewport of VIEWPORTS) {
    await p.page.setViewportSize(viewport);
    await p.page.waitForTimeout(400);
    const file = path.join(outDir, `${name}-${viewport.width}x${viewport.height}.png`);
    await p.page.screenshot({ path: file });
    shots.push(path.relative(REPO, file));
  }
  await p.page.setViewportSize(VIEWPORTS[0]);
  console.log(`shot ${name}: phase ${await phaseOf(p)}`);
  return shots;
}

const signaling = await startReferenceSignaling({ transport: "p2p", log: console.log });
const url = (id, meeting) => `${baseUrl}/app/call/${meeting}?as=${id}&signal=${encodeURIComponent(signaling.signalUrl)}`;
const join = async (p) => {
  await p.page.click('[data-testid="join-call"]');
};

try {
  // No signaling configured: the honest "needs the signaling service" state.
  const bare = await peer("A");
  await bare.page.goto(`${baseUrl}/app/call/demo-meeting`);
  await bare.page.waitForSelector("[data-call-phase]");
  await shoot(bare, "no-signaling");

  // Lobby with a live preview.
  const a = await peer("A");
  await a.page.goto(url("A", "shots-1"));
  await a.page.waitForSelector('[data-testid="local-video"]');
  await a.page.waitForTimeout(1200);
  await shoot(a, "lobby");

  // Permission denied (full Chromium, real prompt, denied by headless).
  const denied = await peer("A", { deny: true });
  await denied.page.goto(url("A", "shots-denied"));
  await denied.page.waitForSelector('[data-testid="retry-media"]', { timeout: 20000 });
  await shoot(denied, "permission-denied");

  // No camera or microphone at all.
  const none = await peer("A", { devices: false });
  await none.page.goto(url("A", "shots-none"));
  await none.page.waitForSelector('[data-testid="retry-media"]', { timeout: 20000 });
  await shoot(none, "no-device");

  // Alone in the call.
  await join(a);
  await waitPhase(a, "connected");
  await shoot(a, "alone");

  // Two people, then the frame strip from both sides.
  const b = await peer("B");
  await b.page.goto(url("B", "shots-1"));
  await b.page.waitForSelector('[data-testid="local-video"]');
  await join(b);
  await waitPhase(b, "connected");
  await a.page.waitForFunction(() => {
    const v = document.querySelector('[data-testid="remote-media"] video');
    return v && v.videoWidth > 0;
  }, null, { timeout: 20000 });
  await a.page.waitForTimeout(1500);
  await shoot(a, "two-people");
  const strip = [];
  for (let i = 0; i < 6; i++) {
    for (const p of [a, b]) {
      const file = path.join(outDir, `strip-${p.id}-${i}.png`);
      await p.page.screenshot({ path: file });
      strip.push({ who: p.id, i, file });
    }
    await a.page.waitForTimeout(500);
  }

  // B mutes and turns the camera off: A's tile shows it.
  await b.page.click('[data-testid="toggle-mic"]');
  await b.page.click('[data-testid="toggle-camera"]');
  await a.page.waitForSelector('[data-testid="remote-media"][data-video-off="true"][data-audio-muted="true"]', { timeout: 5000 });
  await shoot(a, "remote-muted-camera-off");
  await b.page.click('[data-testid="toggle-camera"]');
  await b.page.click('[data-testid="toggle-mic"]');

  // Three and four people.
  const c = await peer("C");
  await c.page.goto(url("C", "shots-1"));
  await c.page.waitForSelector('[data-testid="local-video"]');
  await join(c);
  await waitPhase(c, "connected");
  await a.page.waitForFunction(() => document.querySelectorAll('[data-testid="remote-media"]').length === 2, null, { timeout: 15000 });
  await a.page.waitForTimeout(1500);
  await shoot(a, "three-people");
  const d = await peer("D");
  await d.page.goto(url("D", "shots-1"));
  await d.page.waitForSelector('[data-testid="local-video"]');
  await join(d);
  await waitPhase(d, "connected");
  await a.page.waitForFunction(() => document.querySelectorAll('[data-testid="remote-media"]').length === 3, null, { timeout: 15000 });
  await a.page.waitForTimeout(1500);
  await shoot(a, "four-people");
  for (const p of [c, d]) await p.browser.close();

  // Device settings and the leave confirmation.
  await a.page.click('[data-testid="device-settings"]');
  await a.page.waitForTimeout(300);
  await shoot(a, "device-settings");
  await a.page.keyboard.press("Escape");
  await a.page.click('[data-testid="leave-call"]');
  await a.page.waitForSelector('[data-testid="leave-call-confirm"]');
  await shoot(a, "leave-confirm");

  // Leave: the ended state, with the camera released.
  await a.page.click('[data-testid="leave-call-confirm"]');
  await waitPhase(a, "left", 5000);
  const live = await a.page.evaluate(() => window.__callProbe?.tracks.live);
  console.log(`after leave: ${live} live capture tracks`);
  await shoot(a, "ended");

  // Reconnecting, then failed: stop the signaling server under B.
  signaling.stop();
  await waitPhase(b, "reconnecting", 15000);
  await shoot(b, "reconnecting");
  await waitPhase(b, "failed", 60000);
  await shoot(b, "failed");

  // Frame strip: A's and B's views side by side, six frames 0.5 s apart.
  const strip2 = await peer("A");
  const rows = ["A", "B"]
    .map((who) =>
      `<div style="display:flex;gap:6px">${strip
        .filter((s) => s.who === who)
        .map((s) => `<img src="data:image/png;base64,${fs.readFileSync(s.file).toString("base64")}" style="width:360px">`)
        .join("")}</div>`,
    )
    .join("");
  await strip2.page.setViewportSize({ width: 6 * 366, height: 2 * 230 + 20 });
  await strip2.page.setContent(`<body style="margin:6px;background:#0e1716;display:grid;gap:6px">${rows}</body>`);
  await strip2.page.screenshot({ path: path.join(outDir, "frame-strip-two-person-call.png"), fullPage: true });
  for (const s of strip) fs.rmSync(s.file);
  console.log(`frame strip: ${path.relative(REPO, path.join(outDir, "frame-strip-two-person-call.png"))}`);
} finally {
  signaling.stop();
  await Promise.allSettled(browsers.map((b) => b.close()));
}
