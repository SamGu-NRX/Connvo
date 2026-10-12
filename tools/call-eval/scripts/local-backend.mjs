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
// `conn-eval` and `conn-eval-next` so this script can exit.
//
// Flags:
//   --stop      kill both tmux sessions
//   --status    print what is up (no changes)
//   --fresh     regenerate the RS256 keypair
//   --no-next   skip starting next dev
//   --port=<n>  next dev port (default 3000)

import { spawnSync } from "node:child_process";
import { createSign, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  applyConvexJsonOverride as overrideConvexJsonOnDisk,
  applyDeploymentEnv,
  deploymentPortFromUrl,
  deploymentRefusalMessage,
  pickConvexUrlFromEnvText,
  resolveSelectedDeployment,
} from "./local-backend-core.mjs";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(EVAL_DIR, "../..");
const LOCAL_DIR = path.join(EVAL_DIR, ".local");
const KEY_DIR = path.join(LOCAL_DIR, "keys");
const OUT_DIR = path.join(EVAL_DIR, "out");
const STATE_PATH = path.join(OUT_DIR, "state.json");

const CONV_TMUX = "conn-eval";
const NEXT_TMUX = "conn-eval-next";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
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

function sh(cmd, opts = {}) {
  const r = spawnSync("bash", ["-c", cmd], {
    cwd: REPO,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n[backend] FAILED (${r.status}): ${cmd}`);
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status || 1);
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function tmuxRunning(name) {
  // "=name" forces exact matching; a bare -t would prefix-match other sessions.
  return sh(`tmux has-session -t =${name} 2>/dev/null`, { capture: true, allowFail: true }).status === 0;
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
  sh(`tmux kill-session -t ${CONV_TMUX} 2>/dev/null; tmux kill-session -t ${NEXT_TMUX} 2>/dev/null`, { allowFail: true });
  restoreConvexJson();
  console.log("[backend] stopped (convex dev + next dev tmux sessions killed, convex.json restored)");
  process.exit(0);
}

if (flag("status")) {
  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : null;
  const { status: conv } = sh(`curl -s -o /dev/null -w '%{http_code}' ${state?.convexUrl?.split("~")[0] ?? "http://127.0.0.1:1"}`, { capture: true, allowFail: true });
  const { status: next } = sh(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${nextPort}`, { capture: true, allowFail: true });
  console.log(JSON.stringify({ statePath: STATE_PATH, stateFresh: !!state, convexHttp: conv, nextHttp: next, tmux: { conv: tmuxRunning(CONV_TMUX), next: tmuxRunning(NEXT_TMUX) } }, null, 2));
  process.exit(0);
}

// ------------------------------------------------------------------- keys
console.log("[backend] 1/6 keys");
const { priv, jwks, regenerated } = ensureKeys({ fresh: flag("fresh") });
console.log(`[backend] keys ${regenerated ? "regenerated" : "loaded"} (kid connvo-local-test-1)`);
const jwksDataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`;
const authKeyB64 = Buffer.from(JSON.stringify(priv)).toString("base64");

// ------------------------------------------------------- convex dev (tmux, D1)
console.log("[backend] 2/6 convex local deployment (anonymous, no account)");
buildHarnessTree();
applyConvexJsonOverride();
if (!tmuxRunning(CONV_TMUX)) {
  mkdirSync(LOCAL_DIR, { recursive: true });
  sh(`tmux new-session -d -s ${CONV_TMUX} "bash -c 'cd ${REPO} && npx convex dev --typecheck=disable 2>&1 | tee ${LOCAL_DIR}/convex-dev.log'"`);
} else {
  console.log("[backend] convex dev already running in tmux");
}

// Wait for the deployment URL in .env.local and a ready push in the log.
let convexUrl = null;
const deadline = Date.now() + 540_000; // first run may download the backend
console.log("[backend] waiting for convex dev (first run downloads the local backend binary)…");
while (Date.now() < deadline) {
  const envLocal = path.join(REPO, ".env.local");
  if (existsSync(envLocal)) {
    // Convex 1.28.x writes NEXT_PUBLIC_CONVEX_URL on a Next.js tree (legacy
    // CONVEX_URL tolerated) — reading only CONVEX_URL timed out a fresh
    // checkout even with the backend up.
    const picked = pickConvexUrlFromEnvText(readFileSync(envLocal, "utf8"));
    if (picked) convexUrl = picked.value;
  }
  const logPath = path.join(LOCAL_DIR, "convex-dev.log");
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const ready =
    convexUrl &&
    (log.includes("Convex functions ready") ||
      log.includes("Pushed code to") ||
      log.includes("waiting for changes"));
  if (ready) break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!convexUrl) {
  console.error("[backend] timed out waiting for the local Convex deployment; log tail:");
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

function localBackendAnswers(port) {
  const code = sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${port}/`, { capture: true, allowFail: true }).stdout.trim();
  return code !== "" && code !== "000"; // any HTTP status proves a live backend
}

