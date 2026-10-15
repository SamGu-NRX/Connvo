// Pure decision logic for local-backend.mjs, extracted so the three S0 guard
// fixes are unit-testable (the script itself is a side-effecting CLI: importing
// it runs the whole bring-up). Behavior moved here is unchanged; the script
// wires real I/O (fs, subprocesses, curl) into these functions. Tests:
// tools/call-eval/scripts/local-backend-core.test.mjs — each test asserts an
// invariant that fails on the pre-fix behavior (recon dossier section 2,
// defects i–iii at parent bbc62fae, fixed at f06669f).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseEnv } from "dotenv";

/** @param {string | undefined | null} value */
export function anonymousDeploymentName(value) {
  const name = value?.replace(/^(?:anonymous|local):/, "");
  return name && /^anonymous-[a-zA-Z0-9-]+$/.test(name) ? name : null;
}

/**
 * Convex 1.46 selects process env, then .env.local, then .env BEFORE its
 * anonymous-mode fallback. Refuse cloud selectors before `convex dev` can
 * push, not just before the later deployment-env writes. Values stay private.
 * @param {{ env: NodeJS.ProcessEnv, envLocalContent?: string | null, envContent?: string | null }} opts
 * @returns {string | null} the explicit local target, or null for a new anonymous deployment
 */
export function requireAnonymousStartup({ env, envLocalContent, envContent }) {
  const effective = { ...env };
  for (const text of [envLocalContent, envContent]) {
    for (const [key, value] of Object.entries(parseEnv(text ?? ""))) {
      if (effective[key] === undefined) effective[key] = value;
    }
  }
  for (const key of [
    "CONVEX_DEPLOY_KEY",
    "CONVEX_DEPLOYMENT_TOKEN",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
  ]) {
    if (effective[key]) {
      throw new Error(`[backend] REFUSING to start convex dev: ${key} selects or authenticates a non-anonymous deployment`);
    }
  }
  const deployment = effective.CONVEX_DEPLOYMENT;
  // isAnonymousDeployment in the pinned CLI requires the deployment NAME
  // to start with anonymous-, after any type prefix has been stripped.
  if (deployment && !anonymousDeploymentName(deployment)) {
    throw new Error("[backend] REFUSING to start convex dev: CONVEX_DEPLOYMENT is not an anonymous local target");
  }
  // Compare origins, not text: `http://127.0.0.1:3210/` and
  // `http://127.0.0.1:3210` select the same backend.
  const origins = [effective.NEXT_PUBLIC_CONVEX_URL, effective.CONVEX_URL]
    .filter(Boolean)
    .map((url) => requireLoopbackUrl(url).origin);
  if (new Set(origins).size > 1)
    throw new Error("[backend] conflicting Convex URL settings");
  return deployment || null;
}

const DEPLOYMENT_SELECTORS = [
  "CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY",
];
const PROCESS_ENV_KEYS = ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"];

/**
 * Pin every selector after applying the CLI's dotenv precedence. Empty
 * credentials prevent a later dotenv load from choosing another target.
 * The allowlist excludes BASH_ENV, ENV, NODE_OPTIONS and loader hooks.
 * @param {{ env: NodeJS.ProcessEnv, envLocalContent?: string | null, envContent?: string | null }} opts
 * @returns {Record<string, string>}
 */
export function checkedConvexEnvironment(opts) {
  const deployment = requireAnonymousStartup(opts);
  /** @type {Record<string, string>} */
  const clean = {};
  for (const key of [...PROCESS_ENV_KEYS, EVAL_ENV_WORKOS_CLIENT_ID, EVAL_ENV_TEST_JWKS]) {
    if (opts.env[key] !== undefined) clean[key] = opts.env[key];
  }
  for (const key of DEPLOYMENT_SELECTORS) clean[key] = "";
  clean.CONVEX_DEPLOYMENT = deployment ?? "";
  clean.CONVEX_AGENT_MODE = "anonymous";
  return clean;
}

/**
 * Environment for `next dev`. Next loads `.env.development.local`, `.env.local`,
 * `.env.development` and `.env` under the caller's environment, so every
 * source is checked on its own: a cloud selector, key or URL in any of them is
 * refused even when another source would shadow it, and all Convex URLs must
 * share one loopback origin. That origin is then set in the child environment,
 * where Next never replaces it from a file.
 * @param {{ env: NodeJS.ProcessEnv, files: Array<string | null> }} opts file contents, highest Next precedence first; null for an absent file
 * @returns {Record<string, string>}
 */
