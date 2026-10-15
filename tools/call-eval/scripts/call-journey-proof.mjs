#!/usr/bin/env node
// Local browser proof of the COMPLETE local call journey from the front door,
// one command:
//   node tools/call-eval/scripts/call-journey-proof.mjs [--port=3036] [--skip-backend]
//
// Where call-route-proof.mjs starts at the queue, this proof starts the
// journey where a real person starts it: the onboarding wizard and the app's
// own navigation into matching. Two isolated Chromium contexts (fake
// camera/mic fixtures, D4), driven only through shipped UI routes:
//   J1     onboarding is reset for the two seeded identities (harness only)
//   J2/J3  A and B complete the shipped /onboarding wizard and land on /app
//   J4     the wizard's save actually persisted (profile fields + interests)
//   J5     both enter casual matching through the product's own navigation
//   J6     the introduction card shows the partner's name and match reasons
//   J7     both accept the same introduction and navigate to the same call
//   J8     the meeting persists exactly local-test-a and local-test-b
//   J9     fixture video and audio exchange both ways, frames advancing
//   J10    a mic mute round flips the remote tile and silences/ restores
//   J11    shared notes carry both ways into the stored buffer; one live
//          prompt shows the same text on both sides and the used mark syncs
//   J12    B's forced reload rejoins without ghosts, note loss or duplication
//   J13    leaving ends tracks and connections, closes server sessions and
//          concludes the meeting
//   J14    BOTH participants open the recap and see the committed notes and
//          the prompt from the call
//   J15    ADVERSARIAL: the same two users match again and B declines the
//          introduction; both return to the waiting queue with their notices,
//          the match row reads declined, and no second meeting is created
//
// Writes tools/call-eval/out/call-journey-proof/results-<ts>.json plus a
// stable results.json, and exits 0 only when every check passed. Local Convex,
// synthetic identities and generated media only: no Stream, no paid services,
// no production data. The backend runs with --after-call so the recap screens
// are on for J14, and the prompt pick uses the deterministic bank selection
// (no OPENAI_API_KEY).

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
  storedNotes,
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
const OUT_DIR = path.join(EVAL_DIR, "out", "call-journey-proof");

