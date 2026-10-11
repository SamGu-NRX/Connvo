/**
 * H-01..H-16. Every function is named scenario_<id> (the orchestrator binds
 * by name) and returns the plan-schema measurement object for its result
 * entry. Pass conditions live verbatim in lib/scenario-contracts.ts and are
 * echoed by the summary; the assertions below implement them.
 */
import {
  ScenarioError,
  waitFor,
  waitForValue,
  phaseIs,
  waitAttr,
  click,
  joinPair,
  timeToFirstRemoteFrame,
  assertProbePresent,
} from "./scenario-kit.mjs";
import { killPeerTab } from "./peers.mjs";
import {
  decodeRemoteFrame,
  matchPeerColor,
  sampleRemoteTone,
  measureFps,
  collectRtpStatsWindow,
  probeState,
  decoderBundle,
  toneMatches,
  toneIsSilent,
} from "./page-helpers.mjs";

const H = (ms) => new Promise((r) => setTimeout(r, ms));

const tileCount = (participantId) =>
  `() => document.querySelectorAll('[data-testid="remote-media"][data-participant-id="${participantId}"]').length`;

const tileCountAll = `() => document.querySelectorAll('[data-testid="remote-media"]').length`;

// Node-side color assertions go through one page-side hook wrapping the pinned
// decoder bundle; tolerant classification per the S0b cross-thread note.
async function installColorHook(peer) {
  const bundleSrc = await decoderBundle();
  await peer.page.evaluate(`(bundleSrc => {
    if (!window.__decodeRemoteColor) {
      window.__decodeRemoteColor = async (participantId) => {
        const decoders = new Function(bundleSrc + "\\nreturn { decodeBarcodeColor };")();
        const tile = document.querySelector('[data-testid="remote-media"][data-participant-id="' + participantId + '"]');
        const video = tile?.querySelector("video");
        if (!video || !video.videoWidth) return { ok: false, label: "none", distance: 999 };
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, Math.min(200, canvas.height));
        return decoders.decodeBarcodeColor(data);
      };
    }
  })(${JSON.stringify(bundleSrc)})`);
}

/** H-01 — each decodes the other's barcode color within 5 s; remote frames advance at >= 15 fps over 5 s */
export async function scenario_H_01(ctx, { log }) {
  const { peerA, peerB, tJoinMs } = await joinPair(ctx);
  await assertProbePresent(peerA);
  await assertProbePresent(peerB);
  await installColorHook(peerA);
  await installColorHook(peerB);

  const t0 = Date.now();
  const aSeesB = await timeToFirstRemoteFrame(peerA, "B", t0);
  const bSeesA = await timeToFirstRemoteFrame(peerB, "A", t0);

  const colorA = await decodeRemoteFrame(peerA, "B");
  const colorB = await decodeRemoteFrame(peerB, "A");
  const matchB = matchPeerColor(colorA.color); // A's view of B must be B's green
  const matchA = matchPeerColor(colorB.color);
  if (!matchB.ok || matchB.label !== "B") {
    throw new ScenarioError(`H-01: A's view of B classified as ${matchB.label} (distance ${matchB.distance})`, { colorA });
  }
  if (!matchA.ok || matchA.label !== "A") {
    throw new ScenarioError(`H-01: B's view of A classified as ${matchA.label} (distance ${matchA.distance})`, { colorB });
  }

  const fpsA = await measureFps(peerA, "B", 5000); // A receiving B
  const fpsB = await measureFps(peerB, "A", 5000);
  if (fpsA.fps < 15 || fpsB.fps < 15) {
    throw new ScenarioError(`H-01: fps below 15 (A sees ${fpsA.fps}, B sees ${fpsB.fps})`, { fpsA, fpsB });
  }
  log(`H-01 join ${tJoinMs} ms, first frame ${aSeesB.ms}/${bSeesA.ms} ms, fps ${fpsA.fps}/${fpsB.fps}`);
  return {
    joinMs: tJoinMs,
    timeToFirstRemoteFrameMs: aSeesB.ms,
    timeToFirstRemoteFrameMsReverse: bSeesA.ms,
    fpsAtoB: fpsA.fps,
    fpsBtoA: fpsB.fps,
  };
}

