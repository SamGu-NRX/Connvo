// Synthetic capture checks WebKit's real page and WebRTC, not camera permissions/hardware.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { webkit } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
const base = "http://localhost:3105";
const results = [];
const ctx = new RunContext({ transport: "p2p", page: "real", baseUrl: base, warmUp: false });
let browser;
const peers = [];
let stage = "start";
try {
  await ctx.start();
  ctx.newMeeting("lane5-webkit");
  browser = await webkit.launch({ headless: true });
  for (const id of ["A", "B"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ id }) => {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      oscillator.frequency.value = id === "A" ? 440 : 660;
      const output = audio.createMediaStreamDestination();
      oscillator.connect(output); oscillator.start();
      document.addEventListener("click", () => void audio.resume());
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
      const paint = canvas.getContext("2d");
      let frame = 0;
      setInterval(() => { paint.fillStyle = id === "A" ? "#bc3434" : "#157b58"; paint.fillRect(0, 0, 640, 360); paint.fillStyle = "white"; paint.fillRect((frame++ * 4) % 640, 80, 30, 200); }, 50);
      navigator.mediaDevices.getUserMedia = async options => {
        const tracks = [];
        if (options.audio) tracks.push(output.stream.getAudioTracks()[0].clone());
        if (options.video) tracks.push(canvas.captureStream(20).getVideoTracks()[0]);
        return new MediaStream(tracks);
      };
      navigator.mediaDevices.enumerateDevices = async () => [
        { kind: "videoinput", deviceId: "synthetic-camera", label: "Synthetic WebKit camera", groupId: "test" },
        { kind: "audioinput", deviceId: "synthetic-mic", label: "Synthetic WebKit microphone", groupId: "test" },
      ];
    }, { id });
    const page = await context.newPage();
    page.on("pageerror", error => results.push({ check: `pageerror-${id}`, error: error.message }));
    await page.goto(`${base}/app/call/${ctx.meetingId}?as=${id}&signal=${encodeURIComponent(ctx.signalUrl)}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("join-call").waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="join-call"]').disabled);
    if (id === "A") {
      for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
        await page.setViewportSize(viewport);
        await page.screenshot({path:`docs/call-ui/screenshots/webkit-lobby-${viewport.width}x${viewport.height}.png`,animations:"disabled"});
      }
      const axe = await new AxeBuilder({ page }).include('[data-call-phase]').analyze();
      results.push({ check: "webkit-lobby-axe", violations: axe.violations.map(v=>({id:v.id,impact:v.impact})) });
    }
    await page.getByTestId("join-call").click();
    peers.push(page);
  }
  for (const page of peers) {
    await page.locator('[data-call-phase="connected"]').waitFor({ timeout: 30000 });
    stage = "remote video decoded";
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-testid="remote-media"] video');
      return video && video.readyState >= 2 && video.videoWidth > 0;
    });
    stage = "remote video time advances";
    const before = await page.locator('[data-testid="remote-media"] video').evaluate(video=>video.currentTime);
    await page.waitForFunction(before => document.querySelector('[data-testid="remote-media"] video').currentTime > before + .5, before);
  }
  for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
    await peers[0].setViewportSize(viewport);
    await peers[0].screenshot({path:`docs/call-ui/screenshots/webkit-connected-${viewport.width}x${viewport.height}.png`,animations:"disabled"});
  }
  await peers[0].getByTestId("toggle-mic").click();
  await peers[1].locator('[data-testid="remote-media"][data-audio-muted="true"]').waitFor();
  await peers[0].getByTestId("toggle-camera").click();
  await peers[1].locator('[data-testid="remote-media"][data-video-off="true"]').waitFor();
  await peers[0].getByTestId("leave-call").click();
  await peers[0].getByTestId("leave-call-confirm").click();
  assert.equal(await peers[0].getByTestId("call-root").getAttribute("data-call-phase"), "left");
  results.push({check:"webkit-two-peer-synthetic-media",pass:true,coverage:"Remote video time advances in both directions; mute and camera state reach partner; leave completes. Physical capture, iOS autoplay and audio decoding not established."});
} catch(error) {
  results.push({ check: "webkit-call", stage, error: error.message });
  for (const page of peers) results.push({check:"playback-diagnostic",state:await page.evaluate(() => ({phase:document.querySelector('[data-call-phase]')?.getAttribute('data-call-phase'),videos:[...document.querySelectorAll('video')].map(v=>({remote:!!v.closest('[data-testid="remote-media"]'),readyState:v.readyState,paused:v.paused,width:v.videoWidth,time:v.currentTime,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,ready:t.readyState,enabled:t.enabled,muted:t.muted}))})),text:document.querySelector('[data-call-phase]')?.textContent}))});
  process.exitCode = 1;
}
finally { await browser?.close(); await ctx.stop(); }
await fs.writeFile("docs/call-ui/verification/webkit.json",JSON.stringify(results,null,2)+"\n");
console.log(JSON.stringify(results,null,2));