export function checkedNextEnvironment({ env, files }) {
  const sources = [env, ...files.map((text) => parseEnv(text ?? ""))];
  for (const source of sources) requireAnonymousStartup({ env: source });
  const origins = new Set(
    sources.flatMap((source) =>
      [source.NEXT_PUBLIC_CONVEX_URL, source.CONVEX_URL].filter(Boolean).map((url) => requireLoopbackUrl(url).origin),
    ),
  );
  if (origins.size > 1) throw new Error("[backend] conflicting Convex URL settings");
  /** @type {NodeJS.ProcessEnv} */
  const effective = {};
  for (const source of sources)
    for (const [key, value] of Object.entries(source)) if (effective[key] === undefined) effective[key] = value;
  const clean = checkedConvexEnvironment({ env });
  clean.CONVEX_DEPLOYMENT = requireAnonymousStartup({ env: effective }) ?? "";
  for (const origin of origins) {
    clean.NEXT_PUBLIC_CONVEX_URL = origin;
    clean.CONVEX_URL = origin;
  }
  return clean;
}

/**
 * tmux panes inherit the server's environment, which may differ from the
 * checked caller. Start env directly, with no intervening shell, and clear
 * that environment before Bash starts. Preserve caller selectors, including
 * empty values that prevent dotenv from falling back to a different target.
 * @param {{ session: string, file: string, cwd: string, callerEnv: NodeJS.ProcessEnv, env: Record<string, string>, command: string | string[] }} opts
 */
export function createTmuxLauncher({ session, file, cwd, callerEnv, env, command }) {
  /** @type {Record<string, string>} */
  const launchEnv = {};
  for (const key of [
    "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE",
    "CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN",
    "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY",
  ]) {
    const value = callerEnv[key];
    if (value !== undefined) launchEnv[key] = value;
  }
  Object.assign(launchEnv, env);
  requireAnonymousStartup({ env: launchEnv });
  if (Array.isArray(command)) {
    return {
      args: ["new-session", "-d", "-s", session, "-c", cwd, "--", "/usr/bin/env", "-i",
        ...Object.entries(launchEnv).map(([key, value]) => `${key}=${value}`), ...command],
      script: null,
    };
  }
  return {
    args: [
      "new-session", "-d", "-s", session, "--",
      "/usr/bin/env", "-i", "/bin/bash", "--noprofile", "--norc", file,
    ],
    script: [
      "#!/bin/bash",
      "set -uo pipefail",
      `cd ${shellQuote(cwd)} || exit 1`,
      ...Object.entries(launchEnv).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
      command,
      "",
    ].join("\n"),
  };
}

/** @typedef {{ source: "environment" | ".env.local" | "unset", value: string | null }} SelectedDeployment */

export const LOCAL_TEST_ISSUER = "https://connvo-local-test.invalid";
export const DUMMY_WORKOS_CLIENT_ID = "client_connvo_local_dummy";

// Eval env vars must never land on anything but the local anonymous backend.
export const EVAL_ENV_WORKOS_CLIENT_ID = "WORKOS_CLIENT_ID";
export const EVAL_ENV_TEST_JWKS = "CONNVO_LOCAL_TEST_JWKS";

// ---------------------------------------- slim harness tree + convex.json override
// The full app tree can exceed the local backend's 2 s module-load budget on a
// contended 2-core box. The harness only needs the call/meeting/messaging
// closure, so we push a materialized copy in convex-harness/ and point
// convex.json at it for the lifetime of the local deployment. The repo's
// convex.json is restored by `--stop`.
export const HARNESS_INCLUDE_DIRS = [
  "auth", "users", "meetings", "participants", "messaging", "realtime",
  "transcripts", "matching", "interests", "settings", "system",
  "schema", "lib", "types", "environments", "_generated",
  "prompts", // live conversation prompt selection and recap records
  "notes", // notes ledger modules the call/meeting closure imports
  "devEval", // eval seed mutation (devEval/seed) invoked in step 4/6
  "history", // after-call history (#33), behind CONNVO_AFTER_CALL
  "network", // post-call feedback + mutual connections (cv6-connect-network)
];