/** @param {string} name @param {string} value */
function runEnvSet(name, value) {
  sh(`npx convex env set ${name} '${value}'`, { capture: true });
}

function assertLocalDeployment() {
  const port = deploymentPortFromUrl(convexUrl);
  // Guard-then-set (refusal BEFORE any `convex env set`) lives in
  // local-backend-core.mjs (unit-tested: a non-local deployment must never
  // reach the env-set calls); this wrapper supplies the real I/O and
  // process behavior.
  const result = applyDeploymentEnv({
    deployment: () => resolveSelectedDeployment({ envValue: process.env.CONVEX_DEPLOYMENT, envLocalContent: readEnvLocalIfPresent() }),
    backendAnswered: () => localBackendAnswers(port),
    port,
    envSets: [
      { name: EVAL_ENV_WORKOS_CLIENT_ID, value: DUMMY_WORKOS_CLIENT_ID },
      { name: EVAL_ENV_TEST_JWKS, value: jwksDataUri },
    ],
    envSet: runEnvSet,
  });
  if (!result.ok) {
    console.error(deploymentRefusalMessage(result.problems));
    process.exit(1);
  }
  console.log(`[backend] deployment guard ok: ${result.deployment.value} answering on 127.0.0.1:${result.port}`);
}

// Deployment env: dummy WorkOS client id (D2) + the harness JWKS provider.
// Guard runs first; on a non-local target it refuses and exits 1 before any
// env write happens (guard iii, unit-tested).
console.log("[backend] 3/6 deployment env (dummy WORKOS_CLIENT_ID + local test JWKS)");
assertLocalDeployment();

// Re-push so the backend re-evaluates auth.config with the new env, then seed.
// --typecheck=disable: same as the first push — the default typechecking
// would re-run tsc on this shared box mid-run.
console.log("[backend] 4/6 re-push + seed");
sh("npx convex dev --once --typecheck=disable", { capture: true });
const seedOut = sh("npx convex run devEval/seed", { capture: true }).stdout;
let seedJson = null;
try {
  seedJson = JSON.parse(seedOut.slice(seedOut.indexOf("{"), seedOut.lastIndexOf("}") + 1));
} catch {}
if (!seedJson?.meetingId) {
  console.error("[backend] could not parse seed result:\n" + seedOut);
  process.exit(1);
}
console.log(`[backend] seeded meeting ${seedJson.meetingId}`);

// ------------------------------------------------------------------- next dev
console.log("[backend] 5/6 next dev with eval env");
const nextUp = sh(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${nextPort}`, { capture: true, allowFail: true }).stdout.trim();
if (nextUp.startsWith("2") || nextUp.startsWith("3")) {
  console.log(`[backend] next dev already serving on :${nextPort}`);
} else {
  const nextEnv = [
    `NEXT_PUBLIC_CONVEX_URL='${convexUrl}'`,
    "NEXT_PUBLIC_CONNVO_TEST_AUTH=1",
    "NEXT_PUBLIC_CONNVO_CALL_BENCH=1",
    `WORKOS_CLIENT_ID=${DUMMY_WORKOS_CLIENT_ID}`,
    `CONNVO_LOCAL_TEST_AUTH_KEY='${authKeyB64}'`,
  ].join(" ");
  sh(`tmux new-session -d -s ${NEXT_TMUX} "bash -c 'cd ${REPO} && ${nextEnv} pnpm exec next dev -p ${nextPort} 2>&1 | tee ${LOCAL_DIR}/next-dev.log'"`);
  const nextDeadline = Date.now() + 180_000;
  while (Date.now() < nextDeadline) {
    const code = sh(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${nextPort}`, { capture: true, allowFail: true }).stdout.trim();
    if (code.startsWith("2") || code.startsWith("3")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const finalCode = sh(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${nextPort}`, { capture: true, allowFail: true }).stdout.trim();
  if (!finalCode.startsWith("2") && !finalCode.startsWith("3")) {
    console.error("[backend] next dev did not come up; see " + path.join(LOCAL_DIR, "next-dev.log"));
    process.exit(1);
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
