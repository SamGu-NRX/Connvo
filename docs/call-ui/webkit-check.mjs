// Synthetic capture checks WebKit's real page and WebRTC, not camera permissions/hardware.
import assert from "node:assert/strict";
import { syntheticCaptureInit } from "./webkit-synthetic-capture.mjs";
import fs from "node:fs/promises";
import { webkit } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
const base = "http://localhost:3105";
const results = [];
const evidenceName = process.env.WEBKIT_EVIDENCE_NAME ?? "webkit";
const ctx = new RunContext({
  transport: "p2p",
  page: "real",
  baseUrl: base,
  warmUp: false,
});
let browser;
const peers = [];
let stage = "start";
try {
  await ctx.start();
  ctx.newMeeting("lane5-webkit");
  browser = await webkit.launch({ headless: true });
  for (const id of ["A", "B"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript(syntheticCaptureInit, { id });
    const page = await context.newPage();
    peers.push(page);
    page.on("pageerror", (error) =>
      results.push({ check: `pageerror-${id}`, error: error.message }),
    );
    await page.goto(
      `${base}/app/call/${ctx.meetingId}?as=${id}&signal=${encodeURIComponent(ctx.signalUrl)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByTestId("join-call").waitFor();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="join-call"]').disabled,
    );
    await page.waitForFunction(
      () => {
        const video = document.querySelector("video");
        return video?.readyState >= 2 && video.videoWidth > 0;
      },
      null,
      { timeout: 10000 },
    );
    results.push({
      check: `local-preview-${id}`,
      state: await page
        .locator("video")
        .first()
        .evaluate((video) => ({
          readyState: video.readyState,
          width: video.videoWidth,
          time: video.currentTime,
          muted: video.muted,
          playsInline: video.playsInline,
        })),
    });
    if (id === "A") {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.screenshot({
          path: `docs/call-ui/screenshots/${evidenceName}-lobby-${viewport.width}x${viewport.height}.png`,
          animations: "disabled",
        });
      }
      const axe = await new AxeBuilder({ page })
        .include("[data-call-phase]")
        .analyze();
      results.push({
        check: "webkit-lobby-axe",
        violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact })),
      });
    }
    if (id === "A" && process.env.WEBKIT_COMPARE_STREAMS === "1") {
      results.push({
        check: "same-page-stream-comparison",
        state: await page.evaluate(async () => {
          const app = document.querySelector("video");
          const observe = (v) => ({
            readyState: v.readyState,
            width: v.videoWidth,
            time: v.currentTime,
            paused: v.paused,
            muted: v.muted,
            playsInline: v.playsInline,
            hidden: getComputedStyle(v).visibility,
            display: getComputedStyle(v).display,
          });
          const copy = document.createElement("video");
          copy.muted = true;
          copy.playsInline = true;
          copy.autoplay = true;
          copy.style.cssText = "width:320px;height:180px";
          document.body.append(copy);
          copy.srcObject = app.srcObject;
          void copy.play().catch(() => {});
          const videoOnly = document.createElement("video");
          videoOnly.muted = true;
          videoOnly.playsInline = true;
          videoOnly.autoplay = true;
          videoOnly.style.cssText = "width:320px;height:180px";
          document.body.append(videoOnly);
          videoOnly.srcObject = new MediaStream(app.srcObject.getVideoTracks());
          void videoOnly.play().catch(() => {});
          const fresh = document.createElement("video");
          fresh.muted = true;
          fresh.playsInline = true;
          fresh.autoplay = true;
          fresh.style.cssText = "width:320px;height:180px";
          document.body.append(fresh);
          const freshStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
          });
          fresh.srcObject = freshStream;
          void fresh.play().catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const result = {
            app: observe(app),
            sameStreamOnPlainVideo: observe(copy),
            appVideoTrackAlone: observe(videoOnly),
            freshCaptureOnPlainVideo: observe(fresh),
          };
          window.__retainedPlainVideo = copy;
          copy.id = "retained-plain-consumer";
          copy.setAttribute("aria-hidden", "true");
          copy.style.cssText =
            "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
          fresh.srcObject = null;
          freshStream.getTracks().forEach((track) => track.stop());
          fresh.remove();
          videoOnly.srcObject = null;
          videoOnly.remove();
          return result;
        }),
      });
    }
    await page.getByTestId("join-call").click();
    if (id === "A" && process.env.WEBKIT_COMPARE_STREAMS === "1") {
      await page
        .waitForFunction(
          () =>
            document.querySelector('[data-testid="local-video"]')?.readyState >=
            2,
          null,
          { timeout: 2000 },
        )
        .catch(() => {});
      results.push({
        check: "after-join-retained-consumer",
        state: await page.evaluate(() => {
          const app = document.querySelector('[data-testid="local-video"]'),
            plain = window.__retainedPlainVideo;
          const observe = (v) =>
            v
              ? {
                  readyState: v.readyState,
                  width: v.videoWidth,
                  time: v.currentTime,
                  paused: v.paused,
                  tracks: v.srcObject
                    ?.getTracks()
                    .map((t) => ({
                      kind: t.kind,
                      ready: t.readyState,
                      muted: t.muted,
                    })),
                }
              : null;
          return {
            app: observe(app),
            plain: observe(plain),
            sameVideoTrack:
              app?.srcObject?.getVideoTracks()[0] ===
              plain?.srcObject?.getVideoTracks()[0],
          };
        }),
      });
    }
  }
  for (const page of peers) {
    await page
      .locator('[data-call-phase="connected"]')
      .waitFor({ timeout: 30000 });
    stage = "remote video decoded";
    await page.waitForFunction(() => {
      const video = document.querySelector(
        '[data-testid="remote-media"] video',
      );
      return video && video.readyState >= 2 && video.videoWidth > 0;
    });
    stage = "remote video time advances";
    const before = await page
      .locator('[data-testid="remote-media"] video')
      .evaluate((video) => video.currentTime);
    await page.waitForFunction(
      (before) =>
        document.querySelector('[data-testid="remote-media"] video')
          .currentTime >
        before + 0.5,
      before,
    );
  }
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await peers[0].setViewportSize(viewport);
    await peers[0].screenshot({
      path: `docs/call-ui/screenshots/${evidenceName}-connected-${viewport.width}x${viewport.height}.png`,
      animations: "disabled",
    });
  }
  await peers[0].getByTestId("toggle-mic").click();
  await peers[1]
    .locator('[data-testid="remote-media"][data-audio-muted="true"]')
    .waitFor();
  await peers[0].getByTestId("toggle-camera").click();
  await peers[1]
    .locator('[data-testid="remote-media"][data-video-off="true"]')
    .waitFor();
  await peers[0].getByTestId("leave-call").click();
  await peers[0].getByTestId("leave-call-confirm").click();
  assert.equal(
    await peers[0].getByTestId("call-root").getAttribute("data-call-phase"),
    "left",
  );
  results.push({
    check: "webkit-two-peer-synthetic-media",
    pass: true,
    coverage:
      "Remote video time advances in both directions; mute and camera state reach partner; leave completes. Physical capture, iOS autoplay and audio decoding not established.",
  });
} catch (error) {
  results.push({ check: "webkit-call", stage, error: error.message });
  for (const page of peers)
    results.push({
      check: "playback-diagnostic",
      state: await page.evaluate(() => ({
        capture: {
          ...window.__captureDiagnostic,
          current: navigator.mediaDevices.getUserMedia.toString(),
        },
        phase: document
          .querySelector("[data-call-phase]")
          ?.getAttribute("data-call-phase"),
        videos: [...document.querySelectorAll("video")].map((v) => ({
          testId: v.getAttribute("data-testid"),
          id: v.id,
          remote: !!v.closest('[data-testid="remote-media"]'),
          readyState: v.readyState,
          paused: v.paused,
          width: v.videoWidth,
          time: v.currentTime,
          tracks: v.srcObject?.getTracks().map((t) => ({
            kind: t.kind,
            ready: t.readyState,
            enabled: t.enabled,
            muted: t.muted,
          })),
        })),
        text: document.querySelector("[data-call-phase]")?.textContent,
      })),
    });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await ctx.stop();
}
await fs.writeFile(
  `docs/call-ui/verification/${evidenceName}.json`,
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results, null, 2));
