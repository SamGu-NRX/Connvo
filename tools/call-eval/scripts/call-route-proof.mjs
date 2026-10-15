#!/usr/bin/env node
// Local browser proof of the full normal matching and call route, one command:
//   node tools/call-eval/scripts/call-route-proof.mjs [--port=3035] [--skip-backend]
//
// Two isolated Chromium contexts (fake camera/mic fixtures, D4) go through the
// shipped queue page, accept a match, land in the real call behind
// NEXT_PUBLIC_CONNVO_REAL_CALL=1, and there:
//   C3/C4  exchange the synthetic video barcode and audio tone both ways
//   C5/C6  mic mute/unmute flips the remote tile from both sides
//   C7     camera off/on releases and restores the capture track
//   C8     a signed-in non-participant gets a named rejection and no media
//   C9     a forced tab reload rejoins and the survivor loses the ghost
//   C10    leaving ends tracks, closes connections, closes server sessions
//          (no leaked room state) and concludes the meeting
//
// Writes tools/call-eval/out/call-route-proof/results-<ts>.json plus a stable
// results.json, and exits 0 only when every check passed. Missing remote media
// or leaked room state fail the run. Local Convex, synthetic identities and
// generated media only: no Stream, no paid services, no production data.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";
import {
  checkedConvexEnvironment,
  selectedLocalBackend,
  requireLoopbackUrl,
} from "./local-backend-core.mjs";
import {
  installSignalingCut,
  parseRunOutput,
} from "../runner/convex-signaling.mjs";
import { launchPeer } from "../runner/peers.mjs";
import {
  decodeRemoteFrame,
  matchPeerColor,
  measureFps,
  probeState,
  sampleRemoteTone,
  toneIsSilent,
  toneMatches,
} from "../runner/page-helpers.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(SCRIPTS_DIR, "..");
const REPO = path.resolve(EVAL_DIR, "../..");
const STATE_PATH = path.join(EVAL_DIR, "out", "state.json");
const OUT_DIR = path.join(EVAL_DIR, "out", "call-route-proof");

const args = process.argv.slice(2).filter((a) => a !== "--");
const flagValue = (/** @type {string} */ name) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const PORT = Number(flagValue("port") ?? 3035);
const BASE = `http://localhost:${PORT}`;
const SKIP_BACKEND = args.includes("--skip-backend");

const RUN_TAG = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_LOG = path.join(OUT_DIR, `run-${RUN_TAG}.log`);
mkdirSync(OUT_DIR, { recursive: true });

/** Timestamped console + run-log line.
 *  @param {string} msg
 *  @returns {void}
 */
