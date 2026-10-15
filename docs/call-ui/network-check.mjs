// Impair actual RTP through the harness relay; observe live stats and sender settings.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
import { joinPair } from "../../tools/call-eval/runner/scenario-kit.mjs";
const ctx = new RunContext({
  transport: "p2p",
  page: "real",
  signaling: "convex",
  baseUrl: "http://localhost:3105",
  warmUp: false,
});
const openRealPage = ctx.openRealPage.bind(ctx);
ctx.openRealPage = async (peer, participant, params) => {
  const relay = await ctx.rtcConfigFor(participant);
  // The existing constructor probe forces local TURN. The production ICE
  // loader later calls setConfiguration; retain the test relay there too.
  // Media still traverses real RTP and the shaper; stats/sender APIs are native.
  await peer.context.addInitScript((config) => {
    const configure = RTCPeerConnection.prototype.setConfiguration;
    RTCPeerConnection.prototype.setConfiguration = function (next) {
      return configure.call(this, { ...next, ...config });
    };
  }, relay);
  return openRealPage(peer, participant, params);
};
const results = [];
async function snapshot(page) {
  return page.evaluate(() => ({
    quality: document
      .querySelector('[data-testid="network-status"]')
      ?.getAttribute("data-quality"),
    reduced: document
      .querySelector('[data-testid="network-status"]')
      ?.getAttribute("data-video-reduced"),
    text: document.querySelector('[data-testid="network-status"]')?.textContent,
    senders: (window.__wrappedPcs || []).flatMap((pc) =>
      pc
        .getSenders()
        .filter((s) => s.track?.kind === "video")
        .map((s) =>
          s
            .getParameters()
            .encodings.map((e) => ({
              maxBitrate: e.maxBitrate ?? null,
              scaleResolutionDownBy: e.scaleResolutionDownBy ?? null,
            })),
        ),
    ),
  }));
}
try {
  await ctx.start();
  ctx.newMeeting("Lane5 adaptive network proof");
  ctx.enableRelay();
  await ctx.shaperFor("B").ready;
  const { peerA, peerB } = await joinPair(ctx);
  const page = peerB.page;
  await page
    .getByTestId("network-status")
    .filter({ hasText: "Good connection" })
    .waitFor({ timeout: 20000 });
  results.push({
    stage: "healthy",
    signaling: "convex",
    relay: "local TURN with UDP shaper",
    ...(await snapshot(page)),
  });
  ctx.shaperFor("B").applyProfile({ lossPct: 15, delayMs: 300 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="network-status"]')
        ?.getAttribute("data-video-reduced") === "true",
    null,
    { timeout: 30000 },
  );
  const degraded = await snapshot(page);
  assert(
    degraded.senders
      .flat()
      .some((e) => e.maxBitrate <= 700000 && e.scaleResolutionDownBy >= 1.5),
  );
  results.push({ stage: "15-percent-loss-300ms-delay", ...degraded });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.addStyleTag({
      content: "nextjs-portal{display:none!important}",
    });
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await page.screenshot({
      path: `docs/call-ui/screenshots/network-adapting-${size.width}x${size.height}.png`,
      animations: "disabled",
    });
  }
  ctx.shaperFor("B").applyProfile({ lossPct: 0, delayMs: 0 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="network-status"]')
        ?.getAttribute("data-video-reduced") === "false" &&
      document
        .querySelector('[data-testid="network-status"]')
        ?.getAttribute("data-quality") === "good",
    null,
    { timeout: 45000 },
  );
  const recovered = await snapshot(page);
  assert.deepEqual(recovered.senders, results[0].senders);
  results.push({ stage: "recovered", ...recovered });
  await page.evaluate(() => {
    for (const pc of window.__wrappedPcs || [])
      pc.getStats = async () => {
        throw new Error("Injected stats failure for indicator acceptance");
      };
  });
  await page
    .getByTestId("network-status")
    .filter({ hasText: "Connection data unavailable" })
    .waitFor({ timeout: 10000 });
  results.push({ stage: "stats-failure", ...(await snapshot(page)) });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await page.screenshot({
      path: `docs/call-ui/screenshots/network-unavailable-${size.width}x${size.height}.png`,
      animations: "disabled",
    });
  }
  assert.equal(
    await peerA.page.getByTestId("call-root").getAttribute("data-call-phase"),
    "connected",
  );
} catch (error) {
  results.push({ error: error.stack });
  process.exitCode = 1;
} finally {
  await ctx.stop();
  await fs.writeFile(
    "docs/call-ui/verification/network-live.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
}
