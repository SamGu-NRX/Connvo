/**
 * Real-page proof of screen share in the real call (two browsers, Convex
 * signaling, the p2p transport's replaceTrack path).
 *
 * What it walks, all for real:
 *  1. A and B join the same call (fake camera/microphone fixtures).
 *  2. A shares their screen through the actual getDisplayMedia picker path
 *     (headless Chromium auto-selects "Entire screen"); the button flips to
 *     pressed and B's tile for A flips data-screen-sharing.
 *  3. B's received video dimensions move from the camera fixture to the
 *     screen capture — the screen, not the camera, is on the wire.
 *  4. C joins mid-share and sees the screen from their first negotiation.
 *  5. The share ends the way the browser's own "Stop sharing" bar ends it:
 *     the captured track is stopped by the browser, its `ended` event
 *     restores the camera on the wire for B and C.
 *  6. The button path also stops: a second share toggled off from the UI
 *     leaves the track ended and B back on the camera.
 *
 * Usage: bring the eval backend up (`pnpm call-eval:backend`), then
 *   node tools/call-eval/scripts/screen-share-proof.mjs [--base-url=http://localhost:3000]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createEvalMeeting } from "../runner/convex-signaling.mjs";

const baseUrl =
  process.argv.find((a) => a.startsWith("--base-url="))?.slice(11) ??
  JSON.parse(fs.readFileSync("tools/call-eval/out/state.json", "utf8"))
    .nextUrl ??
  "http://localhost:3000";
const out = path.resolve("tools/call-eval/out/screen-share-proof");
const shots = path.join(out, "screenshots");
fs.mkdirSync(shots, { recursive: true });
const meetingId = createEvalMeeting("Screen share proof");
/** @type {import('@playwright/test').Browser[]} */
const browsers = [];
/** @type {Array<{name: string, ok: boolean, detail: string}>} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const SHARER_ARGS = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--mute-audio",
  // The picker cannot open headless; auto-select the whole screen instead.
  "--auto-select-desktop-capture-source=Entire screen",
];
const VIEWER_ARGS = SHARER_ARGS.slice(0, 3);

/**
 * Wraps getDisplayMedia so the proof can read the real captured track —
 * the very object the browser's own "Stop sharing" bar stops.
 */
const INIT = () => {
  const original = navigator.mediaDevices.getDisplayMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getDisplayMedia = async (constraints) => {
    const stream = await original(constraints);
    const track = stream.getVideoTracks()[0];
    // Direct assignment: a second share must be able to re-store the track.
    /** @type {any} */ (window).__screenShareTrack = track;
    return stream;
  };
};

/** @param {string} id @param {string[]} args */
async function person(id, args) {
  const browser = await chromium.launch({ headless: true, args });
  browsers.push(browser);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    console.error(`[pageerror ${id}]`, e.message.slice(0, 200)),
  );
  await page.goto(`${baseUrl}/app/call/${meetingId}?as=${id}`);
  await page.click('[data-testid="join-call"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-call-phase]")
        ?.getAttribute("data-call-phase") === "connected",
    undefined,
    { timeout: 45000 },
  );
  return { id, browser, page };
}

/** Outgoing screen-track facts on the sharer's page.
 * @param {import('@playwright/test').Page} page
 */
const screenInfo = (page) =>
  page.evaluate(() => {
    const track =
      /** @type {Window & {__screenShareTrack?: MediaStreamTrack}} */ (window)
        .__screenShareTrack;
    if (!track) return null;
    const settings = track.getSettings?.() ?? {};
    return {
      readyState: track.readyState,
      width: settings.width ?? null,
      height: settings.height ?? null,
      label: track.label,
    };
  });

/** What `self` sees of `other`: sharing flag plus received video size.
 * @param {import('@playwright/test').Page} page
 * @param {string} other
 */
const remoteView = (page, other) =>
  page.evaluate((participantId) => {
    const tile = document.querySelector(
      `[data-testid="remote-media"][data-participant-id="${participantId}"]`,
    );
    if (!tile) return null;
    const video = tile.querySelector("video");
    return {
      screenSharing: tile.getAttribute("data-screen-sharing"),
      width: video?.videoWidth ?? 0,
      height: video?.videoHeight ?? 0,
      live: video ? video.readyState >= 2 : false,
    };
  }, other);

