// Guard tests for tools/call-eval/scripts/local-backend.mjs (S0 recon defects
// i–iii at parent bbc62fae, fixed at f06669f). Each test asserts the fixed
// invariant in a shape that FAILS on the pre-fix behavior:
//   (i)   allowlist accepts devEval/seed — the pre-fix allowlist lacked "devEval";
//   (ii)  the convex.json backup exists after the first modification even when
//         out/ is absent — pre-fix wrote the backup AFTER modifying and only
//         into out/ once it existed, so a missing out/ left a modified
//         convex.json with no restorable original;
//   (iii) a non-local deployment refuses BEFORE any `convex env set` call —
//         pre-fix ran env set unconditionally.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DUMMY_WORKOS_CLIENT_ID,
  EVAL_ENV_TEST_JWKS,
  EVAL_ENV_WORKOS_CLIENT_ID,
  HARNESS_EXTERNAL,
  applyConvexJsonOverride,
  applyDeploymentEnv,
  deploymentGuardProblems,
  deploymentPortFromUrl,
  deploymentRefusalMessage,
  isHarnessModulePath,
  isTestArtifactPath,
  pickConvexUrlFromEnvText,
  pruneTestArtifacts,
  resolveSelectedDeployment,
} from "./local-backend-core.mjs";

const TEST_JWKS_DATA_URI = "data:application/json;base64,eyJrZXlzIjpbXX0=";

/** @type {string[]} */
const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A throwaway repo stand-in: convex.json as committed, out/ NOT created.
 * @returns {{ dir: string, convexJsonPath: string, outDir: string }}
 */
function makeTmpRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "connvo-guard-"));
  tmpDirs.push(dir);
  const convexJsonPath = path.join(dir, "convex.json");
  writeFileSync(convexJsonPath, '{\n  "node": {\n    "18": true\n  }\n}\n');
  return { dir, convexJsonPath, outDir: path.join(dir, "out") };
}

describe("guard (i): harness allowlist accepts the devEval seed module", () => {
  it("accepts the CLI function path the orchestrator invokes (devEval/seed)", () => {
    expect(isHarnessModulePath("devEval/seed")).toBe(true);
    expect(isHarnessModulePath("devEval/seed:seed")).toBe(true);
  });

  it("accepts every module in the devEval directory (the tree copies it whole)", () => {
    expect(isHarnessModulePath("devEval/shape")).toBe(true);
  });

  it("keeps excluding modules outside the harness closure", () => {
    expect(isHarnessModulePath("embeddings/actions")).toBe(false);
    expect(isHarnessModulePath("prompts/foo")).toBe(false);
    expect(isHarnessModulePath("insights/foo")).toBe(false);
  });

  it("accepts the notes directory (the call/meeting closure imports it)", () => {
    expect(isHarnessModulePath("notes/foo")).toBe(true);
    expect(isHarnessModulePath("notes/bar")).toBe(true);
  });

  it("includes root-level function files (copied unconditionally by the tree builder)", () => {
    expect(isHarnessModulePath("schema")).toBe(true);
    expect(isHarnessModulePath("")).toBe(false);
  });
});

describe("operator fix 1: the deployment URL is read from what the CLI writes", () => {
  it("prefers NEXT_PUBLIC_CONVEX_URL when both spellings are present", () => {
    const text = "CONVEX_URL=http://127.0.0.1:1111\nNEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\n";
    expect(pickConvexUrlFromEnvText(text)).toEqual({
      source: "NEXT_PUBLIC_CONVEX_URL",
      value: "http://127.0.0.1:3210",
    });
  });

  it("falls back to legacy CONVEX_URL", () => {
    expect(pickConvexUrlFromEnvText("CONVEX_URL=http://127.0.0.1:3210\n")).toEqual({
      source: "CONVEX_URL",
      value: "http://127.0.0.1:3210",
    });
  });

  it("strips surrounding quotes and whitespace", () => {
    expect(pickConvexUrlFromEnvText(`NEXT_PUBLIC_CONVEX_URL='http://127.0.0.1:3210'\r\n`)).toEqual({
      source: "NEXT_PUBLIC_CONVEX_URL",
      value: "http://127.0.0.1:3210",
    });
  });

  it("returns null when neither variable is set and for non-string input", () => {
    expect(pickConvexUrlFromEnvText("OTHER=http://x\n")).toBe(null);
    expect(pickConvexUrlFromEnvText("# CONVEX_URL=commented-out\n")).toBe(null);
    expect(pickConvexUrlFromEnvText(null)).toBe(null);
    expect(pickConvexUrlFromEnvText(undefined)).toBe(null);
  });
});