/** H-02 — each receiver's analyser peak is the sender's tone +-10 Hz within 3 s */
export async function scenario_H_02(ctx) {
  const { peerA, peerB } = await joinPair(ctx);

  async function toneWithin(peer, from, expected, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    for (;;) {
      last = await sampleRemoteTone(peer, from, 400); // jitter-buffer settle: stale pre-join samples read as silence
      // decodeToneHz returns { peakHz, rms } — the reviewed bug did
      // arithmetic on the object (NaN), so no healthy call ever matched.
      if (toneMatches(last, expected)) return last.peakHz;
      if (Date.now() > deadline) {
        const heard = last ? `${last.peakHz} Hz (rms ${last.rms})` : "silence";
        throw new ScenarioError(`H-02: ${peer.peerId} heard ${heard}, expected ${expected}±10 Hz from ${from}`);
      }
      await H(200);
    }
  }

  const aHears = await toneWithin(peerA, "B", 660);
  const bHears = await toneWithin(peerB, "A", 440);
  return { aHearsB: aHears, bHearsA: bHears };
}

/** H-03 — remote data-audio-muted flips within 1 s; received tone energy falls below threshold; unmute restores both */
export async function scenario_H_03(ctx) {
  const { peerA, peerB } = await joinPair(ctx);

  const t0 = Date.now();
  await click(peerA, "toggle-mic");
  await waitAttr(peerB, "A", "data-audio-muted", "true", 1000);
  const muteFlipMs = Date.now() - t0;

  // No tone energy while muted. decodeToneHz returns { peakHz, rms }: the
  // reviewed bug compared the object to 0, which threw on every healthy
  // muted call. Digital silence decodes to peakHz 0 (rms < 1e-6) and counts
  // as muted; sub-floor noise energy counts as muted too.
  const mutedTone = await sampleRemoteTone(peerB, "A", 700);
  if (!toneIsSilent(mutedTone)) {
    throw new ScenarioError(
      `H-03: muted remote still produced energy (peak ${mutedTone.peakHz} Hz, rms ${mutedTone.rms})`,
      { mutedTone },
    );
  }

  const t1 = Date.now();
  await click(peerA, "toggle-mic");
  await waitAttr(peerB, "A", "data-audio-muted", "false", 1000);
  const unmuteFlipMs = Date.now() - t1;

  const deadline = Date.now() + 3000;
  let restored = null;
  for (;;) {
    restored = await sampleRemoteTone(peerB, "A", 500);
    if (toneMatches(restored, 440)) break; // reads restored.peakHz (the reviewed NaN bug compared the object)
    if (Date.now() > deadline) {
      const heard = restored ? `${restored.peakHz} Hz (rms ${restored.rms})` : "silence";
      throw new ScenarioError(`H-03: unmute did not restore the 440 Hz tone (last ${heard})`);
    }
    await H(200);
  }
  return { muteFlipMs, unmuteFlipMs, restoredToneHz: restored.peakHz };
}

/** H-04 — remote data-video-off flips within 1 s; the sender's capture track is ended (camera released); on resumes frames */
export async function scenario_H_04(ctx) {
  const { peerA, peerB } = await joinPair(ctx);

  const t0 = Date.now();
  await click(peerA, "toggle-camera");
  await waitAttr(peerB, "A", "data-video-off", "true", 1000);
  const offFlipMs = Date.now() - t0;

  const trackStates = await peerA.page.evaluate(`(() => (window.__h11tracks ?? []).map(t => t.readyState))()`);
  if (!trackStates.includes("ended")) {
    throw new ScenarioError(`H-04: sender's capture track is not ended (${JSON.stringify(trackStates)})`);
  }

  await click(peerA, "toggle-camera");
  await waitAttr(peerB, "A", "data-video-off", "false", 5000);
  const fps = await measureFps(peerB, "A", 4000);
  if (fps.fps < 10) throw new ScenarioError(`H-04: frames did not resume (${fps.fps} fps)`, { fps });
  return { offFlipMs, resumedFps: fps.fps };
}