export const HARNESS_EXTERNAL = ["@stream-io/video-react-sdk", "openai"];

/**
 * Allowlist decision for a Convex function path as the CLI spells it
 * (`dir/module` or `dir/module:fn`). Root-level function files (no slash) are
 * copied unconditionally by buildHarnessTree; a slashed path is included only
 * when its first segment is a harness include dir.
 * @param {string} modulePath
 * @returns {boolean}
 */
export function isHarnessModulePath(modulePath) {
  if (!modulePath || !modulePath.includes("/")) return Boolean(modulePath);
  return HARNESS_INCLUDE_DIRS.includes(modulePath.split("/")[0]);
}

/**
 * Test/development artifacts must never reach the pushed module tree. The
 * CLI does not honor .convexignore when bundling an overridden functions
 * dir (verified 2026-10-12: convex-harness/.convexignore sat in the tree
 * while types/__tests__/ciValidation.ts was still bundled, pushed, and
 * EXECUTED by the backend's module loader — it spawns npm/tsc/npx-codegen
 * subprocesses inside the backend and calls process.exit(1); that produced
 * 400 InvalidModules "Uncaught process.exit() called with exit code 1" and,
 * when the inner subprocesses were slower, the 300 s 408 loop). Exclusion
 * therefore happens at materialization time.
 * @param {string} relPath path relative to the harness root (POSIX slashes)
 * @returns {boolean}
 */
export function isTestArtifactPath(relPath) {
  if (!relPath) return false;
  const p = relPath.split(path.sep).join("/");
  const base = p.split("/").pop() ?? p;
  if (/(^|\/)__tests__(\/|$)/.test(p) || /(^|\/)test(\/|$)/.test(p)) return true;
  if (/\.test\.[tj]sx?$/.test(base) || /\.spec\.[tj]sx?$/.test(base)) return true;
  if (/^vitest\.config\.[tj]sx?$/.test(base) || /^vitest\.workspace\.[tj]sx?$/.test(base)) return true;
  return false;
}

/**
 * Remove every test artifact from a materialized tree. Idempotent: a second
 * run removes nothing. Returns the removed paths (directories appear as
 * plain paths, files likewise) for logging and tests.
 * @param {string} root harness tree root
 * @returns {string[]}
 */
export function pruneTestArtifacts(root) {
  /** @type {string[]} */
  const removed = [];
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (isTestArtifactPath(`${relPath}/x`)) {
          rmSync(abs, { recursive: true, force: true });
          removed.push(relPath);
          continue;
        }
        walk(abs, relPath);
        continue;
      }
      if (isTestArtifactPath(relPath)) {
        rmSync(abs, { force: true });
        removed.push(relPath);
      }
    }
  };
  walk(root, "");
  return removed;
}

/**
 * Pure override computation: functions dir switched to convex-harness/, node
 * runtime pinned to 18 with the heavy packages externalized (resolved from
 * node_modules instead of bundled into the push).
 * @param {Record<string, any>} parsed convex.json contents
 * @param {string[]} [externalPackages]
 * @returns {Record<string, any>}
 */
export function convexJsonOverrideObject(parsed, externalPackages = HARNESS_EXTERNAL) {
  return {
    ...parsed,
    functions: "convex-harness",
    // The 1.28.0 CLI reads node.externalPackages — the old key
    // (node.externalDependencies) is ignored, so the SDKs stayed bundled.
    node: { ...(parsed.node ?? {}), "18": true, externalPackages },
  };
}

/**
 * The deployment URL the convex CLI writes to .env.local. Convex 1.28.x
 * detects a Next.js tree and writes NEXT_PUBLIC_CONVEX_URL; a bare
 * CONVEX_URL is the legacy fallback. Returns null when neither is set.
 * @param {unknown} text .env.local contents (null/undefined when the file is absent)
 * @returns {{ source: string, value: string } | null}
 */
export function pickConvexUrlFromEnvText(text) {
  if (typeof text !== "string") return null;
  /** @param {string} s */
  const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");
  const parsed = parseEnv(text);
  requireAnonymousStartup({ env: parsed });
  const source = parsed.NEXT_PUBLIC_CONVEX_URL ? "NEXT_PUBLIC_CONVEX_URL" : "CONVEX_URL";
  if (parsed[source]) return { source, value: unquote(parsed[source]) };
  return null;
}

