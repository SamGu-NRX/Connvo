// Pure decision logic for local-backend.mjs, extracted so the three S0 guard
// fixes are unit-testable (the script itself is a side-effecting CLI: importing
// it runs the whole bring-up). Behavior moved here is unchanged; the script
// wires real I/O (fs, sh, curl) into these functions. Tests:
// tools/call-eval/scripts/local-backend-core.test.mjs — each test asserts an
// invariant that fails on the pre-fix behavior (recon dossier section 2,
// defects i–iii at parent bbc62fae, fixed at f06669f).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  "devEval", // eval seed mutation (devEval/seed) invoked in step 4/6
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
 * Pure override computation: functions dir switched to convex-harness/, node
 * runtime pinned to 18 with the heavy packages externalized (resolved from
 * node_modules instead of bundled into the push).
 * @param {Record<string, any>} parsed convex.json contents
 * @param {string[]} [externalDependencies]
 * @returns {Record<string, any>}
 */
export function convexJsonOverrideObject(parsed, externalDependencies = HARNESS_EXTERNAL) {
  return {
    ...parsed,
    functions: "convex-harness",
    node: { ...(parsed.node ?? {}), "18": true, externalDependencies },
  };
}

/**
 * Override convex.json for the lifetime of the local deployment, with the
 * backup written BEFORE the repo file is touched (guard ii). Creates outDir
 * first, so a failed backup can never leave a modified convex.json without a
 * restorable original.
 * @param {{ convexJsonPath: string, outDir: string, externalDependencies?: string[] }} opts
 * @returns {{ changed: boolean, original: string | null }}
 */
export function applyConvexJsonOverride({ convexJsonPath, outDir, externalDependencies = HARNESS_EXTERNAL }) {
  const original = readFileSync(convexJsonPath, "utf8");
  const j = JSON.parse(original);
  if (j.functions === "convex-harness") return { changed: false, original: null }; // already overridden by a prior run
  const overridden = convexJsonOverrideObject(j, externalDependencies);
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

/**
 * Local backend HTTP port from a Convex URL ("url~deployment" tolerated),
 * falling back to the backend's default port.
 * @param {string | null | undefined} convexUrl
 * @param {number} [fallback]
 * @returns {number}
 */
export function deploymentPortFromUrl(convexUrl, fallback = 3210) {
  try {
    return Number(new URL((convexUrl ?? `http://127.0.0.1:${fallback}`).split("~")[0]).port) || fallback;
  } catch {
    return fallback;
  }
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
  } else if (!deployment.value.startsWith("anonymous")) {
    // Anonymous deployments are the local backend's own (CLI versions spell
    // the prefix "anonymous:" or "anonymous-"); anything else can be a cloud
    // deployment the CLI would write eval env vars into.
    problems.push(`CONVEX_DEPLOYMENT from ${deployment.source} is "${deployment.value}", not an anonymous local deployment`);
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