function log(msg) {
  const line = `${new Date().toISOString()} [call-route-proof] ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + "\n");
}

// --- Local Convex CLI plumbing (the match-queue-proof fixture pattern) ------

function localTarget() {
  const envLocalPath = path.join(REPO, ".env.local");
  const envLocalContent = readFileSync(envLocalPath, "utf8");
  const clean = checkedConvexEnvironment({ env: process.env, envLocalContent });
  const target = selectedLocalBackend({
    cwd: REPO,
    env: { ...parseEnv(envLocalContent), ...clean, NODE_ENV: "development" },
  });
  return { envLocalPath, target };
}

/** Run an internal devEval function on the local backend. Never logs output.
 *  @param {string} fn
 *  @param {Record<string, unknown>} [argsObj]
 *  @param {{envLocalPath?: string | null, target?: {deployment: string, name: string, url: string} | null}} [opts]
 *  @returns {any} parsed function result
 */
function devEval(fn, argsObj = {}, { envLocalPath, target } = {}) {
  const resolved = envLocalPath
    ? {
        envLocalPath,
        target: /** @type {NonNullable<typeof target>} */ (target),
      }
    : localTarget();
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO, "node_modules/convex/bin/main.js"),
      "run",
      fn,
      JSON.stringify(argsObj),
      "--env-file",
      resolved.envLocalPath,
    ],
    {
      cwd: REPO,
      env: {
        ...process.env,
        NODE_ENV: "development",
        CONVEX_DEPLOYMENT: resolved.target.deployment,
        NEXT_PUBLIC_CONVEX_URL: resolved.target.url,
        CONVEX_URL: resolved.target.url,
      },
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(result.status, 0, `Local devEval ${fn} failed`);
  return parseRunOutput(result.stdout ?? "", "{");
}

// --- Machine-readable check ledger -------------------------------------------

/** @type {Array<{ id: string, pass: boolean, detail: string, ms?: number, measurements?: unknown }>} */
const checks = [];
let stage = "start";

/** Record a check outcome into the results file.
 *  @param {string} id
 *  @param {boolean} pass
 *  @param {string} detail
 *  @param {{ms?: number, measurements?: unknown}} [extra]
 *  @returns {void}
 */
function record(id, pass, detail, extra = {}) {
  checks.push({ id, pass, detail, ...extra });
  log(`${pass ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

/** Assert-style check: records the failure, then throws to stop the run.
 *  @param {string} id
 *  @param {string} detail
 *  @param {() => unknown} fn
 *  @returns {Promise<void>}
 */
async function check(id, detail, fn) {
  const t0 = Date.now();
  try {
    const measurements = (await fn()) ?? undefined;
    record(id, true, detail, { ms: Date.now() - t0, measurements });
  } catch (error) {
    record(
      id,
      false,
      `${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
      {
        ms: Date.now() - t0,
      },
    );
    throw error;
  }
}

/** Poll fn until it returns a truthy value; resolve {value, ms} or throw.
 *  @param {(() => unknown) | (() => Promise<unknown>)} fn
 *  @param {{timeoutMs: number, intervalMs?: number, label: string}} opts
 *  @returns {Promise<{value: any, ms: number}>}
 */
async function pollUntil(fn, { timeoutMs, intervalMs = 250, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastValue = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await fn();
      if (lastValue)
        return { value: lastValue, ms: timeoutMs - (deadline - Date.now()) };
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const suffix = lastError
    ? `; last error ${lastError}`
    : lastValue === false
      ? ""
      : "";
  throw new Error(`${label} not met within ${timeoutMs} ms${suffix}`);
}

// --- Browser peers ------------------------------------------------------------

const FIXTURES = path.join(REPO, "tools/call-eval/fixtures");
/** @type {Awaited<ReturnType<typeof launchPeer>>[]} */
const peers = [];

/** Launch one browser peer with fixtures for a seeded identity (A, B, ...).
 *  @param {string} id
 *  @param {{fixtures?: boolean}} [opts]
 *  @returns {Promise<Awaited<ReturnType<typeof launchPeer>>>}
 */
async function person(id, { fixtures = true } = {}) {
  const peer = await launchPeer({
    fixtureVideo: path.join(FIXTURES, `peer-${id}.y4m`),
    fixtureAudio: path.join(FIXTURES, `peer-${id}.wav`),
    baseUrl: BASE,
    participant: id,
  });
  await installSignalingCut(peer.context);
  peer.page.setDefaultTimeout(30_000);
  peers.push(peer);
  return peer;
}

/** The remote participant id shown on A/B's remote tile.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @returns {Promise<string>}
 */
async function remoteId(peer) {
  const id = await peer.page
    .getByTestId("remote-media")
    .getAttribute("data-participant-id");
  assert.ok(id, `${peer.peerId}: remote tile has no participant id`);
  return id;
}

/** Decode a remote video frame and name the peer fixture color it shows.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @param {string} participantId
 *  @returns {Promise<string>}
 */
async function decodePeerColor(peer, participantId) {
  const frame = await decodeRemoteFrame(peer, participantId);
  assert.ok(frame.present, `${peer.peerId}: no remote video frame rendered`);
  assert.ok(
    frame.color,
    `${peer.peerId}: remote frame carries no sampled color`,
  );
  const color = matchPeerColor(frame.color);
  assert.ok(
    color.ok,
    `${peer.peerId}: remote color ${JSON.stringify(frame.color)} is not a peer fixture`,
  );
  return /** @type {string} */ (color.label);
}

/** Wait until a fixture tone at expectedHz is audible from a participant.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @param {string} participantId
 *  @param {number} expectedHz
 *  @param {number} [timeoutMs]
 *  @returns {Promise<{heard: number, ms: number}>}
 */
async function expectTone(peer, participantId, expectedHz, timeoutMs = 10_000) {
  const { value, ms } = await pollUntil(
    async () => {
      const tone = await sampleRemoteTone(peer, participantId, 500);
      return tone && toneMatches(tone, expectedHz) ? tone.peakHz : false;
    },
    {
      timeoutMs,
      label: `${peer.peerId} hearing ${expectedHz} Hz from ${participantId}`,
    },
  );
  return { heard: value, ms };
}

/** Wait until no fixture tone is audible from a participant; resolve elapsed ms.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @param {string} participantId
 *  @param {number} [timeoutMs]
 *  @returns {Promise<number>}
 */
async function expectSilence(peer, participantId, timeoutMs = 8_000) {
  const { ms } = await pollUntil(
    async () => {
      const tone = await sampleRemoteTone(peer, participantId, 400);
      return toneIsSilent(tone);
    },
    {
      timeoutMs,
      label: `${peer.peerId} hearing silence from ${participantId}`,
    },
  );
  return ms;
}

/** Wait for a remote tile attribute to equal a value; resolve elapsed ms.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @param {string} participantId
 *  @param {string} attr
 *  @param {string | null} value
 *  @param {number} timeoutMs
 *  @returns {Promise<number>}
 */
async function expectTileAttr(peer, participantId, attr, value, timeoutMs) {
  const { ms } = await pollUntil(
    async () =>
      (await peer.page
        .locator(
          `[data-testid="remote-media"][data-participant-id="${participantId}"]`,
        )
        .getAttribute(attr)) === value,
    {
      timeoutMs,
      label: `${peer.peerId} seeing ${attr}=${value} for ${participantId}`,
    },
  );
  return ms;
}

/** Wait for the call phase to reach "connected".
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @returns {Promise<void>}
 */
async function expectConnected(peer) {
  await peer.page.waitForFunction(
    () =>
      document
        .querySelector("[data-call-phase]")
        ?.getAttribute("data-call-phase") === "connected",
    null,
    { timeout: 90_000 },
  );
}

// --- Main ---------------------------------------------------------------------

/** @type {{startedAt: string, gitSha: string | null, host: string, port: number, baseUrl: string, pass: boolean, stage: string, failure: string | null, meetingId: string | null, checks: {id: string, pass: boolean, detail: string, ms?: number, measurements?: unknown}[], completedAt?: string}} */
const result = {
  startedAt: new Date().toISOString(),
  gitSha: null,
  host: `${os.platform()} ${os.arch()}, ${os.cpus().length} CPUs, node ${process.version}`,
  port: PORT,
  baseUrl: BASE,
  pass: false,
  stage: "start",
  failure: null,
  meetingId: null,
  checks,
};

async function main() {
  result.gitSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO,
    encoding: "utf8",
  }).stdout.trim();

  // 0. Fixtures.
  stage = "fixtures";
  const missing = ["A", "B", "C"].some((id) =>
    ["y4m", "wav"].some(
      (ext) => !existsSync(path.join(FIXTURES, `peer-${id}.${ext}`)),
    ),
  );
  if (missing) {
    const generated = spawnSync(
      process.execPath,
      [path.join(REPO, "tools/call-eval/scripts/generate-fixtures.mjs")],
      {
        cwd: REPO,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    assert.equal(generated.status, 0, "Pinned media fixture generation failed");
  }
  log("fixtures present");

  // 1. Backend: anonymous local Convex + next dev with the eval env (reuses a
  // warm backend; the script re-runs everything else from scratch).
  if (!SKIP_BACKEND) {
    stage = "backend";
    const backend = await new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(
        process.execPath,
        [path.join(SCRIPTS_DIR, "local-backend.mjs"), `--port=${PORT}`],
        {
          cwd: REPO,
        },
      );
      let out = "";
      const collect = (/** @type {Buffer | string} */ chunk) => {
        out += chunk.toString();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const timer = setTimeout(() => child.kill("SIGKILL"), 1_500_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out, ms: Date.now() - t0 });
      });
    });
    const ready =
      backend.code === 0 &&
      backend.out.includes("[backend] READY") &&
      backend.out.includes("seed shape verified");
    assert.ok(
      ready,
      `local backend not ready (exit ${backend.code}); see ${RUN_LOG}`,
    );
    log(`backend ready in ${(backend.ms / 1000).toFixed(1)} s`);
  }

  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const { envLocalPath, target } = localTarget();
  // requireLoopbackUrl normalizes scheme/host; compare origins so a trailing
  // slash difference on the stored URL can never fail the run.
  const originOf = (/** @type {URL | string} */ value) => new URL(value).origin;
  assert.equal(
    originOf(requireLoopbackUrl(state.convexUrl)),
    originOf(target.url),
    "state.json selects another deployment",
  );
  assert.equal(
    originOf(requireLoopbackUrl(state.nextBaseUrl)),
    `http://localhost:${PORT}`,
    "state.json selects another Next port",
  );

  // 2. Queue: A joins, B joins, both matched, both accept.
  stage = "queue";
  await check(
    "C1-queue-match-and-navigate",
    "queue matches A and B; both Joins navigate to the same real call",
    async () => {
      devEval("devEval/queueProof:prepare", {}, { envLocalPath, target });
      const a = await person("A");
      await a.page.goto(`/app/match-queue?as=A`, {
        waitUntil: "domcontentloaded",
      });
      await a.page
        .locator("[data-queue-state]")
        .waitFor({ state: "visible", timeout: 30_000 });
      await pollUntil(
        () =>
          a.page
            .locator("[data-queue-state]")
            .getAttribute("data-queue-state")
            .then((v) => v === "waiting"),
        { timeoutMs: 30_000, label: "A waiting in queue" },
      );
      const b = await person("B");
      await b.page.goto(`/app/match-queue?as=B`, {
        waitUntil: "domcontentloaded",
      });
      await pollUntil(
        () =>
          a.page
            .locator("[data-queue-state]")
            .getAttribute("data-queue-state")
            .then((v) => v === "matched"),
        { timeoutMs: 30_000, label: "A matched" },
      );
      await pollUntil(
        () =>
          b.page
            .locator("[data-queue-state]")
            .getAttribute("data-queue-state")
            .then((v) => v === "matched"),
        { timeoutMs: 30_000, label: "B matched" },
      );
      await a.page
        .locator("[data-queue-state]")
        .getByRole("button", { name: "Join", exact: true })
        .click();
      await b.page
        .locator("[data-queue-state]")
        .getByRole("button", { name: "Join", exact: true })
        .click();
      await Promise.all(
        [a, b].map((peer) =>
          peer.page.waitForURL(
            (url) => /^\/app\/call\/[^/]+$/.test(url.pathname),
            { timeout: 30_000 },
          ),
        ),
      );
      result.meetingId =
        new URL(a.page.url()).pathname.split("/").at(-1) ?? null;
      assert.equal(
        new URL(b.page.url()).pathname,
        `/app/call/${result.meetingId}`,
        "peers entered different calls",
      );
      return { meetingId: result.meetingId };
    },
  );

  const meetingRow = devEval(
    "devEval/queueProof:meeting",
    { meetingId: result.meetingId },
    { envLocalPath, target },
  );
  await check(
    "C2-meeting-participants",
    "meeting has exactly local-test-a and local-test-b",
    () => {
      const subjects = (meetingRow.participants ?? [])
        .map((/** @type {{subject: string}} */ p) => p.subject)
        .sort();
      assert.deepEqual(subjects, ["local-test-a", "local-test-b"]);
      return subjects;
    },
  );

  // 3. Lobby join and media both ways.
  stage = "connect";
  const a = peers[0];
  const b = peers[1];
  await check(
    "C3-video-exchange-both-ways",
    "each side decodes the other's fixture color and an advancing frame counter",
    async () => {
      await Promise.all(
        [a, b].map((peer) =>
          peer.page.getByTestId("join-call").click({ timeout: 60_000 }),
        ),
      );
      await Promise.all([a, b].map(expectConnected));
      const forA = await remoteId(a);
      const forB = await remoteId(b);
      await pollUntil(async () => (await decodePeerColor(a, forA)) === "B", {
        timeoutMs: 45_000,
        label: "A decoding B's fixture color",
      });
      await pollUntil(async () => (await decodePeerColor(b, forB)) === "A", {
        timeoutMs: 45_000,
        label: "B decoding A's fixture color",
      });
      /** @type {number[]} */
      const countersA = [];
      /** @type {number[]} */
      const countersB = [];
      await pollUntil(
        async () => {
          const frameA = await decodeRemoteFrame(a, forA);
          const frameB = await decodeRemoteFrame(b, forB);
          if (frameA.counter?.ok) countersA.push(frameA.counter.counter);
          if (frameB.counter?.ok) countersB.push(frameB.counter.counter);
          return new Set(countersA).size >= 2 && new Set(countersB).size >= 2;
        },
        { timeoutMs: 15_000, label: "frame counters advancing on both sides" },
      );
      const fpsA = await measureFps(a, forA, 5000);
      const fpsB = await measureFps(b, forB, 5000);
      assert.ok(
        fpsA.fps >= 10,
        `A sees ${fpsA.fps} fps (min 10 on a loaded host)`,
      );
      assert.ok(
        fpsB.fps >= 10,
        `B sees ${fpsB.fps} fps (min 10 on a loaded host)`,
      );
      return { fpsA: fpsA.fps, fpsB: fpsB.fps };
    },
  );

  await check(
    "C4-audio-exchange-both-ways",
    "each receiver's tone peak is the sender's fixture tone",
    async () => {
      const forA = await remoteId(a);
      const forB = await remoteId(b);
      const aHears = await expectTone(a, forA, 660);
      const bHears = await expectTone(b, forB, 440);
      return { aHears: aHears.heard, bHears: bHears.heard };
    },
  );

  // 4. Controls both ways.
  stage = "controls";
  await check(
    "C5-mic-mute-from-A",
    "A's mic mute flips B's tile and silences B; unmute restores the tone",
    async () => {
      const forB = await remoteId(b);
      // B's remote tile carries A's participant id, which is remoteId(b).
      const forAId = await remoteId(b);
      log(`C5 probe: A's tile for B -> mute (forAId=${forAId})`);
      const before = await probeState(a);
      await a.page.getByTestId("toggle-mic").click();
      log(`C5 probe: A muted, waiting for B's tile attribute`);
      const flipMs = await expectTileAttr(
        b,
        forAId,
        "data-audio-muted",
        "true",
        5_000,
      );
      log(`C5 probe: B's tile flipped in ${flipMs} ms, waiting for silence`);
      const silenceMs = await expectSilence(b, forB);
      log(`C5 probe: B hears silence after ${silenceMs} ms, unmuting`);
      await a.page.getByTestId("toggle-mic").click();
      log(`C5 probe: A unmuted, waiting for B's tile restore`);
      await expectTileAttr(b, forAId, "data-audio-muted", "false", 5_000);
      log(`C5 probe: B's tile restored, waiting for tone`);
      await expectTone(b, forB, 440);
      const after = await probeState(a);
      assert.equal(
        after.tracks.live,
        before.tracks.live,
        "unmute must not leak capture tracks",
      );
      return { flipMs, silenceMs };
    },
  );

  await check(
    "C6-mic-mute-from-B",
    "B's mic mute flips A's tile and silences A; unmute restores the tone",
    async () => {
      const forA = await remoteId(a);
      await b.page.getByTestId("toggle-mic").click();
      const flipMs = await expectTileAttr(
        a,
        forA,
        "data-audio-muted",
        "true",
        5_000,
      );
      const silenceMs = await expectSilence(a, forA);
      await b.page.getByTestId("toggle-mic").click();
      await expectTileAttr(a, forA, "data-audio-muted", "false", 5_000);
      await expectTone(a, forA, 660);
      return { flipMs, silenceMs };
    },
  );

  await check(
    "C7-camera-off-on-from-A",
    "A's camera off flips B's tile, ends A's video capture track, and on resumes frames",
    async () => {
      const forB = await remoteId(b);
      const tracksBefore = (await probeState(a)).tracks.live;
      await a.page.getByTestId("toggle-camera").click();
      const offMs = await expectTileAttr(
        b,
        forB,
        "data-video-off",
        "true",
        5_000,
      );
      const tracksAfterOff = (await probeState(a)).tracks.live;
      assert.ok(
        tracksAfterOff < tracksBefore,
        `camera off must end the capture track (${tracksBefore} -> ${tracksAfterOff})`,
      );
      await a.page.getByTestId("toggle-camera").click();
      const onMs = await expectTileAttr(
        b,
        forB,
        "data-video-off",
        "false",
        8_000,
      );
      await pollUntil(
        async () => {
          const frame = await decodeRemoteFrame(b, forB);
          return frame.present && frame.counter?.ok;
        },
        { timeoutMs: 15_000, label: "frames resume for B after camera on" },
      );
      const tracksAfterOn = (await probeState(a)).tracks.live;
      assert.equal(
        tracksAfterOn,
        tracksBefore,
        "camera on must restore the capture track count",
      );
      return { offMs, onMs, tracksBefore, tracksAfterOff };
    },
  );

  // 5. Participant authorization through the normal route.
  stage = "authorization";
  const outsider = await person("O", { fixtures: true });
  await check(
    "C8-outsider-named-rejection",
    "signed-in non-participant O gets a named rejection and no media",
    async () => {
      await outsider.page.goto(`/app/call/${result.meetingId}?as=O`, {
        waitUntil: "domcontentloaded",
      });
      const errorText = await pollUntil(
        async () => {
          const tile = await outsider.page
            .locator('[data-testid="call-error"]')
            .count();
          if (!tile) return false;
          const text = (
            await outsider.page
              .locator('[data-testid="call-error"]')
              .innerText()
          ).trim();
          return text.length > 0 ? text : false;
        },
        { timeoutMs: 45_000, label: "named rejection for O" },
      );
      const remoteTiles = await outsider.page
        .locator('[data-testid="remote-media"]')
        .count();
      assert.equal(remoteTiles, 0, "outsider must receive no remote media");
      return { rejection: errorText };
    },
  );

  // 6. Forced reload and recovery.
  stage = "reload-recovery";
  await check(
    "C9-reload-recovery",
    "B's forced reload rejoins; A keeps exactly one remote tile and frames resume",
    async () => {
      const t0 = Date.now();
      await b.page.reload({ waitUntil: "domcontentloaded" });
      await b.page.getByTestId("join-call").click({ timeout: 60_000 });
      await expectConnected(b);
      // A's surviving tile must be B again — same participant, advancing frames,
      // and exactly one tile (no ghost of the pre-reload join).
      const forA = await remoteId(a);
      await pollUntil(async () => (await decodePeerColor(a, forA)) === "B", {
        timeoutMs: 45_000,
        label: "A decoding B's fixture color after B's reload",
      });
      const tiles = await a.page
        .locator('[data-testid="remote-media"]')
        .count();
      assert.equal(
        tiles,
        1,
        `A must see exactly one remote tile after recovery, saw ${tiles}`,
      );
      const recoveryMs = Date.now() - t0;
      return { recoveryMs };
    },
  );

  // 7. Leave and cleanup: no leaked room state.
  stage = "leave-cleanup";
  await check(
    "C10-leave-cleanup",
    "both leave: tracks end, connections close, server sessions close, meeting concludes",
    async () => {
      for (const peer of [a, b]) {
        await peer.page.getByTestId("leave-call").click();
        await peer.page.getByTestId("leave-call-confirm").click();
        await peer.page.waitForFunction(
          () =>
            document
              .querySelector("[data-call-phase]")
              ?.getAttribute("data-call-phase") === "left",
          null,
          { timeout: 30_000 },
        );
      }
      /** @type {Record<string, {connections: number, tracks: number}>} */
      const probes = {};
      for (const peer of [a, b]) {
        const probe = await probeState(peer);
        assert.equal(
          probe.connections.live,
          0,
          `${peer.peerId} leaked ${probe.connections.live} live RTCPeerConnections`,
        );
        assert.equal(
          probe.tracks.live,
          0,
          `${peer.peerId} leaked ${probe.tracks.live} live capture tracks`,
        );
        probes[peer.peerId] = {
          connections: probe.connections.live,
          tracks: probe.tracks.live,
        };
      }
      const open = await pollUntil(
        async () => {
          const { sessions } = devEval(
            "devEval/callMeeting:openSessions",
            { meetingId: result.meetingId },
            { envLocalPath, target },
          );
          return sessions.length === 0 ? [] : false;
        },
        {
          timeoutMs: 30_000,
          label: "no open webrtcSessions left in the meeting",
        },
      );
      const closed = await pollUntil(
        async () => {
          const { events } = devEval(
            "devEval/callMeeting:sessionEvents",
            { meetingId: result.meetingId },
            { envLocalPath, target },
          );
          const subjects = events.map(
            (/** @type {{participant: string}} */ r) => r.participant,
          );
          return subjects.includes("local-test-a") &&
            subjects.includes("local-test-b")
            ? subjects
            : false;
        },
        {
          timeoutMs: 30_000,
          label: "closed sessions recorded for both participants",
        },
      );
      const meetingState = await pollUntil(
        async () => {
          const row = devEval(
            "devEval/queueProof:meeting",
            { meetingId: result.meetingId },
            { envLocalPath, target },
          );
          return row.meeting?.state === "concluded" ? "concluded" : false;
        },
        { timeoutMs: 30_000, label: "meeting concluded after last leave" },
      );
      return {
        probes,
        openSessions: open.value.length,
        closedParticipants: closed.value,
        meetingState: meetingState.value,
      };
    },
  );

  result.pass = true;
}

try {
  await main();
} catch (error) {
  result.failure =
    `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted token]")
      .slice(0, 2000);
  log(`FAIL at ${stage}: ${result.failure}`);
} finally {
  result.stage = stage;
  result.completedAt = new Date().toISOString();
  await Promise.allSettled(peers.map((peer) => peer.close()));
  const resultPath = path.join(OUT_DIR, `results-${RUN_TAG}.json`);
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
  copyFileSync(resultPath, path.join(OUT_DIR, "results.json"));
  copyFileSync(RUN_LOG, path.join(OUT_DIR, "run.log"));
  log(`results: ${resultPath}`);
  const passed = checks.filter((c) => c.pass).length;
  log(`${result.pass ? "PASS" : "FAIL"}: ${passed}/${checks.length} checks`);
  process.exitCode = result.pass ? 0 : 1;
}
