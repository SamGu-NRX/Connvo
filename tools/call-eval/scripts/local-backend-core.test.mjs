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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(isHarnessModulePath("notes/foo")).toBe(false);
    expect(isHarnessModulePath("prompts/foo")).toBe(false);
    expect(isHarnessModulePath("insights/foo")).toBe(false);
  });

  it("includes root-level function files (copied unconditionally by the tree builder)", () => {
    expect(isHarnessModulePath("schema")).toBe(true);
    expect(isHarnessModulePath("")).toBe(false);
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
    expect(modified.node.externalDependencies).toEqual(HARNESS_EXTERNAL);
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