/** H-05 — switching to the second fake camera keeps frames flowing without a failed phase */
export async function scenario_H_05(ctx) {
  const { peerA, peerB } = await joinPair(ctx);
  await installColorHook(peerB);

  const before = await measureFps(peerB, "A", 1500);
  await click(peerA, "switch-camera");
  const during = await measureFps(peerB, "A", 2500);
  const phase = await waitFor(peerA, phaseIs("connected"), { timeoutMs: 5000, describe: "phase staying connected after switch" });

  const color = await waitForValue(
    peerB,
    `async () => await window.__decodeRemoteColor("A")`,
    (c) => c?.ok && c.label === "second-camera",
    { timeoutMs: 15000, describe: "second-camera color on B's tile" },
  );
  const after = await measureFps(peerB, "A", 2000);
  if (during.fps === 0 && after.fps === 0) {
    throw new ScenarioError("H-05: frames stopped flowing after the switch", { before, during, after });
  }
  return { fpsBefore: before.fps, fpsDuring: during.fps, fpsAfter: after.fps, phase, colorDistance: color.distance };
}

/** H-06 — context without media permission shows an actionable error; granting and retry-media joins */
export async function scenario_H_06(ctx) {
  const { launchPeer: launch } = await import("./peers.mjs");
  const { video, audio } = ctx.fixturePaths("A");
  // Full Chromium build: the headless shell cannot run the real permission
  // flow, and no fake-UI flag means headless denies the prompt.
  const peerA = await launch({
    fixtureVideo: video,
    fixtureAudio: audio,
    baseUrl: ctx.url,
    fullChromium: true,
    participant: "A",
  });
  try {
    const query = new URLSearchParams({ as: "A", meeting: ctx.meetingId });
    await peerA.page.goto(`${ctx.url}${ctx.benchPath}?${query}`, { waitUntil: "domcontentloaded" });

    await waitFor(peerA, `() => !!document.querySelector('[data-testid="call-error"]').textContent`, {
      timeoutMs: 10000,
      describe: "actionable error to appear",
    });
    const text = await peerA.page.evaluate(`(() => document.querySelector('[data-testid="call-error"]').textContent)()`);
    const retryVisible = await peerA.page.evaluate(`(() => !document.querySelector('[data-testid="retry-media"]').hidden)()`);
    if (!retryVisible) throw new ScenarioError("H-06: retry-media button not offered", { text });

    await peerA.context.grantPermissions(["camera", "microphone"], { origin: ctx.url });
    await click(peerA, "retry-media");
    await waitFor(peerA, phaseIs("connected"), { timeoutMs: 20000, describe: "connected after granting + retry" });
    return { errorText: text.slice(0, 120), joinedAfterRetry: true };
  } finally {
    await peerA.close();
  }
}

/** H-07 — one peer offline 3 s, 10 s, 30 s: honest reconnecting, media resumes within 10 s of restore, no duplicate tiles */
export async function scenario_H_07(ctx, { seed }) {
  ctx.enableRelay();
  await ctx.shaperFor("B").ready; // B's own shaper; A stays on host candidates
  const { peerA, peerB } = await joinPair(ctx);

  const recoveries = [];
  for (const durationS of [3, 10, 30]) {
    ctx.shaperFor("B").applyProfile({ lossPct: 100, delayMs: 0 });
    ctx.killPeerSocket("B"); // signaling gone too

    await waitFor(peerB, phaseIs("reconnecting"), {
      timeoutMs: 15000,
      describe: `honest reconnecting during ${durationS}s drop`,
    });
    await H(durationS * 1000);

    ctx.shaperFor("B").applyProfile({ lossPct: 0, delayMs: 0 });
    const restoreAt = Date.now();
    await waitFor(peerB, phaseIs("connected"), {
      timeoutMs: 10000,
      describe: `reconnected within 10 s of restore (${durationS}s drop)`,
    });
    // Media resumes: B decodes A again.
    await waitForValue(
      peerB,
      `async () => { const c = await window.__decodeRemoteColor("A"); return { ok: c?.ok, label: c?.label }; }`,
      (c) => c.ok,
      { timeoutMs: 10000, describe: `media resumed within 10 s (${durationS}s drop)` },
    );
    const recoveryMs = Date.now() - restoreAt;

    const tilesA = await peerA.page.evaluate(tileCountAll);
    const tilesB = await peerB.page.evaluate(tileCountAll);
    if (tilesA !== 1 || tilesB !== 1) {
      throw new ScenarioError(`H-07: duplicate tiles after ${durationS}s drop (A:${tilesA}, B:${tilesB})`);
    }
    recoveries.push({ durationS, recoveryMs, tilesA, tilesB });
  }
  return { seed, drops: recoveries, recovery10sMs: recoveries.find((r) => r.durationS === 10)?.recoveryMs };
}