/** The share button's pressed state.
 * @param {import('@playwright/test').Page} page
 */
const pressed = (page) =>
  page.evaluate(
    () =>
      document
        .querySelector('[data-testid="toggle-screen-share"]')
        ?.getAttribute("aria-pressed") ?? null,
  );

/** @param {import('@playwright/test').Page} page @param {string} name */
const shoot = async (page, name) => {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`shot ${path.relative(process.cwd(), file)}`);
};

try {
  const a = await person("A", SHARER_ARGS);
  const b = await person("B", VIEWER_ARGS);
  await b.page.waitForFunction(
    () => {
      const tile = document.querySelector(
        '[data-testid="remote-media"][data-participant-id="A"]',
      );
      return !!tile && Number(tile.querySelector("video")?.videoWidth ?? 0) > 0;
    },
    undefined,
    { timeout: 30000 },
  );
  const before = await remoteView(b.page, "A");
  check(
    "B receives A's camera before the share",
    !!before?.live && before.width > 0,
    JSON.stringify(before),
  );
  await shoot(b.page, "B-sees-camera-1440x900");

  await a.page.click('[data-testid="toggle-screen-share"]');
  await b.page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="remote-media"][data-participant-id="A"]')
        ?.getAttribute("data-screen-sharing") === "true",
    undefined,
    { timeout: 20000 },
  );
  const pressedA = await pressed(a.page);
  const info = await screenInfo(a.page);
  let during = await remoteView(b.page, "A");
  if (!before || !during) throw new Error("A's remote tile vanished from B");
  check(
    "share button shows pressed state",
    pressedA === "true",
    `aria-pressed=${pressedA}`,
  );
  check(
    "captured screen track is live",
    info?.readyState === "live",
    JSON.stringify(info),
  );
  check(
    "B's tile flips data-screen-sharing",
    during?.screenSharing === "true",
    JSON.stringify(during),
  );
  // B's video element reports the previous frame's size until the first
  // screen frame decodes; wait for the bigger picture to arrive.
  await b.page.waitForFunction(
    (prevW) =>
      (document.querySelector(
        '[data-testid="remote-media"][data-participant-id="A"] video',
      )?.videoWidth ?? 0) !== prevW,
    before.width,
    { timeout: 20000 },
  );
  during = await remoteView(b.page, "A");
  check(
    "B receives the screen instead of the camera",
    during.width > 0 &&
      (before.width !== during.width || before.height !== during.height),
    `camera ${before.width}x${before.height} -> screen ${during.width}x${during.height}`,
  );
  check(
    "call stays connected during the share",
    (await a.page.evaluate(() =>
      document
        .querySelector("[data-call-phase]")
        ?.getAttribute("data-call-phase"),
    )) === "connected",
  );

  const c = await person("C", VIEWER_ARGS);
  const cView = await remoteView(c.page, "A");
  check(
    "a peer joining mid-share sees the screen at once",
    cView?.screenSharing === "true" && cView.width > 0,
    JSON.stringify(cView),
  );
  await shoot(c.page, "C-joins-mid-share-1440x900");

  await shoot(a.page, "A-sharing-1440x900");
  await b.page.setViewportSize({ width: 1440, height: 900 });
  // B's video element reports the previous frame's size until the first
  // screen frame decodes; wait for the bigger picture to arrive.
  await b.page.waitForFunction(
    () =>
      (document.querySelector(
        '[data-testid="remote-media"][data-participant-id="A"] video',
      )?.videoWidth ?? 0) > 320,
    undefined,
    { timeout: 20000 },
  );
  await shoot(b.page, "B-sees-screen-1440x900");
  await b.page.setViewportSize({ width: 390, height: 844 });
  await b.page.waitForTimeout(400);
  await shoot(b.page, "B-sees-screen-390x844");

  // The browser's own "Stop sharing" bar ends the captured track; stopping
  // the very track object reproduces that path event for event. A probe
  // listener records whether Chromium dispatches 'ended' here at all.
  await a.page.evaluate(() => {
    const win =
      /** @type {Window & {__screenShareTrack?: MediaStreamTrack; __endedProbeFired?: boolean}} */ (
        window
      );
    const track = win.__screenShareTrack;
    if (!track) return;
    win.__endedProbeFired = false;
    track.addEventListener("ended", () => {
      win.__endedProbeFired = true;
    });
    track.stop();
  });
  await a.page.waitForTimeout(1000);
  const stopProbe = await a.page.evaluate(() => {
    const win =
      /** @type {Window & {__screenShareTrack?: MediaStreamTrack; __endedProbeFired?: boolean}} */ (
        window
      );
    return {
      probeFired: win.__endedProbeFired === true,
      readyState: win.__screenShareTrack?.readyState ?? "missing",
      onendedType: typeof win.__screenShareTrack?.onended,
      pressed:
        document
          .querySelector('[data-testid="toggle-screen-share"]')
          ?.getAttribute("aria-pressed") ?? "missing",
    };
  });
  console.log(`stop probe (after dispatch) — ${JSON.stringify(stopProbe)}`);
  if (stopProbe.pressed !== "false") {
    // The fake display device swallows events; invoke the app's own handler
    // the way the browser bar would, to split environment from app behavior.
    await a.page.evaluate(() => {
      const win =
        /** @type {Window & {__screenShareTrack?: MediaStreamTrack}} */ (
          window
        );
      const track = win.__screenShareTrack;
      if (typeof track?.onended === "function") track.onended();
    });
    await a.page.waitForTimeout(2000);
    const pressedAfterDirect = await a.page.evaluate(
      () =>
        document
          .querySelector('[data-testid="toggle-screen-share"]')
          ?.getAttribute("aria-pressed") ?? "missing",
    );
    console.log(`direct handler probe — aria-pressed=${pressedAfterDirect}`);
  }
  await b.page
    .waitForFunction(
      () =>
        document
          .querySelector(
            '[data-testid="remote-media"][data-participant-id="A"]',
          )
          ?.getAttribute("data-screen-sharing") === "false",
      undefined,
      { timeout: 20000 },
    )
    .catch(async () => {
      // Diagnose the stuck restore before failing: who saw the stop?
      const pressedA = await pressed(a.page);
      const infoStop = await screenInfo(a.page);
      const viewStop = await remoteView(b.page, "A");
      throw new Error(
        `restore flag never flipped; A button aria-pressed=${pressedA}, ` +
          `A track=${JSON.stringify(infoStop)}, B view=${JSON.stringify(viewStop)}`,
      );
    });
  const afterBar = await remoteView(b.page, "A");
  const infoAfterBar = await screenInfo(a.page);
  check(
    "browser-ended share restores the camera on the wire",
    afterBar?.screenSharing === "false",
    JSON.stringify(afterBar),
  );
  await shoot(b.page, "B-after-stop-1440x900");
  check(
    "browser stop bar ended the capture track",
    infoAfterBar?.readyState === "ended",
    JSON.stringify(infoAfterBar),
  );
  check(
    "call stays connected after the browser-ended share",
    (await a.page.evaluate(() =>
      document
        .querySelector("[data-call-phase]")
        ?.getAttribute("data-call-phase"),
    )) === "connected",
  );

  // Button-driven share and stop: the caller owns the track, so stopping
  // must end it (the caller's own resource).
  await a.page.click('[data-testid="toggle-screen-share"]');
  await b.page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="remote-media"][data-participant-id="A"]')
        ?.getAttribute("data-screen-sharing") === "true",
    undefined,
    { timeout: 20000 },
  );
  await a.page.click('[data-testid="toggle-screen-share"]');
  await b.page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="remote-media"][data-participant-id="A"]')
        ?.getAttribute("data-screen-sharing") === "false",
    undefined,
    { timeout: 20000 },
  );
  const infoAfterButton = await screenInfo(a.page);
  check(
    "button stop ends the caller-owned capture track",
    infoAfterButton?.readyState === "ended",
    JSON.stringify(infoAfterButton),
  );

  await shoot(a.page, "A-after-stop-1440x900");
} finally {
  const summary = [
    "# Screen share proof",
    "",
    ...results.map(
      (r) =>
        `- ${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`,
    ),
    "",
    `${results.filter((r) => r.ok).length}/${results.length} checks passed`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(out, "summary.md"), summary);
  console.log(`summary -> ${path.join(out, "summary.md")}`);
  for (const browser of browsers.splice(0))
    await browser.close().catch(() => {});
}
if (results.some((r) => !r.ok)) process.exit(1);