const args = process.argv.slice(2).filter((a) => a !== "--");
const flagValue = (/** @type {string} */ name) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const PORT = Number(flagValue("port") ?? 3036);
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
  const line = `${new Date().toISOString()} [call-journey-proof] ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + "\n");
}

// --- Local Convex CLI plumbing (the call-route-proof fixture pattern) --------

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
  const suffix = lastError ? `; last error ${lastError}` : "";
  throw new Error(`${label} not met within ${timeoutMs} ms${suffix}`);
}

// --- Browser peers ------------------------------------------------------------

const FIXTURES = path.join(REPO, "tools/call-eval/fixtures");
/** @type {Awaited<ReturnType<typeof launchPeer>>[]} */
const peers = [];

/** Best-effort screenshots of every peer page after a failed check, so a
 *  rendering surprise (error boundary, stuck transition) is directly visible
 *  in the artifacts directory.
 *  @param {string} id
 *  @returns {Promise<void>}
 */
async function snapshotPeers(id) {
  for (const peer of peers) {
    if (peer.page.isClosed()) continue;
    await peer.page.screenshot({
      path: path.join(OUT_DIR, `fail-${RUN_TAG}-${id}-${peer.peerId}.png`),
      fullPage: true,
    });
  }
}

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

/** The remote participant id shown on a peer's remote tile.
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

// --- Journey helpers: onboarding and product navigation -----------------------

/** The shared-notes editor selector (MeetingNotesPanel's textarea). */
const NOTES_EDITOR = '[data-testid="notes-editor"]';
/** The panel that carries the current live prompt. */
const PROMPTS_PANEL = '[data-testid="conversation-prompts"]';
/** The current prompt text element. */
const CURRENT_PROMPT = '[data-testid="current-prompt"]';
/** Deterministic note phrases; the proof counts each exactly once everywhere. */
const NOTES_A = "A-alpha journey check";
const NOTES_B = "B-bravo journey check";
const NOTES_B2 = "B-charlie after reload";
/** The custom interest both users add in the wizard: the SAME key for both,
 *  so pairing has a real interest-overlap reason through the shipped save. */
const SHARED_INTEREST = "Local journey sync";
/** The prompt text both sides must see; set by J11, reused by J12 and J14. */
let promptText = "";

/** Pick an option from the wizard's Radix select. A native click loses a
 *  race: the choice commits on pointerdown, the listbox unmounts before
 *  pointerup, and Playwright's actionability retry then waits on a closed
 *  menu forever. Dispatched pointer events commit immediately and the
 *  detached wait confirms the menu closed with the value applied.
 *  @param {Awaited<ReturnType<typeof import("../runner/peers.mjs").launchPeer>>["page"]} page
 *  @param {string} label
 *  @returns {Promise<void>}
 */
async function pickOption(page, label) {
  await page.getByRole("combobox").click();
  const option = page.getByRole("option", { name: label }).first();
  await option.waitFor({ state: "visible", timeout: 15_000 });
  // Options render inside a Popover/SelectContent portal, outside the wizard
  // Card, so a real click is safe here — and required for cmdk items, which
  // select on click (dispatched pointer events do not synthesize one). Keep
  // the dispatched fallback for the Radix Select detach race seen earlier.
  try {
    await option.click({ timeout: 3_000 });
  } catch {
    await option.dispatchEvent("pointerdown", {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
    await option.dispatchEvent("pointerup", {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
  }
  await option.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  // Let the wizard's step transition (AnimatePresence card slide) settle
  // before the next interaction targets anything inside the card.
  await page.waitForTimeout(400);
}

/** Drive the shipped /onboarding wizard for one identity, ending on /app.
 *  Every step uses the page's own controls: the gender select, the field
 *  combobox, the bio textarea, the custom-interest input, the step buttons.
 *  The bio varies by run and peer so a rerun after a reset never replays an
 *  existing idempotency key.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @param {string} id
 *  @returns {Promise<void>}
 */
async function driveOnboarding(peer, id) {
  const page = peer.page;
  // First-load auth on a cold eval stack can 401 getOnboardingState and swap
  // the wizard for the error boundary mid-interaction. Warm the session on
  // /app once, then retry the whole wizard drive on any transient teardown;
  // nothing persists until the final save, so a retry never double-writes.
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt === 1) {
        await page.goto(`/app?as=${id}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1_500);
      }
      await page.goto(`/onboarding?as=${id}`, { waitUntil: "domcontentloaded" });
      await pollUntil(
        async () => {
          const errorUi = page.getByText("This page couldn’t load");
          if ((await errorUi.count()) && (await errorUi.first().isVisible())) {
            await page
              .getByRole("button", { name: "Reload" })
              .click()
              .catch(() => {});
            await page.waitForTimeout(800);
            return false;
          }
          const form = page.getByRole("combobox");
          return (await form.count()) > 0 && (await form.first().isVisible());
        },
        { timeoutMs: 30_000, label: `${peer.peerId} wizard mounted` },
      );
      // Step 1 — Basic info: keep the default age slider (25), pick a gender.
      await pickOption(page, "Prefer not to say");
      await page.getByRole("button", { name: "Continue" }).click();
      // Step 2 — Professional info: pick a field, fill title and company.
      await pickOption(page, "Software Development");
      await page.getByPlaceholder("e.g., Senior Developer").fill(`Engineer ${id}`);
      await page.getByPlaceholder("e.g., Tech Corp").fill(`Journey ${RUN_TAG}`);
      await page.getByRole("button", { name: "Continue" }).click();
      // Step 3 — Bio (10-150 chars, unique per run and peer).
      const bio = `Journey ${RUN_TAG}: peer ${id} writes a short local bio.`;
      await page.locator("#bio").fill(bio);
      await page.getByRole("button", { name: "Continue" }).click();
      // Step 4 — Interests: add the SAME custom interest both users will share.
      await page.getByPlaceholder("Add a custom interest").fill(SHARED_INTEREST);
      await page.getByRole("button", { name: "Add Custom" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      // Step 5 — Summary: submit and land on the app (auto-redirect or button).
      await page.getByRole("button", { name: "Complete Profile" }).click();
      const submitBtnState = async () =>
        page
          .evaluate(() => {
            const b = [...document.querySelectorAll("button")].find((x) =>
              /Complete Profile|Saving|Submitting/i.test(x.textContent || ""),
            );
            return b
              ? `${(b.textContent || "").trim()} disabled=${b.disabled}`
              : "(submit button gone — congratulations screen?)";
          })
          .catch(() => "(page unavailable)");
      log(
        `driveOnboarding ${id} submit-click state: ${await submitBtnState()}`,
      );
      await page.waitForTimeout(8000);
      log(
        `driveOnboarding ${id} submit state @8s: ${await submitBtnState()}`,
      );
      await pollUntil(
        async () => {
          if (new URL(page.url()).pathname === "/app") return true;
          const start = page.getByRole("button", { name: "Start Connecting" });
          if ((await start.count()) && (await start.isEnabled()))
            await start.click().catch(() => {});
          return false;
        },
        { timeoutMs: 60_000, label: `${peer.peerId} landing on /app` },
      );
      return;
    } catch (error) {
      lastError = error;
      log(
        `driveOnboarding ${id} attempt ${attempt} failed: ${String(error).split("\n")[0]}`,
      );
      const body = await page
        .evaluate(() => document.body.innerText.slice(0, 500))
        .catch(() => "(page unavailable)");
      const url = await page
        .evaluate(() => window.location.href)
        .catch(() => "(url unavailable)");
      log(
        `driveOnboarding ${id} page text: ${body.replace(/\s+/g, " ").trim()}`,
      );
      log(`driveOnboarding ${id} url: ${url}`);
    }
  }
  throw lastError;
}