/**
 * Override convex.json for the lifetime of the local deployment, with the
 * backup written BEFORE the repo file is touched (guard ii). Creates outDir
 * first, so a failed backup can never leave a modified convex.json without a
 * restorable original.
 * @param {{ convexJsonPath: string, outDir: string, externalPackages?: string[] }} opts
 * @returns {{ changed: boolean, original: string | null }}
 */
export function applyConvexJsonOverride({ convexJsonPath, outDir, externalPackages = HARNESS_EXTERNAL }) {
  const original = readFileSync(convexJsonPath, "utf8");
  const j = JSON.parse(original);
  if (j.functions === "convex-harness") return { changed: false, original: null }; // already overridden by a prior run
  const overridden = convexJsonOverrideObject(j, externalPackages);
  // Back up BEFORE touching the repo file, and create out/ first (it is
  // otherwise only created at the end of the run) so a failed backup can
  // never leave a modified convex.json without a restorable original.
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "convex.json.orig"), original);
  writeFileSync(convexJsonPath, JSON.stringify(overridden, null, 2) + "\n");
  return { changed: true, original };
}

// ------------------------------------------------------- deployment guard (iii)

/**
 * Identify the deployment `convex env set` would target: CONVEX_DEPLOYMENT
 * from the environment wins, else the .env.local value (quotes stripped),
 * else unknown.
 * @param {{ envValue?: string | undefined, envLocalContent?: string | null | undefined }} [opts]
 * @returns {SelectedDeployment}
 */