/** H-08 — recovers within 10 s (signaling outage mid-call: both sockets die at once) */
export async function scenario_H_08(ctx) {
  const { peerA, peerB } = await joinPair(ctx);

  ctx.killPeerSocket("A"); // relay-outage observable: all sockets die at once
  ctx.killPeerSocket("B");
  await waitFor(peerA, phaseIs("reconnecting"), { timeoutMs: 15000, describe: "A reconnecting" });
  await waitFor(peerB, phaseIs("reconnecting"), { timeoutMs: 15000, describe: "B reconnecting" });

  const t0 = Date.now();
  await waitFor(peerA, phaseIs("connected"), { timeoutMs: 10000, describe: "A recovered within 10 s" });
  await waitFor(peerB, phaseIs("connected"), { timeoutMs: 10000, describe: "B recovered within 10 s" });
  await waitForValue(peerA, `async () => { const c = await window.__decodeRemoteColor("B"); return { ok: c?.ok }; }`, (c) => c.ok, {
    timeoutMs: 10000,
    describe: "frames resumed",
  });
  return { recoveryMs: Date.now() - t0 };
}

/** H-09 — reloaded peer rejoins; no ghost participant after 10 s */
export async function scenario_H_09(ctx) {
  const { peerA, peerB } = await joinPair(ctx);

  await peerA.page.reload({ waitUntil: "domcontentloaded" }); // same URL: auto-rejoin
  await waitFor(peerA, phaseIs("connected"), { timeoutMs: 30000, describe: "reloaded A reconnected" });
  await waitForValue(peerB, tileCount("A"), (n) => n === 1, {
    timeoutMs: 20000,
    describe: "B sees exactly one A tile",
  });
  await H(10000); // the contract's ghost observation window
  const ghostTiles = await peerB.page.evaluate(tileCount("A"));
  if (ghostTiles !== 1) {
    throw new ScenarioError(`H-09: ghost participant after reload (${ghostTiles} A tiles)`);
  }
  await waitForValue(peerB, `async () => { const c = await window.__decodeRemoteColor("A"); return { ok: c?.ok }; }`, (c) => c.ok, {
    timeoutMs: 15000,
    describe: "ghost tile keeps decoding (it is live, not stale)",
  });
  return { ghostTiles };
}

/** H-10 — survivor shows the peer gone within 15 s */
export async function scenario_H_10(ctx) {
  const { peerA, peerB } = await joinPair(ctx);

  const closed = await killPeerTab(peerA); // CDP Target.closeTarget: no WS close frame
  if (!closed) throw new ScenarioError("H-10: failed to hard-kill peer A's tab");

  await waitForValue(peerB, tileCount("A"), (n) => n === 0, {
    timeoutMs: 15000,
    describe: "A's tile gone within 15 s (heartbeat sweep)",
  });
  const events = ctx.sessionEvents();
  return { closed, tileGone: true, sessionEvents: events.slice(-4) };
}

/** H-11 — all local tracks ended, all wrapped connections closed, no getStats traffic afterwards, server session closed */
export async function scenario_H_11(ctx) {
  const { peerA, peerB } = await joinPair(ctx);

  // Capture the local tracks BEFORE leaving: the bench nulls the video
  // element's srcObject on leave, so afterwards there is nothing to read —
  // but pre-captured track objects still report their (ended) readyState.
  await peerA.page.evaluate(`(() => {
    window.__h11tracks = [...(document.querySelector('[data-testid="local-video"]')?.srcObject?.getTracks() ?? [])];
  })()`);

  await click(peerA, "leave-call");
  await waitFor(peerA, phaseIs("left"), { timeoutMs: 5000, describe: "A's phase left" });

  // Read the PRE-CAPTURED track objects (window.__h11tracks, captured above):
  // the bench page unmounts the local-video element on leave, so a DOM read
  // would throw; the captured MediaStreamTrack objects still report their
  // post-leave readyState.
  const trackStates = await peerA.page.evaluate(`(() => (window.__h11tracks ?? []).map(t => t.readyState))()`);
  if (trackStates.length === 0 || !trackStates.every((s) => s === "ended")) {
    throw new ScenarioError(`H-11: local tracks not ended (${JSON.stringify(trackStates)})`);
  }

  const probe = await probeState(peerA);
  if (probe.connections.live !== 0 || probe.pcs.some((pc) => !pc.closed)) {
    throw new ScenarioError(`H-11: wrapped connections not closed (${JSON.stringify(probe.connections)}, ${probe.pcs.length} pcs)`);
  }

  await H(1000);
  const calls1 = (await probeState(peerA)).getStatsCalls;
  await H(1000);
  const calls2 = (await probeState(peerA)).getStatsCalls;
  if (calls1 !== calls2) {
    throw new ScenarioError(`H-11: getStats still called after leave (${calls1} -> ${calls2})`);
  }

  const events = ctx.sessionEvents();
  const leftEvent = events.find((e) => e.participant === "A" && e.reason === "leave");
  if (!leftEvent) throw new ScenarioError("H-11: no leave session event on the relay", { events });

  // B observes the departure (tile gone).
  await waitForValue(peerB, tileCount("A"), (n) => n === 0, { timeoutMs: 15000, describe: "B's tile for A removed" });
  return { trackStates, getStatsCallsStable: true, getStatsCalls: calls2, sessionEvents: events.slice(-4) };
}

