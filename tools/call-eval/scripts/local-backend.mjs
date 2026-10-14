#!/usr/bin/env node
// One command to bring up the S0 eval backend (CALL-PLAN.md D1):
//   pnpm call-eval:backend
//
// Provisions a local anonymous Convex deployment (no Convex/WorkOS account),
// pushes schema+functions, seeds users A/B/C + outsider O and one active
// meeting (A, B, C participants, A host), starts `next dev` with the eval
// env, and writes tools/call-eval/out/state.json for the runner and bench.
//
// Long-running pieces (convex dev, next dev) run detached in tmux sessions
// named after this checkout (conn-eval-<hash>, conn-eval-next-<hash>) so this
// script can exit.
//
// Flags:
//   --stop      kill both tmux sessions
//   --status    print what is up (no changes)
//   --fresh     regenerate the RS256 keypair
//   --no-next   skip starting next dev
//   --port=<n>  next dev port (default 3000)

import { spawnSync } from "node:child_process";
import { createHash, createSign, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import { parse as parseEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pure decision logic + guard discipline, unit-tested in
// local-backend-core.test.mjs. The script wires real I/O into these.
import {
  DUMMY_WORKOS_CLIENT_ID,
  EVAL_ENV_TEST_JWKS,
  EVAL_ENV_WORKOS_CLIENT_ID,
  HARNESS_INCLUDE_DIRS,
  LOCAL_TEST_ISSUER,
  PUSH_COMPLETE_MARKER,
  seedShapeProblems,
  shellQuote,
  applyConvexJsonOverride as overrideConvexJsonOnDisk,
  applyDeploymentEnv,
  deploymentPortFromUrl,
  deploymentRefusalMessage,
  pickConvexUrlFromEnvText,
  pruneTestArtifacts,
  resolveSelectedDeployment,
  requireAnonymousStartup,
  createTmuxLauncher,
  checkedConvexEnvironment,
  requireLoopbackUrl,
  selectedLocalBackend,
} from "./local-backend-core.mjs";
import { rebuildWithoutWatcher, runConvexCommand } from "./local-backend-process.mjs";

// authkit-nextjs constructs the WorkOS client on every middleware hit and
// throws NoApiKeyProvidedException without a key (:3000 500s — witnessed
// 2026-10-12). The test-auth path never calls WorkOS APIs, so a dummy key
// is inert here; it only needs to exist.
const DUMMY_WORKOS_API_KEY = "sk_test_connvo_local_dummy";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(EVAL_DIR, "../..");
const LOCAL_DIR = path.join(EVAL_DIR, ".local");
const KEY_DIR = path.join(LOCAL_DIR, "keys");
const OUT_DIR = path.join(EVAL_DIR, "out");
const STATE_PATH = path.join(OUT_DIR, "state.json");

// Session names carry a hash of this checkout's path: two worktrees (or two
// agents) on one machine must never attach to or kill each other's backend.
const REPO_TAG = createHash("sha1").update(REPO).digest("hex").slice(0, 8);
const CONV_TMUX = `conn-eval-${REPO_TAG}`;
const NEXT_TMUX = `conn-eval-next-${REPO_TAG}`;
const WATCHER_STATE = path.join(OUT_DIR, "watcher-processes.json");
// tmux and curl run with only these variables. Every tmux client getting the
// same set keeps launch, inspection and shutdown on one server; an inherited
// TMUX would point only some of them at the caller's server.
const CLIENT_ENV = {
  HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TMUX_TMPDIR: process.env.TMUX_TMPDIR,
};

/**
 * Run with the checked caller settings and explicit eval variables. The
 * tmux server's selectors and shell startup environment never reach Bash.
 * @param {string} session @param {string} file @param {Record<string, string>} env @param {string | string[]} command
 */
function launchInTmux(session, file, env, command) {
  mkdirSync(LOCAL_DIR, { recursive: true });
  const launcher = createTmuxLauncher({
    session, file, cwd: REPO, callerEnv: convexEnvironment(), env, command,
  });
  if (launcher.script !== null) writeFileSync(file, launcher.script, { mode: 0o700 });
  // A tmux pane's first process leads its own session and process group, so
  // shutdown can signal the watcher together with children it forks later.
  const result = spawnSync("tmux", launcher.args, { cwd: REPO, env: CLIENT_ENV });
  if (result.status !== 0) {
    throw new Error(`[backend] tmux launcher failed for ${session} (exit ${result.status})`);
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
// --after-call turns the after-call screens on for this run: the Convex env
// CONNVO_AFTER_CALL and next's NEXT_PUBLIC_CONNVO_AFTER_CALL. Without it
// both are written as "0", so a previous run's setting never lingers.
const afterCall = flag("after-call");
// ------------------------------------------------- slim harness tree + convex.json override
// The full app tree can exceed the local backend's 2 s module-load budget on a
// contended 2-core box. The harness only needs the call/meeting/messaging
// closure, so we push a materialized copy in convex-harness/ and point
// convex.json at it for the lifetime of the local deployment. The repo's
// convex.json is restored by `--stop`.
const CONVEX_JSON = path.join(REPO, "convex.json");
const HARNESS_DIR = path.join(REPO, "convex-harness");
// HARNESS_INCLUDE_DIRS / HARNESS_EXTERNAL live in local-backend-core.mjs
// (unit-tested: the allowlist must accept the devEval seed module).

function buildHarnessTree() {
  rmSync(HARNESS_DIR, { recursive: true, force: true });
  mkdirSync(HARNESS_DIR);
  for (const d of HARNESS_INCLUDE_DIRS) {
    cpSync(path.join(REPO, "convex", d), path.join(HARNESS_DIR, d), { recursive: true, dereference: true });
  }
  for (const f of readdirSync(path.join(REPO, "convex"))) {
    if (/\.(ts|json)$/.test(f)) {
      cpSync(path.join(REPO, "convex", f), path.join(HARNESS_DIR, f), { dereference: true });
    }
  }
  // Test/development artifacts are pruned at materialization time. Copying
  // .convexignore is NOT sufficient: the CLI does not honor it when bundling
  // an overridden functions dir (verified 2026-10-12 — the copied ignore file
  // sat in convex-harness/ while types/__tests__/ciValidation.ts was still
  // bundled, pushed, and executed its top-level process.exit(1) inside the
  // backend's module loader: InvalidModules, or the 300 s 408 loop when the
  // inner npm/codegen subprocesses were slower). See pruneTestArtifacts in
  // local-backend-core.mjs.
  if (existsSync(path.join(REPO, "convex", ".convexignore"))) {
    cpSync(path.join(REPO, "convex", ".convexignore"), path.join(HARNESS_DIR, ".convexignore"), { dereference: true });
  }
  const pruned = pruneTestArtifacts(HARNESS_DIR);
  if (pruned.length > 0) {
    const preview = pruned.slice(0, 5).join(", ") + (pruned.length > 5 ? ", ..." : "");
    console.log(`[backend] harness tree: pruned ${pruned.length} test artifact(s): ${preview}`);
  }
  console.log(`[backend] harness tree: ${readdirSync(HARNESS_DIR).length} entries in convex-harness/`);
}

function applyConvexJsonOverride() {
  // Override + backup-before-modify discipline live in local-backend-core.mjs
  // (unit-tested: the backup must exist even when out/ is absent); this
  // wrapper supplies the real paths.
  const { changed, original } = overrideConvexJsonOnDisk({ convexJsonPath: CONVEX_JSON, outDir: OUT_DIR });
  return changed ? original : null;
}

function restoreConvexJson() {
  const backup = path.join(EVAL_DIR, "out", "convex.json.orig");
  if (existsSync(backup)) {
    writeFileSync(CONVEX_JSON, readFileSync(backup, "utf8"));
    rmSync(backup);
    console.log("[backend] convex.json restored to the repo version");
  }
  rmSync(HARNESS_DIR, { recursive: true, force: true });
}

const nextPort = Number((args.find((a) => a.startsWith("--port=")) ?? "--port=3000").split("=")[1]) || 3000;

const CONVEX_CLI = path.join(REPO, "node_modules", "convex", "bin", "main.js");
function convexEnvironment() {
  return checkedConvexEnvironment({
    env: process.env, envLocalContent: readEnvLocalIfPresent(),
    envContent: existsSync(path.join(REPO, ".env")) ? readFileSync(path.join(REPO, ".env"), "utf8") : null,
  });
}
/** @param {string[]} args */
function convexCommand(args) {
  const result = runConvexCommand({ node: process.execPath, cli: CONVEX_CLI, args, cwd: REPO, env: convexEnvironment() });
  if (result.status !== 0) throw new Error(`[backend] Convex command failed (exit ${result.status})`);
  return result;
}

/** @param {string} bin @param {string[]} args @param {{capture?: boolean, allowFail?: boolean}} opts */
function command(bin, args, opts = {}) {
  const r = spawnSync(bin, args, {
    cwd: REPO,
    env: CLIENT_ENV,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`[backend] ${bin} command failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * A bin directory holding Node 20, 22 or 24, or null.
 * @returns {string | null}
 */
function supportedNodeBin() {
  const candidates = [
    process.env.CONNVO_EVAL_NODE_BIN,
    path.dirname(process.execPath),
    ...["24", "22", "20"].map((v) => `/opt/homebrew/opt/node@${v}/bin`),
    ...["24", "22", "20"].map((v) => `/usr/local/opt/node@${v}/bin`),
  ].filter(Boolean);
  for (const dir of candidates) {
    const bin = path.join(/** @type {string} */ (dir), "node");
    if (!existsSync(bin)) continue;
    const major = Number(spawnSync(bin, ["-p", "process.versions.node.split('.')[0]"], { encoding: "utf8", env: checkedConvexEnvironment({ env: process.env }) }).stdout.trim());
    if ([20, 22, 24].includes(major)) return /** @type {string} */ (dir);
  }
  return null;
}

function tmuxRunning(name) {
  // "=name" forces exact matching; a bare -t would prefix-match other sessions.
  return command("tmux", ["has-session", "-t", `=${name}`], { capture: true, allowFail: true }).status === 0;
}

// ---------------------------------------------------------------- keys (D2/D3)
function ensureKeys({ fresh }) {
  const privPath = path.join(KEY_DIR, "private.jwk.json");
  const jwksPath = path.join(KEY_DIR, "jwks.json");
  if (!fresh && existsSync(privPath) && existsSync(jwksPath)) {
    return {
      priv: JSON.parse(readFileSync(privPath, "utf8")),
      jwks: JSON.parse(readFileSync(jwksPath, "utf8")),
      regenerated: false,
    };
  }
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privJwk = privateKey.export({ format: "jwk" });
  const pubJwk = {
    kty: privJwk.kty,
    n: privJwk.n,
    e: privJwk.e,
    kid: "connvo-local-test-1",
    alg: "RS256",
    use: "sig",
  };
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(privPath, JSON.stringify(privJwk, null, 2), { mode: 0o600 });
  writeFileSync(jwksPath, JSON.stringify({ keys: [pubJwk] }, null, 2));
  return { priv: privJwk, jwks: { keys: [pubJwk] }, regenerated: true };
}

// --------------------------------------------------------------- tokens (D3)
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function mintToken(privJwk, claims) {
  const privateKey = createPrivateKey({ key: privJwk, format: "jwk" });
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "connvo-local-test-1" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

const SEED_USERS = [
  { key: "A", subject: "local-test-a", email: "a@connvo-local.test", name: "Alice Anderson" },
  { key: "B", subject: "local-test-b", email: "b@connvo-local.test", name: "Bob Brown" },
  { key: "C", subject: "local-test-c", email: "c@connvo-local.test", name: "Carol Chen" },
  { key: "O", subject: "local-test-o", email: "o@connvo-local.test", name: "Owen Outsider" },
];

// ------------------------------------------------------------------ stop/status
if (flag("stop")) {
  await rebuildWithoutWatcher({ session: CONV_TMUX, checkout: REPO, statePath: WATCHER_STATE, env: CLIENT_ENV, rebuild: restoreConvexJson });
  command("tmux", ["kill-session", "-t", `=${NEXT_TMUX}`], { capture: true, allowFail: true });
  console.log("[backend] stopped (convex dev + next dev tmux sessions killed, convex.json restored)");
  process.exit(0);
}

if (flag("status")) {
  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : null;
  const { status: conv } = command("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", state?.convexUrl?.split("~")[0] ?? "http://127.0.0.1:1"], { capture: true, allowFail: true });
  const { status: next } = command("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://localhost:${nextPort}`], { capture: true, allowFail: true });
  console.log(JSON.stringify({ statePath: STATE_PATH, stateFresh: !!state, convexHttp: conv, nextHttp: next, tmux: { conv: tmuxRunning(CONV_TMUX), next: tmuxRunning(NEXT_TMUX) } }, null, 2));
  process.exit(0);
}

// ------------------------------------------------------------------- keys
// This guard precedes key generation, tree/config writes, and any pushing CLI.
requireAnonymousStartup({
  env: process.env,
  envLocalContent: readEnvLocalIfPresent(),
  envContent: existsSync(path.join(REPO, ".env"))
    ? readFileSync(path.join(REPO, ".env"), "utf8")
    : null,
});
console.log("[backend] 1/6 keys");
const { priv, jwks, regenerated } = ensureKeys({ fresh: flag("fresh") });
console.log(`[backend] keys ${regenerated ? "regenerated" : "loaded"} (kid connvo-local-test-1)`);
const jwksDataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`;
const authKeyB64 = Buffer.from(JSON.stringify(priv)).toString("base64");

// ------------------------------------------------------- convex dev (tmux, D1)
console.log("[backend] 2/6 convex local deployment (anonymous, no account)");
// Never adopt a watcher started before the environment boundary existed.
await rebuildWithoutWatcher({
  session: CONV_TMUX,
  checkout: REPO,
  statePath: WATCHER_STATE,
  env: CLIENT_ENV,
  rebuild: () => { buildHarnessTree(); applyConvexJsonOverride(); },
});
{
  mkdirSync(LOCAL_DIR, { recursive: true });
  // TMPDIR must share the backend's filesystem: 1.46 stages external
  // modules via a cross-device rename that fails with EXDEV when TMPDIR
  // lands on a different mount than the backend data dir. stdin /dev/null:
  // 1.46 reads stdin even when attached to tmux and dies with
  // "Cannot prompt for input in non-interactive terminals" otherwise.
  // TMPDIR must share the backend's filesystem (1.46 renames staged files
  // across it), and must not contain spaces: the CLI runs `chmod +x <path>`
  // unquoted when it installs the backend binary, and this repo usually lives
  // under "Programming Projects".
  const convexTmp = path.join(os.homedir(), ".cache", "connvo-call-eval", REPO_TAG, "tmp");
  // The local backend deploys "use node" actions only with Node 20, 22 or 24
  // on PATH ("DeploymentNotConfiguredForNodeActions" otherwise), and the
  // pushed tree has some (lib/getstreamServer.ts, meetings/stream/*).
  const nodeBin = supportedNodeBin();
  if (!nodeBin) {
    console.error(
      "[backend] FAILED: the local Convex backend needs Node 20, 22 or 24 for \"use node\" actions, and none was found. " +
        "Install one (for example `brew install node@24`) or set CONNVO_EVAL_NODE_BIN to its bin directory.",
    );
    process.exit(1);
  }
  console.log(`[backend] node for convex dev: ${nodeBin}`);
  mkdirSync(convexTmp, { recursive: true });
  // WORKOS_CLIENT_ID and the test JWKS go to the CLI process from the start.
  // The backend evaluates auth.config.ts with the DEPLOYMENT env, which only
  // exists once this command has provisioned it, so the first boot push can
  // still fail; stage 3 sets the deployment env and stage 4 trusts only a
  // completed push logged after that.
  // A new session gets a new log: the wait below reads it for fatal errors,
  // and a previous run's crash must not count against this one.
  writeFileSync(path.join(LOCAL_DIR, "convex-dev.log"), "");
  launchInTmux(
    CONV_TMUX,
    path.join(LOCAL_DIR, "convex-dev.sh"),
    {
      TMPDIR: convexTmp,
      PATH: `${nodeBin}:${process.env.PATH ?? ""}`,
      // Anonymous local deployment, no account and no prompts (CLI 1.46).
      CONVEX_AGENT_MODE: "anonymous",
      [EVAL_ENV_WORKOS_CLIENT_ID]: DUMMY_WORKOS_CLIENT_ID,
      [EVAL_ENV_TEST_JWKS]: jwksDataUri,
    },
    [path.join(nodeBin, "node"), path.join(EVAL_DIR, "scripts", "local-backend-watch.mjs"),
      CONVEX_CLI, path.join(LOCAL_DIR, "convex-dev.log"), "dev", "--typecheck=disable"],
  );
}

// Wait for the deployment URL in .env.local and a live local backend.
// This waits for PROVISIONING only: the first push cannot succeed before
// stage 3 sets the deployment env (convex/auth.config.ts is evaluated
// server-side at push time and throws "WORKOS_CLIENT_ID environment
// variable is required" when it is absent), so env-set runs before the
// first REQUIRED push and the completed-push marker is enforced at the
// stage-4 wait — a fresh-marker slice that cannot see pre-env pushes.
// Waiting for push markers here made a fresh checkout sit through the
// watch's failing-push loop for the whole deadline.
let convexUrl = null;
let deploymentName = "";
const deadline = Date.now() + 540_000; // first run may download the backend
console.log("[backend] 2/6 waiting for convex dev provisioning (first run downloads the local backend binary)...");
while (Date.now() < deadline) {
  const envLocal = path.join(REPO, ".env.local");
  if (existsSync(envLocal)) {
    // Convex 1.28.x writes NEXT_PUBLIC_CONVEX_URL on a Next.js tree (legacy
    // CONVEX_URL tolerated) — reading only CONVEX_URL timed out a fresh
    // checkout even with the backend up.
    const picked = pickConvexUrlFromEnvText(readFileSync(envLocal, "utf8"));
    if (picked) {
      const target = selectedLocalBackend({
        cwd: REPO, env: { ...parseEnv(readFileSync(envLocal, "utf8")), ...process.env },
      });
      // target.url is an origin; `http://127.0.0.1:3210/` names the same one.
      if (requireLoopbackUrl(picked.value).origin !== target.url) throw new Error("[backend] Convex URL does not match selected local backend");
      convexUrl = target.url;
      deploymentName = target.name;
    }
  }
  if (convexUrl && localBackendAnswers(convexUrl, deploymentName)) break;
  // A dead session or a CLI crash will not recover by waiting out the deadline.
  const provisionLog = path.join(LOCAL_DIR, "convex-dev.log");
  const provisionText = existsSync(provisionLog) ? readFileSync(provisionLog, "utf8") : "";
  if (!tmuxRunning(CONV_TMUX) || /Unexpected Error/.test(provisionText)) {
    console.error(`[backend] FAILED (provisioning): convex dev ${tmuxRunning(CONV_TMUX) ? "reported an error" : "exited"}; log tail:`);
    console.error(provisionText.slice(-3000));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
if (!convexUrl || !localBackendAnswers(convexUrl, deploymentName)) {
  console.error("[backend] TIMED OUT (provisioning): no local deployment URL + live backend within 540 s; convex-dev log tail:");
  const logPath = path.join(LOCAL_DIR, "convex-dev.log");
  if (existsSync(logPath)) console.error(readFileSync(logPath, "utf8").slice(-4000));
  process.exit(1);
}
console.log(`[backend] convex deployment up: ${convexUrl}`);

// Deployment guard: `convex env set` writes into whichever deployment the
// convex CLI selects (CONVEX_DEPLOYMENT env, else .env.local). Eval env vars
// must never land on anything but the local anonymous backend.
function readEnvLocalIfPresent() {
  const envLocalPath = path.join(REPO, ".env.local");
  return existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : null;
}

/**
 * The backend counts as alive only when it answers `GET /instance_name` with
 * 200 and the selected deployment's name, the check Convex 1.46 itself uses
 * (ensureBackendRunning in localDeployment/run.js). A redirect or another
 * listener on the port is not proof. curl follows no redirects without -L, and
 * -q skips ~/.curlrc, which could add one.
 * @param {string} url @param {string} name
 */
function localBackendAnswers(url, name) {
  // Under co-tenant load a single short probe can be CPU-starved into a
  // false negative (witnessed 2026-10-12 03:32-03:41Z: load 13-22 starved
  // the provisioning wait for its whole 540 s budget while the backend
  // answered in <1 ms). Two probes with a longer ceiling; either success
  // proves liveness.
  for (const maxTime of ["10", "10"]) {
    const out = command("curl", ["-q", "-s", "--noproxy", "*", "--max-time", maxTime, "-w", "\n%{http_code}", `${url}/instance_name`], { capture: true, allowFail: true }).stdout;
    const cut = out.lastIndexOf("\n");
    if (cut !== -1 && out.slice(cut + 1) === "200" && out.slice(0, cut) === name) return true;
  }
  return false;
}

/** @param {string} name @param {string} value */
function runEnvSet(name, value) {
  convexCommand(["env", "set", name, value]);
}

function assertLocalDeployment() {
  const target = selectedLocalBackend({ cwd: REPO, env: { ...parseEnv(readEnvLocalIfPresent() ?? ""), ...process.env } });
  if (target.url !== convexUrl) throw new Error("[backend] local backend URL changed");
  const port = deploymentPortFromUrl(target.url);
  // Guard-then-set (refusal BEFORE any `convex env set`) lives in
  // local-backend-core.mjs (unit-tested: a non-local deployment must never
  // reach the env-set calls); this wrapper supplies the real I/O and
  // process behavior.
  const result = applyDeploymentEnv({
    deployment: () => resolveSelectedDeployment({ envValue: process.env.CONVEX_DEPLOYMENT, envLocalContent: readEnvLocalIfPresent() }),
    backendAnswered: () => localBackendAnswers(target.url, target.name),
    port,
    envSets: [
      { name: EVAL_ENV_WORKOS_CLIENT_ID, value: DUMMY_WORKOS_CLIENT_ID },
      { name: EVAL_ENV_TEST_JWKS, value: jwksDataUri },
      { name: "CONNVO_AFTER_CALL", value: afterCall ? "1" : "0" },
    ],
    envSet: runEnvSet,
  });
  if (!result.ok) {
    console.error(deploymentRefusalMessage(result.problems));
    process.exit(1);
  }
  console.log(`[backend] deployment guard ok: anonymous local backend answering on 127.0.0.1:${result.port}`);
}

// Deployment env: dummy WorkOS client id (D2) + the harness JWKS provider.
// Guard runs first; on a non-local target it refuses and exits 1 before any
// env write happens (guard iii, unit-tested).
console.log("[backend] 3/6 deployment env (dummy WORKOS_CLIENT_ID + local test JWKS)");
assertLocalDeployment();

// First REQUIRED push: the watch's boot push runs before the deployment env
// exists (the watch itself provisions the backend), so it may fail; the
// nudge (touch auth.config.ts) triggers a fresh push that IS evaluated with
// the env set in stage 3. `convex dev --once` refuses while the watch
// session's local backend is already listening on the port ("A local
// backend is still running on port ..."), so the nudge is how we get a
// deterministic completed push; the marker search only sees log content
// written after the nudge.
console.log("[backend] 4/6 re-push + seed");
const convLog = path.join(LOCAL_DIR, "convex-dev.log");
const logLenBeforeRePush = existsSync(convLog) ? readFileSync(convLog, "utf8").length : 0;
utimesSync(path.join(HARNESS_DIR, "auth.config.ts"), new Date(), new Date());
const rePushDeadline = Date.now() + 540_000; // same budget as stage 2: pushes retry through 408s under co-tenant load
let rePushed = false;
while (Date.now() < rePushDeadline) {
  const fresh = existsSync(convLog) ? readFileSync(convLog, "utf8").slice(logLenBeforeRePush) : "";
  // Only the completion line counts: "waiting for changes" also prints after
  // a FAILED push, and a deployment URL proves provisioning, not a push.
  if (fresh.includes(PUSH_COMPLETE_MARKER)) {
    console.log(`[backend] push completed after the deployment env was set ("${PUSH_COMPLETE_MARKER}" in convex-dev.log)`);
    rePushed = true;
    break;
  }
  // Fail fast with a named cause instead of burning the whole budget — but
  // only for FATAL rejections (module evaluation failures that no retry
  // fixes). "Hit an error while pushing" is the CLI's generic wrapper for
  // ANY push error, including the retryable "Environment variables have
  // changed during push" race with stage 3's env-set: the CLI retries it
  // itself and then prints the completion marker (witnessed 2026-10-12
  // 03:37:40 — the retry completed 3.82 s after the wrapper line, four
  // seconds after a fail-fast on the wrapper alone had already killed the
  // script). Generic wrapper lines fall through to the marker wait; a
  // genuinely fatal push surfaces as the timeout below with the log tail.
  const fatalLine = fresh
    .split("\n")
    .find((l) => /InvalidModules|DeploymentNotConfiguredForNodeActions|Uncaught .*Error|process\.exit\(\) called|WORKOS_CLIENT_ID environment variable is required/.test(l));
  if (fatalLine) {
    console.error(`[backend] FAILED (push rejected): ${fatalLine.trim()}`);
    console.error("[backend] matching log lines:");
    console.error(
      fresh
        .split("\n")
        .filter((l) => /InvalidModules|Hit an error while pushing|Uncaught|WORKOS_CLIENT_ID|Environment variables have changed/.test(l))
        .slice(-15)
        .join("\n"),
    );
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
if (!rePushed) {
  console.error("[backend] TIMED OUT (push): the watch session did not complete a re-push within 540 s; convex-dev log tail:");
  if (existsSync(convLog)) console.error(readFileSync(convLog, "utf8").slice(-4000));
  process.exit(1);
}
const seedOut = convexCommand(["run", "devEval/seed"]).stdout;
let seedJson = null;
try {
  seedJson = JSON.parse(seedOut.slice(seedOut.indexOf("{"), seedOut.lastIndexOf("}") + 1));
} catch {}
if (!seedJson?.meetingId) {
  console.error("[backend] could not parse seed result:\n" + seedOut);
  process.exit(1);
}
console.log(`[backend] seeded meeting ${seedJson.meetingId}`);

// Read the seed back and check every fact the H-14 proof relies on. Positional
// JSON args (the CLI has no --meetingId option); no shell, so no quoting.
const shapeRun = convexCommand(["run", "devEval/shape:shape", JSON.stringify({ meetingId: seedJson.meetingId })]);
let shape = null;
try {
  const out = shapeRun.stdout ?? "";
  shape = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
} catch {}
const shapeProblems = shapeRun.status === 0 ? seedShapeProblems(shape) : [`shape query exited ${shapeRun.status}: ${(shapeRun.stderr ?? "").slice(-400)}`];
if (shapeProblems.length) {
  console.error(`[backend] FAILED (seed shape): ${shapeProblems.join("; ")}`);
  process.exit(1);
}
console.log("[backend] seed shape verified: A host, B and C participants, O no row, meeting and meetingState active");

// ------------------------------------------------------------------- next dev
const httpCode = () =>
  command("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", `http://localhost:${nextPort}/dev/auth-proof?as=A`], { capture: true, allowFail: true }).stdout.trim();
const serving = (/** @type {string} */ code) => code.startsWith("2") || code.startsWith("3");
{
  // src/proxy.ts (authkitMiddleware) runs in the edge runtime, which reads
  // only `.env*` files in next dev, so the eval env goes into a managed block
  // in .env.local, and also into the launcher's environment.
  const envLocalPath = path.join(REPO, ".env.local");
  const blockStart = "# connvo-call-eval eval env (managed block) — BEGIN";
  const blockEnd = "# connvo-call-eval eval env (managed block) — END";
  /** @type {Record<string, string>} */
  const nextEnv = {
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
    NEXT_PUBLIC_CONNVO_TEST_AUTH: "1",
    NEXT_PUBLIC_CONNVO_CALL_BENCH: "1",
    // The real call page, signaling over this backend (convex/meetings/webrtc/mesh.ts).
    NEXT_PUBLIC_CONNVO_REAL_CALL: "1",
    NEXT_PUBLIC_CONNVO_AFTER_CALL: afterCall ? "1" : "0",
    WORKOS_CLIENT_ID: DUMMY_WORKOS_CLIENT_ID,
    WORKOS_API_KEY: DUMMY_WORKOS_API_KEY,
    // authkit-nextjs reads the redirect URI only from the NEXT_PUBLIC_ name.
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `http://localhost:${nextPort}/auth/callback`,
    WORKOS_COOKIE_PASSWORD: "connvo-local-eval-cookie-password-0123456789",
    CONNVO_LOCAL_TEST_AUTH_KEY: authKeyB64,
  };
  const evalBlock = [blockStart, ...Object.entries(nextEnv).map(([k, v]) => `${k}=${v}`), blockEnd, ""].join("\n");
  let envLocal = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  const from = envLocal.indexOf(blockStart);
  if (from !== -1) {
    const to = envLocal.indexOf(blockEnd);
    envLocal = to === -1 ? envLocal.slice(0, from) : envLocal.slice(0, from) + envLocal.slice(to + blockEnd.length + 1);
  }
  if (envLocal.length > 0 && !envLocal.endsWith("\n")) envLocal += "\n";
  writeFileSync(envLocalPath, envLocal + evalBlock);

  // A running Next started with a different env (a new deployment URL, or a
  // key regenerated by --fresh) would keep signing tokens with the old key
  // while Convex trusts the new one. Restart unless it is ours and its env
  // is unchanged.
  const fingerprint = createHash("sha256").update(evalBlock).digest("hex");
  const fingerprintPath = path.join(LOCAL_DIR, "next-env.sha256");
  const sameEnv = existsSync(fingerprintPath) && readFileSync(fingerprintPath, "utf8") === fingerprint;
  const ours = tmuxRunning(NEXT_TMUX);
  const code = httpCode();
  if (serving(code) && !ours) {
    console.error(`[backend] FAILED: port ${nextPort} is served by a process this script did not start; pass --port=<free port>`);
    process.exit(1);
  }
  if (ours && sameEnv && serving(code)) {
    console.log(`[backend] 5/6 next dev already serving on :${nextPort} with this env`);
  } else {
    console.log(`[backend] 5/6 ${ours ? "restarting" : "starting"} next dev on :${nextPort}${ours && !sameEnv ? " (env or key changed)" : ""}`);
    if (ours) command("tmux", ["kill-session", "-t", `=${NEXT_TMUX}`], { capture: true, allowFail: true });
    launchInTmux(NEXT_TMUX, path.join(LOCAL_DIR, "next-dev.sh"), nextEnv, `pnpm exec next dev -p ${nextPort} 2>&1 | tee ${shellQuote(path.join(LOCAL_DIR, "next-dev.log"))}`);
    writeFileSync(fingerprintPath, fingerprint);
    const nextDeadline = Date.now() + 240_000;
    while (Date.now() < nextDeadline && !serving(httpCode())) await new Promise((r) => setTimeout(r, 2000));
    if (!serving(httpCode())) {
      console.error("[backend] next dev did not come up; see " + path.join(LOCAL_DIR, "next-dev.log"));
      process.exit(1);
    }
  }
}
const nextBaseUrl = `http://localhost:${nextPort}`;

// ------------------------------------------------------- tokens + state.json
console.log("[backend] 6/6 tokens + state.json");
const nowS = Math.floor(Date.now() / 1000);
const users = {};
for (const u of SEED_USERS) {
  users[u.key] = {
    token: mintToken(priv, {
      sub: u.subject,
      email: u.email,
      name: u.name,
      iss: LOCAL_TEST_ISSUER,
      aud: DUMMY_WORKOS_CLIENT_ID,
      iat: nowS,
      exp: nowS + 600,
    }),
    workosUserId: u.subject,
    email: u.email,
    name: u.name,
    expiresAt: (nowS + 600) * 1000,
  };
}

const state = {
  convexUrl,
  nextBaseUrl,
  meetingId: seedJson.meetingId,
  users,
  generatedAt: new Date().toISOString(),
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
console.log(`[backend] READY — state.json at ${STATE_PATH}`);
console.log(`[backend]   convex: ${convexUrl}`);
console.log(`[backend]   next:   ${nextBaseUrl}  (bench: ${nextBaseUrl}/dev/call-bench/reference)`);
