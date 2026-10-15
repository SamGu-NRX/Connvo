// Browser-only capture probes. Every URL is fulfilled with plain HTML, without Connvo.
import fs from "node:fs/promises";
import { syntheticCaptureInit } from "./webkit-synthetic-capture.mjs";
import { webkit } from "@playwright/test";
const browser = await webkit.launch({ headless: true });
let page = await browser.newPage();
const result = { browser: browser.version(), scenarios: [] };
try {
  await page.route("http://localhost:3105/__webkit-capture-minimal", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>WebKit capture isolation</title><body></body>",
    }),
  );
  await page.goto("http://localhost:3105/__webkit-capture-minimal");
  result.capture = await page.evaluate(async () => {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new DOMException(
                  "No capture permission response within 3 seconds",
                  "TimeoutError",
                ),
              ),
            3000,
          ),
        ),
      ]);
      const tracks = stream
        .getTracks()
        .map((t) => ({ kind: t.kind, label: t.label, ready: t.readyState }));
      stream.getTracks().forEach((t) => t.stop());
      return { success: true, tracks };
    } catch (error) {
      return { success: false, name: error.name, message: error.message };
    }
  });
  const injectedContext = await browser.newContext();
  await injectedContext.addInitScript(syntheticCaptureInit, { id: "A" });
  const injected = await injectedContext.newPage();
  await injected.route(
    "http://localhost:3105/__webkit-injected-capture",
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><video muted autoplay playsinline></video><script>navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(stream=>{const video=document.querySelector('video');video.srcObject=stream;video.play().catch(()=>{});window.captured=stream;});</script>`,
      }),
  );
  await injected.goto("http://localhost:3105/__webkit-injected-capture");
  await injected.waitForTimeout(2000);
  result.injectedCapturePlayback = await injected.evaluate(() => {
    const video = document.querySelector("video");
    return {
      readyState: video.readyState,
      width: video.videoWidth,
      time: video.currentTime,
      paused: video.paused,
      muted: video.muted,
      playsInline: video.playsInline,
      capture: window.__captureDiagnostic,
      tracks: window.captured
        ?.getTracks()
        .map((t) => ({ kind: t.kind, ready: t.readyState, muted: t.muted })),
    };
  });
  await injected.evaluate(() => {
    const old = document.querySelector("video");
    old.srcObject = null;
    old.remove();
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    document.body.append(video);
    video.srcObject = window.captured;
    void video.play().catch(() => {});
  });
  await injected.waitForTimeout(2000);
  result.injectedCaptureAfterRebind = await injected.evaluate(() => {
    const video = document.querySelector("video");
    return {
      readyState: video.readyState,
      width: video.videoWidth,
      time: video.currentTime,
      paused: video.paused,
      tracks: window.captured
        .getTracks()
        .map((t) => ({ kind: t.kind, ready: t.readyState })),
    };
  });
  await injectedContext.close();
  result.webrtcWithoutCapturePermission = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const paint = canvas.getContext("2d");
    let frame = 0;
    const timer = setInterval(() => {
      paint.fillStyle = frame++ % 2 ? "red" : "blue";
      paint.fillRect(0, 0, 320, 180);
    }, 50);
    const stream = canvas.captureStream(20);
    const a = new RTCPeerConnection({ iceServers: [] }),
      b = new RTCPeerConnection({ iceServers: [] });
    const candidates = { a: 0, b: 0 };
    const errors = [];
    const forward = (from, to, key) =>
      (from.onicecandidate = (event) => {
        if (event.candidate) {
          candidates[key]++;
          void to
            .addIceCandidate(event.candidate)
            .catch((e) => errors.push(e.name));
        }
      });
    forward(a, b, "a");
    forward(b, a, "b");
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    document.body.append(video);
    b.ontrack = (event) => {
      video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void video.play().catch((e) => errors.push(e.name));
    };
    stream.getTracks().forEach((track) => a.addTrack(track, stream));
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline && video.readyState < 2)
      await new Promise((resolve) => setTimeout(resolve, 100));
    const result = {
      connectionA: a.connectionState,
      connectionB: b.connectionState,
      iceA: a.iceConnectionState,
      iceB: b.iceConnectionState,
      candidates,
      remoteReadyState: video.readyState,
      remoteWidth: video.videoWidth,
      errors,
    };
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    a.close();
    b.close();
    video.remove();
    return result;
  });
  for (const attached of [false, true]) {
    for (const withAudio of [false, true]) {
      for (const stopPrevious of [false, true]) {
        result.scenarios.push(
          await page.evaluate(
            async ({ attached, withAudio, stopPrevious }) => {
              const canvas = document.createElement("canvas");
              canvas.width = 640;
              canvas.height = 360;
              if (attached) document.body.append(canvas);
              const paint = canvas.getContext("2d");
              let frame = 0;
              const timer = setInterval(() => {
                paint.fillStyle = frame++ % 2 ? "red" : "blue";
                paint.fillRect(0, 0, 640, 360);
              }, 50);
              if (stopPrevious)
                canvas
                  .captureStream(20)
                  .getTracks()
                  .forEach((track) => track.stop());
              const stream = canvas.captureStream(20);
              let audio;
              if (withAudio) {
                audio = new AudioContext();
                const oscillator = audio.createOscillator();
                const dest = audio.createMediaStreamDestination();
                oscillator.connect(dest);
                oscillator.start();
                stream.addTrack(dest.stream.getAudioTracks()[0]);
              }
              const video = document.createElement("video");
              video.autoplay = true;
              video.muted = true;
              video.playsInline = true;
              document.body.append(video);
              video.srcObject = stream;
              let playback = "pending";
              video
                .play()
                .then(() => (playback = "fulfilled"))
                .catch((e) => (playback = e.name));
              await new Promise((resolve) => setTimeout(resolve, 1500));
              const before = video.currentTime;
              await new Promise((resolve) => setTimeout(resolve, 500));
              const outcome = {
                attached,
                withAudio,
                stopPrevious,
                playback,
                readyState: video.readyState,
                width: video.videoWidth,
                time: video.currentTime,
                advances: video.currentTime > before,
                tracks: stream.getTracks().map((t) => ({
                  kind: t.kind,
                  muted: t.muted,
                  ready: t.readyState,
                })),
              };
              clearInterval(timer);
              stream.getTracks().forEach((t) => t.stop());
              await audio?.close();
              video.remove();
              canvas.remove();
              return outcome;
            },
            { attached, withAudio, stopPrevious },
          ),
        );
      }
    }
  }
  const crossPage = async (shared) => {
    const common = shared ? await browser.newContext() : null;
    const paired = [];
    for (const id of ["A", "B"]) {
      const context = common ?? (await browser.newContext());
      const peer = await context.newPage();
      await peer.addInitScript(syntheticCaptureInit, { id });
      await peer.route("http://localhost:3105/__webkit-cross-page", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><video id=local autoplay muted playsinline></video><video id=remote autoplay muted playsinline></video>",
        }),
      );
      await peer.goto("http://localhost:3105/__webkit-cross-page");
      await peer.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        window.source = stream;
        const local = document.querySelector("#local");
        local.srcObject = stream;
        void local.play().catch(() => {});
        const pc = new RTCPeerConnection({ iceServers: [] });
        window.pc = pc;
        window.candidates = [];
        pc.onicecandidate = (e) => {
          if (e.candidate) window.candidates.push(e.candidate.toJSON());
        };
        pc.ontrack = (e) => {
          const v = document.querySelector("#remote");
          v.srcObject = e.streams[0] ?? new MediaStream([e.track]);
          void v.play().catch(() => {});
        };
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      });
      paired.push({ peer, context });
    }
    const a = paired[0].peer,
      b = paired[1].peer;
    const offer = await a.evaluate(async () => {
      await window.pc.setLocalDescription(await window.pc.createOffer());
      return window.pc.localDescription.toJSON();
    });
    await b.evaluate((d) => window.pc.setRemoteDescription(d), offer);
    const answer = await b.evaluate(async () => {
      await window.pc.setLocalDescription(await window.pc.createAnswer());
      return window.pc.localDescription.toJSON();
    });
    await a.evaluate((d) => window.pc.setRemoteDescription(d), answer);
    for (const { peer } of paired)
      await peer.waitForFunction(
        () => window.pc.iceGatheringState === "complete",
        null,
        { timeout: 10000 },
      );
    const ca = await a.evaluate(() => window.candidates),
      cb = await b.evaluate(() => window.candidates);
    await a.evaluate(async (list) => {
      for (const c of list) await window.pc.addIceCandidate(c);
    }, cb);
    await b.evaluate(async (list) => {
      for (const c of list) await window.pc.addIceCandidate(c);
    }, ca);
    await Promise.all(
      paired.map(({ peer }) =>
        peer
          .waitForFunction(
            () => document.querySelector("#remote").readyState >= 2,
            null,
            { timeout: 10000 },
          )
          .catch(() => {}),
      ),
    );
    const observations = [];
    for (const { peer, context } of paired) {
      observations.push(
        await peer.evaluate(async () => ({
          visibility: document.visibilityState,
          connection: window.pc.connectionState,
          ice: window.pc.iceConnectionState,
          candidates: window.candidates.length,
          videos: [...document.querySelectorAll("video")].map((v) => ({
            id: v.id,
            readyState: v.readyState,
            width: v.videoWidth,
            time: v.currentTime,
            paused: v.paused,
            tracks: v.srcObject?.getTracks().map((t) => ({
              kind: t.kind,
              ready: t.readyState,
              muted: t.muted,
            })),
          })),
          stats: [...(await window.pc.getStats()).values()]
            .filter(
              (s) => s.type === "outbound-rtp" || s.type === "inbound-rtp",
            )
            .map((s) => ({
              type: s.type,
              kind: s.kind,
              framesEncoded: s.framesEncoded,
              framesDecoded: s.framesDecoded,
              bytesSent: s.bytesSent,
              bytesReceived: s.bytesReceived,
            })),
        })),
      );
    }
    for (const context of new Set(paired.map((p) => p.context)))
      await context.close();
    return observations;
  };
  result.crossPageSynthetic = {
    separateContexts: await crossPage(false),
    sameContext: await crossPage(true),
  };
} finally {
  await browser.close();
}
await fs.writeFile(
  "docs/call-ui/verification/webkit-capture-minimal.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