/** H-12 — simultaneous join in both orders, 20 seeds: always connects */
export async function scenario_H_12(ctx, { seed }) {
  // Both join orders across the seed matrix; within one seed both pages
  // launch simultaneously (Promise.all) — offers collide from both sides.
  const flip = seed % 2 === 0;
  const a = flip ? "B" : "A";
  const b = flip ? "A" : "B";
  const { peerA, peerB } = await joinPair(ctx, { a, b });
  await waitFor(peerA, phaseIs("connected"), { timeoutMs: 30000, describe: `${a} connected` });
  await waitFor(peerB, phaseIs("connected"), { timeoutMs: 30000, describe: `${b} connected` });
  await peerA.close();
  await peerB.close();
  return { order: `${a}-first`, bothConnected: true };
}

/** H-13 — five leave/rejoin cycles: live connection and track counts return to baseline */
export async function scenario_H_13(ctx) {
  let { peerA, peerB } = await joinPair(ctx);
  const baseline = await probeState(peerA);

  for (let cycle = 1; cycle <= 5; cycle++) {
    await click(peerA, "leave-call");
    await waitFor(peerA, phaseIs("left"), { timeoutMs: 5000, describe: `cycle ${cycle}: left` });
    await peerA.close();
    // A rejoins on a fresh page; B never leaves.
    peerA = await ctx.launchPeer("A");
    await waitFor(peerA, phaseIs("connected"), { timeoutMs: 30000, describe: `cycle ${cycle}: A rejoined` });
  }

  const probe = await probeState(peerA);
  const result = {
    baseline: { live: baseline.connections.live, tracks: baseline.tracks.live },
    final: { live: probe.connections.live, tracks: probe.tracks.live },
  };
  if (probe.connections.live !== baseline.connections.live || probe.tracks.live !== baseline.tracks.live) {
    throw new ScenarioError("H-13: connection/track counts did not return to baseline", result);
  }
  await peerA.close();
  await peerB.close();
  return result;
}

/** H-14 — a signed-in non-participant gets a named rejection and no media */
export async function scenario_H_14(ctx) {
  const { peerA, peerB } = await joinPair(ctx);
  const peerO = await ctx.launchPeer("O");
  try {
    await waitFor(peerO, `() => !!document.querySelector('[data-testid="call-error"]').textContent`, {
      timeoutMs: 10000,
      describe: "named rejection to appear",
    });
    const text = await peerO.page.evaluate(`(() => document.querySelector('[data-testid="call-error"]').textContent)()`);
    const tiles = await peerO.page.evaluate(tileCountAll);
    if (tiles !== 0) throw new ScenarioError(`H-14: rejected peer has ${tiles} media tiles`, { text });
    const phase = await peerO.page.evaluate(`(() => document.querySelector('[data-call-phase]')?.getAttribute('data-call-phase'))()`);
    await waitForValue(peerB, tileCountAll, (n) => n === 1, { timeoutMs: 5000, describe: "no O tile on B" });
    return { rejection: text.slice(0, 140), phase, tiles };
  } finally {
    await peerO.close();
    await peerA.close();
    await peerB.close();
  }
}