describe("guard (ii): convex.json backup exists with the first modification", () => {
  it("backs up before modifying even when out/ is absent", () => {
    const t = makeTmpRepo();
    const original = readFileSync(t.convexJsonPath, "utf8");

    /** @type {{ changed: boolean, original: string | null } | undefined} */
    let result;
    expect(() => {
      result = applyConvexJsonOverride({ convexJsonPath: t.convexJsonPath, outDir: t.outDir });
    }).not.toThrow();

    // The repo file WAS modified (override applied)...
    const modified = JSON.parse(readFileSync(t.convexJsonPath, "utf8"));
    expect(modified.functions).toBe("convex-harness");
    expect(modified.node["18"]).toBe(true);
    expect(modified.node.externalPackages).toEqual(HARNESS_EXTERNAL);
    // The 1.28.0 CLI reads externalPackages; the legacy key must stay unset.
    expect(modified.node.externalDependencies).toBeUndefined();
    // ...and the backup of the original exists, byte-identical.
    expect(existsSync(path.join(t.outDir, "convex.json.orig"))).toBe(true);
    expect(readFileSync(path.join(t.outDir, "convex.json.orig"), "utf8")).toBe(original);
    expect(result?.changed).toBe(true);
    expect(result?.original).toBe(original);
  });

  it("is idempotent and never overwrites the backup with the overridden bytes", () => {
    const t = makeTmpRepo();
    const original = readFileSync(t.convexJsonPath, "utf8");
    applyConvexJsonOverride({ convexJsonPath: t.convexJsonPath, outDir: t.outDir });
    const afterFirst = readFileSync(t.convexJsonPath, "utf8");

    const second = applyConvexJsonOverride({ convexJsonPath: t.convexJsonPath, outDir: t.outDir });

    expect(second.changed).toBe(false);
    expect(second.original).toBe(null);
    expect(readFileSync(t.convexJsonPath, "utf8")).toBe(afterFirst);
    expect(readFileSync(path.join(t.outDir, "convex.json.orig"), "utf8")).toBe(original);
  });

  it("round-trips: writing the backup back restores the repo file", () => {
    const t = makeTmpRepo();
    const original = readFileSync(t.convexJsonPath, "utf8");
    applyConvexJsonOverride({ convexJsonPath: t.convexJsonPath, outDir: t.outDir });

    writeFileSync(t.convexJsonPath, readFileSync(path.join(t.outDir, "convex.json.orig"), "utf8"));

    expect(readFileSync(t.convexJsonPath, "utf8")).toBe(original);
  });
});