export function resolveSelectedDeployment({ envValue, envLocalContent } = {}) {
  if (envValue) {
    return { source: "environment", value: envValue };
  }
  if (envLocalContent) {
    const m = envLocalContent.match(/^CONVEX_DEPLOYMENT=(.+)$/m);
    if (m) return { source: ".env.local", value: m[1].trim().replace(/^["']|["']$/g, "") };
  }
  return { source: "unset", value: null };
}

/** @param {string | null | undefined} value @returns {URL} */
export function requireLoopbackUrl(value) {
  let url;
  try { url = new URL(value ?? ""); } catch { throw new Error("[backend] invalid local Convex URL"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("[backend] Convex URL must be an HTTP loopback origin with an explicit port");
  return url;
}

/** @param {string | null | undefined} convexUrl @returns {number} */
export function deploymentPortFromUrl(convexUrl) {
  return Number(requireLoopbackUrl(convexUrl).port);
}

/**
 * Match the pinned CLI's selected project-local anonymous backend, rather
 * than treating an unrelated listener on a guessed port as proof.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} opts
 * @returns {{ deployment: string, name: string, url: string }} `name` is what the backend reports at /instance_name
 */
export function selectedLocalBackend({ cwd, env }) {
  const selected = requireAnonymousStartup({ env });
  const config = JSON.parse(readFileSync(path.join(cwd, ".convex", "local", "default", "config.json"), "utf8"));
  const name = anonymousDeploymentName(config.deploymentName);
  const port = config.ports?.cloud;
  if (!name || !Number.isInteger(port) || port < 1 || port > 65535 ||
      (selected && anonymousDeploymentName(selected) !== name))
    throw new Error("[backend] selected deployment does not match local backend configuration");
  const url = `http://127.0.0.1:${port}`;
  for (const key of ["NEXT_PUBLIC_CONVEX_URL", "CONVEX_URL"]) {
    if (env[key] && requireLoopbackUrl(env[key]).origin !== url)
      throw new Error("[backend] Convex URL does not match selected local backend host and port");
  }
  return { deployment: `anonymous:${name}`, name, url };
}

/**
 * Decision core of the deployment guard: why the selected deployment cannot
 * be trusted with eval env vars. An empty array means safe to proceed.
 * @param {{ deployment: SelectedDeployment, backendAnswered: boolean, port: number }} opts
 * @returns {string[]}
 */
export function deploymentGuardProblems({ deployment, backendAnswered, port }) {
  const problems = [];
  if (!deployment.value) {
    problems.push("CONVEX_DEPLOYMENT is not set in the environment or .env.local, so the target deployment cannot be identified");
  } else if (!anonymousDeploymentName(deployment.value)) {
    problems.push(`CONVEX_DEPLOYMENT from ${deployment.source} is not an anonymous local deployment`);
  }
  if (!backendAnswered) {
    problems.push(`no local backend answered on 127.0.0.1:${port}`);
  }
  return problems;
}

/**
 * The script's refusal banner, byte-identical to the pre-extraction text.
 * @param {string[]} problems
 * @returns {string}
 */
export function deploymentRefusalMessage(problems) {
  return (
    "[backend] REFUSING to run 'convex env set': the selected deployment could not be verified as the local anonymous one:\n" +
    problems.map((p) => `  - ${p}`).join("\n") +
    "\n[backend] Eval env vars must never land on a shared or cloud backend. Start the local backend first (rerun this script) or fix CONVEX_DEPLOYMENT/.env.local."
  );
}

/**
 * Guard-then-set: eval env vars are written via envSet ONLY if the selected
 * deployment is the local anonymous backend AND a local backend answers. On
 * refusal envSet is never invoked (guard iii); the caller decides what the
 * process does (the script logs the banner and exits 1).
 * @param {{ deployment: SelectedDeployment | (() => SelectedDeployment), backendAnswered: boolean | (() => boolean), port: number, envSets: Array<{ name: string, value: string }>, envSet: (name: string, value: string) => void }} opts
 * @returns {{ ok: boolean, problems: string[], deployment: SelectedDeployment, port: number }}
 */
export function applyDeploymentEnv({ deployment, backendAnswered, port, envSets, envSet }) {
  const dep = typeof deployment === "function" ? deployment() : deployment;
  const answered = typeof backendAnswered === "function" ? backendAnswered() : Boolean(backendAnswered);
  const problems = deploymentGuardProblems({ deployment: dep, backendAnswered: answered, port });
  if (problems.length > 0) {
    return { ok: false, problems, deployment: dep, port };
  }
  for (const { name, value } of envSets) {
    envSet(name, value);
  }
  return { ok: true, problems, deployment: dep, port };
}

/**
 * The seeded shape the H-14 browser proof depends on, as returned by
 * `npx convex run devEval/shape:shape '{"meetingId":...}'`. Returns the list
 * of ways it differs from the seed; empty means the seed is exactly right.
 * A seed receipt (a returned meetingId) is not evidence of any of this.
 * @param {any} shape
 * @returns {string[]}
 */
export function seedShapeProblems(shape) {
  if (!shape || typeof shape !== "object") return ["shape query returned nothing"];
  if (shape.found !== true) return ["meeting not found"];
  const problems = [];
  const m = shape.meeting ?? {};
  if (m.state !== "active") problems.push(`meeting state is ${JSON.stringify(m.state)}, expected "active"`);
  if (m.organizerWorkosUserId !== "local-test-a") {
    problems.push(`organizer is ${JSON.stringify(m.organizerWorkosUserId)}, expected "local-test-a"`);
  }
  const role = (/** @type {string} */ subject) =>
    (shape.participants ?? []).filter((/** @type {any} */ p) => p.workosUserId === subject).map((/** @type {any} */ p) => p.role);
  const expected = { "local-test-a": "host", "local-test-b": "participant", "local-test-c": "participant" };
  for (const [subject, want] of Object.entries(expected)) {
    const got = role(subject);
    if (got.length !== 1 || got[0] !== want) problems.push(`${subject} participant rows ${JSON.stringify(got)}, expected ["${want}"]`);
  }
  if (role("local-test-o").length !== 0) problems.push("outsider local-test-o has a participant row");
  const users = new Set((shape.users ?? []).map((/** @type {any} */ u) => u.workosUserId));
  for (const subject of ["local-test-a", "local-test-b", "local-test-c", "local-test-o"]) {
    if (!users.has(subject)) problems.push(`user ${subject} missing`);
  }
  if (shape.meetingState?.active !== true) problems.push("meetingState is not active");
  return problems;
}

/** The only CLI 1.46 line that means a push finished. */
export const PUSH_COMPLETE_MARKER = "Convex functions ready!";

/** Single-quote a value for a bash script. @param {string} value */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Dispatch the optional frontend stage after backend provisioning and seeding.
 * @param {string[]} args
 * @param {() => Promise<void>} startNext
 * @returns {Promise<boolean>}
 */
export async function runNextRuntime(args, startNext) {
  if (args.includes("--no-next")) return false;
  await startNext();
  return true;
}