/** H-15 — 5% and 15% loss with 300 ms delay, by a method getStats proves affects RTP: call stays connected, A/V recovers */
export async function scenario_H_15(ctx) {
  ctx.enableRelay();
  await ctx.shaperFor("B").ready;
  const { peerA, peerB } = await joinPair(ctx); // configs resolve per participant: A host, B relay via B's shaper

  await installColorHook(peerB);

  async function proofBlock(label, lossPct, delayMs, windowMs = 6000) {
    if (lossPct > 0 || delayMs > 0) {
      ctx.shaperFor("B").applyProfile({ lossPct, delayMs });
    }
    const stats = await collectRtpStatsWindow(peerB, "video", windowMs, { participantId: "A" });
    const fps = await measureFps(peerB, "A", 3000);
    const phase = await peerB.page.evaluate(`(() => document.querySelector('[data-call-phase]')?.getAttribute('data-call-phase'))()`);
    ctx.shaperFor("B").applyProfile({ lossPct: 0, delayMs: 0 });
    return { label, lossPct, delayMs, deltaLost: stats.deltaLost, rttMs: stats.rttMs, fps: fps.fps, phase };
  }

  const baseline = await proofBlock("baseline", 0, 0, 4000);
  if (baseline.deltaLost !== 0 || baseline.rttMs >= 100) {
    throw new ScenarioError("H-15: baseline is not clean — proof would be meaningless", baseline);
  }

  const loss5 = await proofBlock("5%", 5, 300);
  if (loss5.deltaLost <= 0 || loss5.rttMs < 250) {
    throw new ScenarioError(
      `H-15: shaping did not demonstrably reach RTP at 5% (lost +${loss5.deltaLost}, rtt ${loss5.rttMs} ms)`,
      loss5,
    );
  }
  const recovery5 = await proofBlock("recovery-5%", 0, 0, 4000);

  const loss15 = await proofBlock("15%", 15, 300);
  if (loss15.deltaLost <= 0 || loss15.rttMs < 250) {
    throw new ScenarioError(
      `H-15: shaping did not demonstrably reach RTP at 15% (lost +${loss15.deltaLost}, rtt ${loss15.rttMs} ms)`,
      loss15,
    );
  }
  const recovery15 = await proofBlock("recovery-15%", 0, 0, 4000);

  for (const [name, block] of [["5%", loss5], ["15%", loss15]]) {
    if (block.phase !== "connected") {
      throw new ScenarioError(`H-15: call phase was "${block.phase}" under ${name} loss`, block);
    }
  }
  for (const [name, block] of [["5%", recovery5], ["15%", recovery15]]) {
    if (block.fps < 10) {
      throw new ScenarioError(`H-15: A/V did not recover after ${name} loss (${block.fps} fps)`, block);
    }
  }

  return {
    baseline,
    loss5,
    recovery5,
    loss15,
    recovery15,
    proof: "packetsLost delta > 0 and RTT >= 250 ms under 300 ms shaping; recovery fps healthy with profile cleared",
  };
}

/** H-16 — informational: all pairs receive media */
export async function scenario_H_16(ctx) {
  const [peerA, peerB, peerC] = await Promise.all([
    ctx.launchPeer("A"),
    ctx.launchPeer("B"),
    ctx.launchPeer("C"),
  ]);
  try {
    await Promise.all([
      waitFor(peerA, phaseIs("connected"), { timeoutMs: 30000, describe: "A connected" }),
      waitFor(peerB, phaseIs("connected"), { timeoutMs: 30000, describe: "B connected" }),
      waitFor(peerC, phaseIs("connected"), { timeoutMs: 30000, describe: "C connected" }),
    ]);
    for (const peer of [peerA, peerB, peerC]) await installColorHook(peer);

    const pairs = [];
    for (const [viewer, from, expected] of [
      ["A", "B", "B"],
      ["A", "C", "C"],
      ["B", "A", "A"],
      ["B", "C", "C"],
      ["C", "A", "A"],
      ["C", "B", "B"],
    ]) {
      const peer = { A: peerA, B: peerB, C: peerC }[viewer];
      const c = await waitForValue(
        peer,
        `async () => await window.__decodeRemoteColor("${from}")`,
        (c) => c?.ok && c.label === expected,
        { timeoutMs: 20000, describe: `${viewer} decodes ${from}` },
      );
      pairs.push({ viewer, from, label: c.label, distance: c.distance });
    }
    return { informational: true, pairs, allPairsReceiveMedia: pairs.length === 6 };
  } finally {
    await Promise.all([peerA.close(), peerB.close(), peerC.close()]);
  }
}