describe("guard (iii): eval env vars are set only for the verified local anonymous deployment", () => {
  const envSets = [
    { name: EVAL_ENV_WORKOS_CLIENT_ID, value: DUMMY_WORKOS_CLIENT_ID },
    { name: EVAL_ENV_TEST_JWKS, value: TEST_JWKS_DATA_URI },
  ];

  it("refuses a https cloud deployment and never invokes env set", () => {
    const envSet = vi.fn();
    const result = applyDeploymentEnv({
      deployment: { source: ".env.local", value: "https://graceful-crane-123.convex.cloud" },
      backendAnswered: () => true,
      port: 3210,
      envSets,
      envSet,
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("https://graceful-crane-123.convex.cloud");
    expect(result.problems.join("\n")).toContain("not an anonymous local deployment");
    expect(envSet).not.toHaveBeenCalled();
  });

  it("refuses a dev:-prefixed cloud deployment name (not just https URLs)", () => {
    const envSet = vi.fn();
    const result = applyDeploymentEnv({
      deployment: { source: "environment", value: "dev:fluffy-fox-123" },
      backendAnswered: () => true,
      port: 3210,
      envSets,
      envSet,
    });
    expect(result.ok).toBe(false);
    expect(envSet).not.toHaveBeenCalled();
  });

  it("refuses when no deployment can be identified", () => {
    const envSet = vi.fn();
    const result = applyDeploymentEnv({
      deployment: { source: "unset", value: null },
      backendAnswered: () => true,
      port: 3210,
      envSets,
      envSet,
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("CONVEX_DEPLOYMENT is not set");
    expect(envSet).not.toHaveBeenCalled();
  });

  it("refuses an anonymous deployment name when no local backend answers", () => {
    const envSet = vi.fn();
    const result = applyDeploymentEnv({
      deployment: { source: "environment", value: "anonymous:swift-hawk-999" },
      backendAnswered: () => false,
      port: 3210,
      envSets,
      envSet,
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("no local backend answered on 127.0.0.1:3210");
    expect(envSet).not.toHaveBeenCalled();
  });

  it("accepts both anonymous spellings and sets both env vars, in order", () => {
    for (const value of ["anonymous:swift-hawk-999", "anonymous-swift-hawk-999"]) {
      const envSet = vi.fn();
      const result = applyDeploymentEnv({
        deployment: { source: "environment", value },
        backendAnswered: () => true,
        port: 3210,
        envSets,
        envSet,
      });
      expect(result.ok).toBe(true);
      expect(envSet).toHaveBeenNthCalledWith(1, EVAL_ENV_WORKOS_CLIENT_ID, DUMMY_WORKOS_CLIENT_ID);
      expect(envSet).toHaveBeenNthCalledWith(2, EVAL_ENV_TEST_JWKS, TEST_JWKS_DATA_URI);
      expect(envSet).toHaveBeenCalledTimes(2);
    }
  });

  it("reports deployment problems before the port-probe problem", () => {
    const problems = deploymentGuardProblems({
      deployment: { source: "environment", value: "prod:very-much-cloud" },
      backendAnswered: false,
      port: 3210,
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("prod:very-much-cloud");
    expect(problems[1]).toContain("no local backend answered");
  });
});

describe("deployment selection and port parsing", () => {
  it("prefers the environment over .env.local and strips quotes from the file value", () => {
    expect(resolveSelectedDeployment({ envValue: "anonymous:env", envLocalContent: "CONVEX_DEPLOYMENT=dev:file\n" }))
      .toEqual({ source: "environment", value: "anonymous:env" });
    expect(resolveSelectedDeployment({ envLocalContent: 'CONVEX_DEPLOYMENT="anonymous:quoted"\n' }))
      .toEqual({ source: ".env.local", value: "anonymous:quoted" });
    expect(resolveSelectedDeployment({ envLocalContent: "OTHER=1\n" }))
      .toEqual({ source: "unset", value: null });
    expect(resolveSelectedDeployment({}))
      .toEqual({ source: "unset", value: null });
  });

  it("parses the backend port from the Convex URL, tolerating url~deployment", () => {
    expect(deploymentPortFromUrl("http://127.0.0.1:9901~anonymous:swift-hawk-999")).toBe(9901);
    expect(deploymentPortFromUrl("http://127.0.0.1:9901")).toBe(9901);
    expect(deploymentPortFromUrl(null)).toBe(3210);
    expect(deploymentPortFromUrl("not a url")).toBe(3210);
  });

  it("renders the refusal banner with every problem", () => {
    const msg = deploymentRefusalMessage(["p1", "p2"]);
    expect(msg).toContain("REFUSING to run 'convex env set'");
    expect(msg).toContain("  - p1");
    expect(msg).toContain("  - p2");
  });
});

// Guard (iv): test artifacts must never reach the pushed module tree. The
// CLI does not honor .convexignore when bundling an overridden functions
// dir, so exclusion happens at materialization time. Pre-fix behavior (no
// pruning) shipped convex-harness/types/__tests__/ciValidation.ts, which
// the backend executed during module loading — "Uncaught process.exit()
// called with exit code 1" -> InvalidModules, or the 300 s 408 loop when
// its inner npm/codegen subprocesses were slower.
describe("test-artifact pruning", () => {
  it("classifies test/development paths and real module paths", () => {
    // Must be pruned — the exact file that killed the backend's loader:
    expect(isTestArtifactPath("types/__tests__/ciValidation.ts")).toBe(true);
    expect(isTestArtifactPath("types/__tests__/ciValidation.test.ts")).toBe(true);
    expect(isTestArtifactPath("auth/guards.test.ts")).toBe(true);
    expect(isTestArtifactPath("users/onboarding.spec.ts")).toBe(true);
    expect(isTestArtifactPath("test/helpers.ts")).toBe(true);
    expect(isTestArtifactPath("__tests__/root.ts")).toBe(true);
    expect(isTestArtifactPath("vitest.config.ts")).toBe(true);
    // Must survive:
    expect(isTestArtifactPath("auth.config.ts")).toBe(false);
    expect(isTestArtifactPath("schema.ts")).toBe(false);
    expect(isTestArtifactPath("auth/guards.ts")).toBe(false);
    expect(isTestArtifactPath("lib/getstreamServer.ts")).toBe(false);
    expect(isTestArtifactPath("types/validators/index.ts")).toBe(false);
    expect(isTestArtifactPath("devEval/seed.ts")).toBe(false);
  });

  it("prunes test artifacts from a materialized tree and keeps every real module", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prune-fixture-"));
    tmpDirs.push(root);
    /** @param {string} rel */
    const touch = (rel) => {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, "// fixture\n");
    };
    // The pre-fix harness tree, reproduced: copied dirs carried __tests__/
    // wholesale (including ciValidation.ts), and *.test.ts files rode along.
    touch("types/__tests__/ciValidation.ts");
    touch("types/__tests__/functionTypeConsistency.test.ts");
    touch("types/validators/index.ts");
    touch("auth/guards.test.ts");
    touch("auth/guards.ts");
    touch("auth.config.ts");
    touch("schema.ts");
    touch("devEval/seed.ts");
    touch("vitest.config.ts");

    const removed = pruneTestArtifacts(root);
    expect(removed).toEqual(
      expect.arrayContaining([
        "types/__tests__",
        "auth/guards.test.ts",
        "vitest.config.ts",
      ]),
    );
    expect(existsSync(path.join(root, "types/__tests__/ciValidation.ts"))).toBe(false);
    expect(existsSync(path.join(root, "auth/guards.test.ts"))).toBe(false);
    expect(existsSync(path.join(root, "vitest.config.ts"))).toBe(false);
    // Every real module survives:
    expect(existsSync(path.join(root, "auth.config.ts"))).toBe(true);
    expect(existsSync(path.join(root, "schema.ts"))).toBe(true);
    expect(existsSync(path.join(root, "auth/guards.ts"))).toBe(true);
    expect(existsSync(path.join(root, "types/validators/index.ts"))).toBe(true);
    expect(existsSync(path.join(root, "devEval/seed.ts"))).toBe(true);
  });

  it("is idempotent: a second prune removes nothing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prune-idem-"));
    tmpDirs.push(root);
    const abs = path.join(root, "types/__tests__");
    mkdirSync(abs, { recursive: true });
    writeFileSync(path.join(abs, "ciValidation.ts"), "// fixture\n");
    writeFileSync(path.join(root, "schema.ts"), "// fixture\n");

    pruneTestArtifacts(root);
    const second = pruneTestArtifacts(root);
    expect(second).toEqual([]);
    expect(existsSync(path.join(root, "schema.ts"))).toBe(true);
  });
});
