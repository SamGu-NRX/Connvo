// Keep a Chromium peer open while the operator joins the printed URL in Safari.
import fs from "node:fs/promises";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
const ctx = new RunContext({
  transport: "p2p",
  page: "real",
  baseUrl: "http://localhost:3105",
  warmUp: false,
});
const result = {
  browser:
    "Native Safari 26.6.2 through CUA with physical MacBook Pro camera and Fifine microphone",
  startedAt: new Date().toISOString(),
};
try {
  await ctx.start();
  ctx.newMeeting("lane5-native-safari");
  const peer = await ctx.launchPeer("B");
  const url = `http://localhost:3105/app/call/${ctx.meetingId}?as=A&signal=${encodeURIComponent(ctx.signalUrl)}`;
  await fs.writeFile("/tmp/connvo-lane5-safari-url", url + "\n");
  console.log("Safari URL:", url);
  await peer.page
    .locator('[data-call-phase="connected"]')
    .waitFor({ timeout: 180000 });
  await peer.page.waitForFunction(
    () => {
      const v = document.querySelector('[data-testid="remote-media"] video');
      return v?.readyState >= 2 && v.videoWidth > 0;
    },
    {},
    { timeout: 180000 },
  );
  const before = await peer.page
    .locator('[data-testid="remote-media"] video')
    .evaluate((v) => v.currentTime);
  await peer.page.waitForFunction(
    (before) =>
      document.querySelector('[data-testid="remote-media"] video').currentTime >
      before + 0.5,
    before,
    { timeout: 30000 },
  );
  result.safariCameraReceivedByChromium = await peer.page
    .locator('[data-testid="remote-media"] video')
    .evaluate((v) => ({
      readyState: v.readyState,
      width: v.videoWidth,
      height: v.videoHeight,
      currentTime: v.currentTime,
      tracks: v.srcObject
        .getTracks()
        .map((t) => ({ kind: t.kind, muted: t.muted, ready: t.readyState })),
    }));
  console.log(JSON.stringify(result, null, 2));
  // This bounded hold allows a native Safari screenshot after the media assertion.
  await peer.page.waitForTimeout(60000);
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  await ctx.stop();
  await fs.writeFile(
    "docs/call-ui/verification/safari-native.json",
    JSON.stringify(result, null, 2) + "\n",
  );
}