/** Enter casual matching through the product's own navigation: load the app
 *  home with the identity param, then click the shipped "Casual" nav link.
 *  The test-auth identity is fixed per page load, so the identity param is on
 *  the home URL and survives the client-side navigation to the queue.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @param {string} id
 *  @returns {Promise<void>}
 */
async function enterQueueViaNav(peer, id) {
  const page = peer.page;
  await page.goto(`/app?as=${id}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("link", { name: /^Casual/ })
    .first()
    .click({ timeout: 30_000 });
  await page
    .locator("[data-queue-state]")
    .waitFor({ state: "visible", timeout: 30_000 });
}

/** The queue state attribute of a peer's queue card.
 *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
 *  @returns {Promise<string | null>}
 */
async function queueState(peer) {
  return peer.page
    .locator("[data-queue-state]")
    .getAttribute("data-queue-state");
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
  const missing = ["A", "B"].some((id) =>
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
        [
          path.join(SCRIPTS_DIR, "local-backend.mjs"),
          `--port=${PORT}`,
          // The recap screens are part of the journey (J14 reads the recap
          // page after the call concludes).
          "--after-call",
        ],
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

  // 2. Onboarding: reset the two identities, then drive the shipped wizard.
  stage = "onboarding";
  await check(
    "J1-onboarding-reset",
    "harness resets onboarding for the two seeded identities before the wizard run",
    () => {
      const { reset } = devEval(
        "devEval/queueProof:resetOnboarding",
        { subjects: ["local-test-a", "local-test-b"] },
        { envLocalPath, target },
      );
      assert.equal(reset, 2, "both identities must be reset");
      return { reset };
    },
  );

  // The wizard's first Convex query races the test-auth token route on a
  // cold eval boot: the browser's one-shot token fetch can fail while next
  // dev is still compiling, and the adapter stays unauthenticated for that
  // realm. Warm the route over plain HTTP until it answers for both
  // identities before any browser load.
  await check(
    "J1b-token-route-prewarm",
    "test-auth token route answers for both identities before any browser load",
    async () => {
      await pollUntil(
        async () => {
          const oks = await Promise.all(
            ["A", "B"].map(async (id) => {
              try {
                const res = await fetch(`${BASE}/api/test-auth/token?user=${id}`);
                return res.ok;
              } catch {
                return false;
              }
            }),
          );
          return oks.every(Boolean) ? { warmed: true } : null;
        },
        { timeoutMs: 30_000, label: "token route warm" },
      );
      return { warmed: true };
    },
  );

  await check(
    "J1c-queue-state-reset",
    "harness clears prior-run queue entries and meeting history so repeat runs start clean",
    () => {
      const { entriesDeleted, participantsDeleted } = devEval(
        "devEval/queueProof:resetQueueState",
        { subjects: ["local-test-a", "local-test-b"] },
        { envLocalPath, target },
      );
      return { entriesDeleted, participantsDeleted };
    },
  );

  const a = await person("A");
  const b = await person("B");

  await check(
    "J2-onboard-a-through-shipped-wizard",
    "A completes the shipped /onboarding wizard and lands on /app",
    async () => {
      await driveOnboarding(a, "A");
      return { url: new URL(a.page.url()).pathname };
    },
  );

  await check(
    "J3-onboard-b-through-shipped-wizard",
    "B completes the shipped /onboarding wizard and lands on /app",
    async () => {
      await driveOnboarding(b, "B");
      return { url: new URL(b.page.url()).pathname };
    },
  );

  await check(
    "J4-onboarding-save-persisted",
    "the wizard's save wrote complete profiles and shared interests for both",
    async () => {
      const seen = await pollUntil(
        async () => {
          const sa = devEval(
            "devEval/queueProof:onboardingState",
            { subject: "local-test-a" },
            { envLocalPath, target },
          );
          const sb = devEval(
            "devEval/queueProof:onboardingState",
            { subject: "local-test-b" },
            { envLocalPath, target },
          );
          const ok =
            sa.complete &&
            sb.complete &&
            sa.field &&
            sb.field &&
            sa.jobTitle &&
            sb.jobTitle &&
            sa.company &&
            sb.company &&
            sa.interestsCount >= 1 &&
            sb.interestsCount >= 1;
          return ok ? { a: sa, b: sb } : false;
        },
        {
          timeoutMs: 30_000,
          label: "both onboarding saves persisted",
        },
      );
      return {
        a: {
          field: seen.value.a.field,
          interests: seen.value.a.interestsCount,
        },
        b: {
          field: seen.value.b.field,
          interests: seen.value.b.interestsCount,
        },
      };
    },
  );

  // 3. Matching through the product's own navigation, then the introduction.
  stage = "matching";
  await check(
    "J5-queue-through-product-navigation",
    "both users reach casual matching through the app's own nav and are matched",
    async () => {
      await enterQueueViaNav(a, "A");
      await pollUntil(async () => (await queueState(a)) === "waiting", {
        timeoutMs: 30_000,
        label: "A waiting in the queue",
      });
      await enterQueueViaNav(b, "B");
      await pollUntil(async () => (await queueState(a)) === "matched", {
        timeoutMs: 30_000,
        label: "A matched",
      });
      await pollUntil(async () => (await queueState(b)) === "matched", {
        timeoutMs: 30_000,
        label: "B matched",
      });
      return { states: [await queueState(a), await queueState(b)] };
    },
  );

  await check(
    "J6-introduction-card-names-and-reasons",
    "each introduction card names the partner and shows real match reasons",
    async () => {
      const cardText = (
        /** @type {Awaited<ReturnType<typeof launchPeer>>} */ peer,
      ) => peer.page.locator('[data-queue-state="matched"]').innerText();
      const aCard = await cardText(a);
      const bCard = await cardText(b);
      assert.ok(
        aCard.includes("Bob Brown"),
        `A's introduction must name Bob Brown: ${JSON.stringify(aCard.slice(0, 200))}`,
      );
      assert.ok(
        bCard.includes("Alice Anderson"),
        `B's introduction must name Alice Anderson: ${JSON.stringify(bCard.slice(0, 200))}`,
      );
      const why = aCard.indexOf("Why you matched");
      assert.ok(
        why !== -1,
        `A's introduction must carry the match-reasons section: ${JSON.stringify(aCard.slice(0, 200))}`,
      );
      const reasons = aCard
        .slice(why + "Why you matched".length)
        .replace(/\s+/g, " ")
        .trim();
      assert.ok(
        reasons.length > 0 && !/^[·\s]*$/.test(reasons),
        `A's introduction must show non-empty reasons: ${JSON.stringify(reasons.slice(0, 120))}`,
      );
      return { reasons: reasons.slice(0, 120) };
    },
  );

  await check(
    "J7-accept-same-introduction",
    "both accepts navigate to the same real call",
    async () => {
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

  /** The matched meeting id; J7 guarantees it is set. */
  const meetingId = /** @type {string} */ (result.meetingId);

  await check(
    "J8-participants-persisted",
    "the meeting persists exactly local-test-a and local-test-b",
    () => {
      const row = devEval(
        "devEval/queueProof:meeting",
        { meetingId: result.meetingId },
        { envLocalPath, target },
      );
      const subjects = (row.participants ?? [])
        .map((/** @type {{subject: string}} */ p) => p.subject)
        .sort();
      assert.deepEqual(subjects, ["local-test-a", "local-test-b"]);
      return subjects;
    },
  );

  // The product's accept navigation drops the local-only `?as=` identity
  // param, and a call page loaded without it defaults to identity A. Both
  // peers then open the call mesh as the same user, and joinCall's
  // one-session-per-user rule closes the first session as "replaced" —
  // neither side ever sees the other. Re-assert each peer's identity on the
  // call URL before joining: the same convention every other page load in
  // this harness uses, standing in for each browser's own real session.
  stage = "connect";
  await Promise.all(
    [
      { id: "A", peer: a },
      { id: "B", peer: b },
    ].map(({ id, peer }) => {
      const url = new URL(peer.page.url());
      url.searchParams.set("as", id);
      return peer.page.goto(url.toString(), {
        waitUntil: "domcontentloaded",
      });
    }),
  );

  await check(
    "J9-media-exchange-both-ways",
    "each side joins, connects, decodes the other's fixture color and hears its tone",
    async () => {
      try {
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
        const aHears = await expectTone(a, forA, 660);
        const bHears = await expectTone(b, forB, 440);
        return {
          fpsA: fpsA.fps,
          fpsB: fpsB.fps,
          aHears: aHears.heard,
          bHears: bHears.heard,
        };
      } catch (error) {
        // The transport records its presence view in window.__connvoCallLog
        // (NEXT_PUBLIC_CONNVO_CALL_BENCH is set by the boot). "welcome []"
        // here is decisive: the peer's signaling saw no other participant.
        for (const { label, peer } of [
          { label: "A", peer: a },
          { label: "B", peer: b },
        ]) {
          const traces = await peer.page
            .evaluate(() => {
              const w = /** @type {{ __connvoCallLog?: string[] }} */ (window);
              return (w.__connvoCallLog ?? ["(no trace log)"])
                .slice(-60)
                .join(" | ");
            })
            .catch(() => "(page unavailable)");
          log(`call trace ${label}: ${traces}`);
        }
        throw error;
      }
    },
  );

  // 5. One controls round inside the journey.
  stage = "controls";
  await check(
    "J10-mic-mute-round",
    "A's mic mute flips B's tile and silences B; unmute restores the tone",
    async () => {
      const forB = await remoteId(b);
      const forAId = forB; // B's remote tile carries A's participant id.
      const before = await probeState(a);
      await a.page.getByTestId("toggle-mic").click();
      const flipMs = await expectTileAttr(
        b,
        forAId,
        "data-audio-muted",
        "true",
        5_000,
      );
      const silenceMs = await expectSilence(b, forB);
      await a.page.getByTestId("toggle-mic").click();
      await expectTileAttr(b, forAId, "data-audio-muted", "false", 5_000);
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

  // 6. Collaboration inside the journey call.
  stage = "collaboration";

  /** Type a full notes buffer into a peer's editor and commit it (blur flushes).
   *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
   *  @param {string} text
   *  @returns {Promise<void>}
   */
  async function typeNotes(peer, text) {
    const editor = peer.page.locator(NOTES_EDITOR);
    await editor.waitFor({ state: "visible", timeout: 60_000 });
    await editor.fill(text);
    await editor.blur();
  }

  /** The peer's current notes buffer text.
   *  @param {Awaited<ReturnType<typeof launchPeer>>} peer
   *  @returns {Promise<string>}
   */
  async function editorText(peer) {
    return peer.page.locator(NOTES_EDITOR).inputValue();
  }

  /** Count how many times marker occurs in text (0 when text is empty).
   *  @param {string} text
   *  @param {string} marker
   *  @returns {number}
   */
  function countOf(text, marker) {
    if (!text) return 0;
    let count = 0;
    for (
      let at = text.indexOf(marker);
      at !== -1;
      at = text.indexOf(marker, at + marker.length)
    ) {
      count += 1;
    }
    return count;
  }

  await check(
    "J11-notes-and-prompts-shared",
    "notes carry both ways into the stored buffer; one prompt shows on both sides and the used mark syncs",
    async () => {
      await typeNotes(a, NOTES_A);
      await pollUntil(async () => (await editorText(b)).includes(NOTES_A), {
        timeoutMs: 60_000,
        label: "B's editor showing A's words",
      });
      const bBuffer = await editorText(b);
      await typeNotes(b, `${bBuffer} ${NOTES_B}`);
      await pollUntil(async () => (await editorText(a)).includes(NOTES_B), {
        timeoutMs: 60_000,
        label: "A's editor showing B's words",
      });
      const stored = storedNotes(meetingId);
      assert.ok(
        stored.content.includes(NOTES_A) && stored.content.includes(NOTES_B),
        `stored notes missing the typed phrases: ${JSON.stringify(stored.content.slice(0, 120))}`,
      );
      // Live prompts: an automatic pick fires shortly after joining; if none
      // has landed, request one manually, throttled inside the 10 s gap.
      let lastClick = 0;
      await pollUntil(
        async () => {
          if (await a.page.locator(CURRENT_PROMPT).count()) return true;
          const now = Date.now();
          if (now - lastClick > 12_000) {
            const button = a.page.getByRole("button", {
              name: /Get an idea|Another one/,
            });
            if (await button.count()) {
              try {
                if (await button.isEnabled()) {
                  await button.click();
                  lastClick = now;
                }
              } catch {
                // The panel re-disables between enabled-check and click; retry.
              }
            }
          }
          return false;
        },
        { timeoutMs: 120_000, intervalMs: 1500, label: "a prompt shown to A" },
      );
      const textA = (await a.page.locator(CURRENT_PROMPT).innerText()).trim();
      assert.ok(textA.length > 0, "prompt text is empty");
      await pollUntil(
        async () =>
          (await b.page
            .locator(CURRENT_PROMPT)
            .innerText()
            .catch(() => "")) === textA,
        { timeoutMs: 45_000, label: "B seeing the same prompt text" },
      );
      promptText = textA;
      await b.page.getByRole("button", { name: "We used this" }).click();
      await pollUntil(
        async () =>
          (await a.page.locator(PROMPTS_PANEL).innerText()).includes(
            "Marked as used",
          ),
        { timeoutMs: 30_000, label: "A seeing B's used mark" },
      );
      return {
        version: stored.version,
        prompt: textA.slice(0, 80),
      };
    },
  );

  // 7. Forced reload and recovery, still inside the journey call.
  stage = "reload-recovery";
  await check(
    "J12-reload-recovery-no-dup-no-loss",
    "B's forced reload rejoins; A keeps one tile; notes show each phrase once and the prompt persists",
    async () => {
      const t0 = Date.now();
      await b.page.reload({ waitUntil: "domcontentloaded" });
      await b.page.getByTestId("join-call").click({ timeout: 60_000 });
      await expectConnected(b);
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
      await pollUntil(
        async () => {
          if (!(await b.page.locator(NOTES_EDITOR).count())) return false;
          const value = await editorText(b);
          return countOf(value, NOTES_A) === 1 && countOf(value, NOTES_B) === 1;
        },
        {
          timeoutMs: 60_000,
          label: "B's reloaded editor showing each phrase exactly once",
        },
      );
      const bBuffer = await editorText(b);
      await typeNotes(b, `${bBuffer} ${NOTES_B2}`);
      await pollUntil(async () => (await editorText(a)).includes(NOTES_B2), {
        timeoutMs: 60_000,
        label: "A seeing B's post-reload words",
      });
      const stored = storedNotes(meetingId);
      for (const marker of [NOTES_A, NOTES_B, NOTES_B2]) {
        assert.equal(
          countOf(stored.content, marker),
          1,
          `${marker} must appear exactly once in the stored notes`,
        );
      }
      await pollUntil(
        async () =>
          (await b.page
            .locator(CURRENT_PROMPT)
            .innerText()
            .catch(() => "")) === promptText,
        {
          timeoutMs: 45_000,
          label: "B still seeing the same prompt after reload",
        },
      );
      return { recoveryMs: Date.now() - t0, version: stored.version };
    },
  );

  // 8. Leave and cleanup.
  stage = "leave-cleanup";
  await check(
    "J13-leave-cleanup",
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

  // 9. Recap for BOTH participants through the after-call screens.
  stage = "recap";
  await check(
    "J14-recap-for-both-participants",
    "A and B each open the recap and see the committed notes and the prompt",
    async () => {
      const notesChars = [];
      /** @type {[Awaited<ReturnType<typeof launchPeer>>, string][]} */
      const recapTargets = [
        [a, "A"],
        [b, "B"],
      ];
      for (const [peer, asParam] of recapTargets) {
        await peer.page.goto(`/app/meetings/${meetingId}?as=${asParam}`, {
          waitUntil: "domcontentloaded",
        });
        const recap = peer.page.locator('[data-testid="meeting-recap"]');
        await recap.waitFor({ state: "visible", timeout: 60_000 });
        const notesText = await recap
          .locator('[data-testid="recap-notes"]')
          .innerText();
        for (const marker of [NOTES_A, NOTES_B, NOTES_B2]) {
          assert.ok(
            notesText.includes(marker),
            `${peer.peerId}'s recap notes must carry ${marker}`,
          );
        }
        const recapText = (await recap.innerText()).replace(/\s+/g, " ");
        assert.ok(
          recapText.includes(promptText.replace(/\s+/g, " ")),
          `${peer.peerId}'s recap must name the prompt that was shown during the call`,
        );
        notesChars.push(notesText.length);
      }
      return { notesChars };
    },
  );

  // 10. ADVERSARIAL: a declined introduction on the same shipped route.
  stage = "adversarial";
  await check(
    "J15-declined-introduction-adversarial",
    "a second match is declined: both return to waiting with notices, the match reads declined, and no meeting is created",
    async () => {
      // Both re-enter through the product nav; the concluded call returns
      // their queue entries to idle, so the queue page auto-joins them again.
      await enterQueueViaNav(a, "A");
      await pollUntil(async () => (await queueState(a)) === "waiting", {
        timeoutMs: 30_000,
        label: "A waiting again",
      });
      await enterQueueViaNav(b, "B");
      await pollUntil(async () => (await queueState(a)) === "matched", {
        timeoutMs: 30_000,
        label: "A matched again",
      });
      await pollUntil(async () => (await queueState(b)) === "matched", {
        timeoutMs: 30_000,
        label: "B matched again",
      });
      // B declines the introduction; A must stay in the queue with a notice.
      await b.page
        .locator("[data-queue-state]")
        .getByRole("button", { name: "Decline", exact: true })
        .click();
      const notices = await pollUntil(
        async () => {
          const aState = await queueState(a);
          const bState = await queueState(b);
          if (aState !== "waiting" || bState !== "waiting") return false;
          const aText = await a.page.locator("[data-queue-state]").innerText();
          const bText = await b.page.locator("[data-queue-state]").innerText();
          const aNotice = aText
            .replace(/\s+/g, " ")
            .match(/Your partner declined[^.]*\./)?.[0];
          const bNotice = bText
            .replace(/\s+/g, " ")
            .match(/Match declined[^.]*\./)?.[0];
          return aNotice && bNotice ? { a: aNotice, b: bNotice } : false;
        },
        {
          timeoutMs: 30_000,
          intervalMs: 500,
          label: "both back to waiting with their decline notices",
        },
      );
      // The persisted queue state: waiting entries, decline notices, and the
      // match row itself reads declined.
      const aEntry = devEval(
        "devEval/queueProof:entryState",
        { subject: "local-test-a" },
        { envLocalPath, target },
      );
      const bEntry = devEval(
        "devEval/queueProof:entryState",
        { subject: "local-test-b" },
        { envLocalPath, target },
      );
      assert.equal(aEntry.state, "waiting", "A must persist as waiting");
      assert.equal(bEntry.state, "waiting", "B must persist as waiting");
      assert.equal(
        aEntry.noticeType,
        "partner_declined",
        "A must hold the partner_declined notice",
      );
      assert.equal(
        bEntry.noticeType,
        "declined",
        "B must hold the declined notice",
      );
      assert.equal(
        aEntry.matchState,
        "declined",
        "the match row must read declined",
      );
      // The declined introduction created NO meeting: each identity still
      // participates in exactly the one real journey meeting.
      const aMeetings = devEval(
        "devEval/queueProof:participantMeetings",
        { subject: "local-test-a" },
        { envLocalPath, target },
      );
      const bMeetings = devEval(
        "devEval/queueProof:participantMeetings",
        { subject: "local-test-b" },
        { envLocalPath, target },
      );
      assert.equal(
        aMeetings.meetings,
        1,
        `A must have exactly one meeting, has ${aMeetings.meetings}`,
      );
      assert.equal(
        bMeetings.meetings,
        1,
        `B must have exactly one meeting, has ${bMeetings.meetings}`,
      );
      return {
        notices: notices.value,
        matchState: aEntry.matchState,
        meetings: [aMeetings.meetings, bMeetings.meetings],
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
