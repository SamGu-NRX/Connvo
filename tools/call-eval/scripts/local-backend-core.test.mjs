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
import { spawnSync } from "node:child_process";
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
  seedShapeProblems,
  shellQuote,
  requireAnonymousStartup,
  createTmuxLauncher,
  checkedNextEnvironment,
} from "./local-backend-core.mjs";

const TEST_JWKS_DATA_URI = "data:application/json;base64,eyJrZXlzIjpbXX0=";

// Synthetic file contents only; no real env file is read.
describe("Next environment for the self-proof", () => {
  const caller = { HOME: "/synthetic-home", PATH: "/usr/bin", NODE_OPTIONS: "--require=synthetic-hook", BASH_ENV: "/synthetic/startup.sh" };

  it("refuses a cloud value in any file Next loads, even when the caller's loopback URL would shadow it", () => {
    const env = { ...caller, NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210" };
    for (const [index, text] of [
      [0, "NEXT_PUBLIC_CONVEX_URL=https://synthetic-cloud.convex.cloud\n"],
      [2, "CONVEX_URL=https://synthetic-cloud.convex.cloud\n"],
      [1, "CONVEX_DEPLOY_KEY=synthetic-file-key\n"],
      [3, "CONVEX_DEPLOYMENT=prod:synthetic-cloud\n"],
    ]) {
      /** @type {Array<string | null>} */
      const files = [null, null, null, null];
      files[/** @type {number} */ (index)] = /** @type {string} */ (text);
      expect(() => checkedNextEnvironment({ env, files })).toThrow();
    }
  });

  it("refuses loopback URLs in different files that name different origins", () => {
    expect(() => checkedNextEnvironment({
      env: caller, files: ["NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210/\n", null, "CONVEX_URL=http://127.0.0.1:3211\n", null],
    })).toThrow("conflicting Convex URL settings");
  });

  it("pins the validated origin in Next's environment and passes no hooks", () => {
    const result = checkedNextEnvironment({
      env: caller, files: [null, "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210/\nCONVEX_DEPLOYMENT=anonymous:anonymous-probe\n", null, null],
    });
    expect(result.NEXT_PUBLIC_CONVEX_URL).toBe("http://127.0.0.1:3210");
    expect(result.CONVEX_URL).toBe("http://127.0.0.1:3210");
    expect(result.CONVEX_DEPLOYMENT).toBe("anonymous:anonymous-probe");
    expect(result.CONVEX_DEPLOY_KEY).toBe("");
    expect(result.NODE_OPTIONS).toBeUndefined();
    expect(result.BASH_ENV).toBeUndefined();
    expect(result.HOME).toBe("/synthetic-home");
  });
});

describe("startup target before a pushing Convex command", () => {
  it("accepts new anonymous setup and the pinned CLI's explicit local names", () => {
    expect(requireAnonymousStartup({ env: {} })).toBeNull();
    expect(requireAnonymousStartup({ env: {}, envLocalContent: 'CONVEX_DEPLOYMENT="anonymous:anonymous-swift-hawk" # local\n' }))
      .toBe("anonymous:anonymous-swift-hawk");
    expect(requireAnonymousStartup({ env: { CONVEX_DEPLOYMENT: "anonymous-swift-hawk" } }))
      .toBe("anonymous-swift-hawk");
  });

  it.each(["anonymous-probe", "anonymous:anonymous-probe", "local:anonymous-probe"])(
    "uses the same anonymous name rule at startup and env-set: %s", (value) => {
      expect(requireAnonymousStartup({ env: { CONVEX_DEPLOYMENT: value } })).toBe(value);
      expect(applyDeploymentEnv({ deployment: { source: "environment", value },
        backendAnswered: true, port: 3210, envSets: [], envSet: () => {} }).ok).toBe(true);
    },
  );

  it.each(["anonymous:cloud-probe", "anonymous-cloud:probe", "local:cloud-probe", "prod:anonymous-probe"])(
    "refuses nonlocal or misleading selectors at both boundaries: %s", (value) => {
      expect(() => requireAnonymousStartup({ env: { CONVEX_DEPLOYMENT: value } })).toThrow();
      const result = applyDeploymentEnv({ deployment: { source: "environment", value },
        backendAnswered: true, port: 3210, envSets: [], envSet: () => {} });
      expect(result.ok).toBe(false);
      expect(result.problems.join(" ")).not.toContain(value);
    },
  );

  it("refuses inherited cloud selection even with anonymous agent mode", () => {
    expect(() => requireAnonymousStartup({ env: { CONVEX_AGENT_MODE: "anonymous", CONVEX_DEPLOYMENT: "dev:shared-cloud" } }))
      .toThrow("CONVEX_DEPLOYMENT is not an anonymous local target");
  });

  it("refuses cloud selection in either default env file", () => {
    for (const file of ["envLocalContent", "envContent"]) {
      expect(() => requireAnonymousStartup({ env: {}, [file]: 'export CONVEX_DEPLOYMENT = "prod:shared-cloud" # selected\n' }))
        .toThrow("CONVEX_DEPLOYMENT is not an anonymous local target");
    }
  });

  it("applies the CLI's process, local-file, default-file precedence", () => {
    expect(requireAnonymousStartup({
      env: { CONVEX_DEPLOYMENT: "anonymous:anonymous-process" },
      envLocalContent: "CONVEX_DEPLOYMENT=dev:shared-cloud",
      envContent: "CONVEX_DEPLOYMENT=prod:shared-cloud",
    })).toBe("anonymous:anonymous-process");
    expect(requireAnonymousStartup({
      env: {},
      envLocalContent: "CONVEX_DEPLOYMENT=anonymous:anonymous-local",
      envContent: "CONVEX_DEPLOYMENT=prod:shared-cloud",
    })).toBe("anonymous:anonymous-local");
  });

  it("refuses credential and self-hosted selectors without disclosing values", () => {
    for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"]) {
      for (const opts of [
        { env: { [key]: "synthetic-private-value" } },
        { env: {}, envLocalContent: `${key}="synthetic-private-value"` },
        { env: {}, envContent: `${key}="synthetic-private-value"` },
      ]) {
        expect(() => requireAnonymousStartup(opts)).toThrowError(
          new Error(`[backend] REFUSING to start convex dev: ${key} selects or authenticates a non-anonymous deployment`),
        );
      }
    }
  });

  it("does not mistake an anonymous type prefix for an anonymous deployment name", () => {
    expect(() => requireAnonymousStartup({ env: { CONVEX_DEPLOYMENT: "anonymous:shared-cloud" } }))
      .toThrow("CONVEX_DEPLOYMENT is not an anonymous local target");
  });
});

/** @type {string[]} */
const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("tmux launcher environment", () => {
  it("drops an existing server's cloud selectors and shell startup file", async ({ skip }) => {
    const tmuxError = spawnSync("tmux", ["-V"]).error;
    if (tmuxError && "code" in tmuxError && tmuxError.code === "ENOENT") {
      skip("tmux is not on PATH; this integration test requires an isolated tmux server");
    }
    const dir = mkdtempSync(path.join(tmpdir(), "connvo-launcher-"));
    tmpDirs.push(dir);
    const cwd = path.join(dir, "checkout with spaces");
    mkdirSync(cwd);
    const socket = path.join(dir, "server.sock");
    const probe = path.join(dir, "probe.mjs");
    const startup = path.join(dir, "shell-startup.sh");
    writeFileSync(startup, "export CONVEX_DEPLOY_KEY=synthetic-startup-key\n");
    writeFileSync(probe, `
      import { writeFileSync, realpathSync } from 'node:fs';
      const keys = ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'];
      writeFileSync(process.argv[2], JSON.stringify({
        serverSelectorsPresent: keys.every(key => Boolean(process.env[key])),
        credentialsEmpty: keys.every(key => !process.env[key]),
        callerSelectionPreserved: process.env.CONVEX_DEPLOYMENT === 'anonymous:anonymous-caller',
        callerEmptyKeyPreserved: process.env.CONVEX_DEPLOY_KEY === '',
        evalModePreserved: process.env.CONVEX_AGENT_MODE === 'anonymous',
        shellStartupAbsent: process.env.BASH_ENV === undefined,
        cwdPreserved: process.cwd() === realpathSync(${JSON.stringify(cwd)}),
      }));
    `);
    // Only synthetic selectors enter this isolated server. Every pane runs
    // the local JSON probe above; neither Convex nor the backend driver runs.
    const serverEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CONVEX_DEPLOYMENT: "prod:synthetic-cloud",
      CONVEX_DEPLOY_KEY: "synthetic-server-key",
      CONVEX_DEPLOYMENT_TOKEN: "synthetic-server-token",
      CONVEX_SELF_HOSTED_URL: "https://synthetic.invalid",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "synthetic-server-admin",
      BASH_ENV: startup,
    };
    /** @param {string[]} args */
    const tmux = (args) => spawnSync("tmux", ["-S", socket, "-f", "/dev/null", ...args], { env: serverEnv });
    /** @param {string} file */
    const readProbe = (file) => vi.waitFor(() => JSON.parse(readFileSync(file, "utf8")));
    try {
      expect(tmux(["new-session", "-d", "-s", "keeper", "--", "/bin/sleep", "30"]).status).toBe(0);
      const before = path.join(dir, "before.json");
      expect(tmux(["new-session", "-d", "-s", "before", "--", process.execPath, probe, before]).status).toBe(0);
      const inherited = await readProbe(before);
      expect(inherited.serverSelectorsPresent).toBe(true);
      expect(inherited.shellStartupAbsent).toBe(false);

      for (const emptyKey of [false, true]) {
        const file = path.join(cwd, `launcher ${emptyKey}.sh`);
        const output = path.join(dir, `after-${emptyKey}.json`);
        const launcher = createTmuxLauncher({
          session: `after-${emptyKey}`, file, cwd,
          callerEnv: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            CONVEX_DEPLOYMENT: "anonymous:anonymous-caller",
            ...(emptyKey ? { CONVEX_DEPLOY_KEY: "" } : {}),
          },
          env: { CONVEX_AGENT_MODE: "anonymous" },
          command: `${shellQuote(process.execPath)} ${shellQuote(probe)} ${shellQuote(output)}`,
        });
        if (launcher.script === null) throw new Error("Expected a shell launcher script");
        writeFileSync(file, launcher.script, { mode: 0o700 });
        expect(tmux(launcher.args).status).toBe(0);
        expect(await readProbe(output)).toEqual({
          serverSelectorsPresent: false,
          credentialsEmpty: true,
          callerSelectionPreserved: true,
          callerEmptyKeyPreserved: emptyKey,
          evalModePreserved: true,
          shellStartupAbsent: true,
          cwdPreserved: true,
        });
      }
    } finally {
      tmux(["kill-server"]);
    }
  });

  it("refuses unsafe caller settings or launcher overrides before writing a script", () => {
    const safe = {
      session: "probe", file: "/tmp/probe.sh", cwd: "/tmp", command: "true",
      callerEnv: { CONVEX_DEPLOYMENT: "anonymous:anonymous-caller" }, env: {},
    };
    expect(() => createTmuxLauncher({ ...safe, callerEnv: { CONVEX_DEPLOY_KEY: "synthetic-key" } }))
      .toThrow("CONVEX_DEPLOY_KEY selects or authenticates a non-anonymous deployment");
    expect(() => createTmuxLauncher({ ...safe, env: { CONVEX_DEPLOYMENT: "prod:synthetic-cloud" } }))
      .toThrow("CONVEX_DEPLOYMENT is not an anonymous local target");
    expect(createTmuxLauncher(safe).args.slice(4)).toEqual([
      "--", "/usr/bin/env", "-i", "/bin/bash", "--noprofile", "--norc", "/tmp/probe.sh",
    ]);
  });
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
    expect(isHarnessModulePath("insights/foo")).toBe(false);
  });

  it("includes live prompts in the call closure", () => {
    expect(isHarnessModulePath("prompts/live:pick")).toBe(true);
    expect(isHarnessModulePath("prompts/selection")).toBe(true);
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
  it("rejects conflicting URL spellings", () => {
    const text = "CONVEX_URL=http://127.0.0.1:1111\nNEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\n";
    expect(() => pickConvexUrlFromEnvText(text)).toThrow("conflicting Convex URL settings");
  });

  it("treats a trailing slash as the same origin, not a conflict", () => {
    expect(pickConvexUrlFromEnvText("CONVEX_URL=http://127.0.0.1:3210/\nNEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\n")).toEqual({
      source: "NEXT_PUBLIC_CONVEX_URL",
      value: "http://127.0.0.1:3210",
    });
    expect(() => requireAnonymousStartup({ env: { CONVEX_URL: "http://127.0.0.1:3210/", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3211" } }))
      .toThrow("conflicting Convex URL settings");
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
    expect(result.problems.join("\n")).not.toContain("https://graceful-crane-123.convex.cloud");
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
      deployment: { source: "environment", value: "anonymous:anonymous-swift-hawk-999" },
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
    for (const value of ["anonymous:anonymous-swift-hawk-999", "anonymous-swift-hawk-999"]) {
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
    expect(problems[0]).toContain("not an anonymous local deployment");
    expect(problems[0]).not.toContain("prod:very-much-cloud");
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

  it("accepts explicit loopback ports and refuses cloud or malformed URLs", () => {
    expect(() => deploymentPortFromUrl("http://127.0.0.1:9901~anonymous:swift-hawk-999")).toThrow();
    expect(deploymentPortFromUrl("http://127.0.0.1:9901")).toBe(9901);
    expect(() => deploymentPortFromUrl("https://synthetic-cloud.convex.cloud")).toThrow();
    expect(() => deploymentPortFromUrl(null)).toThrow();
    expect(() => deploymentPortFromUrl("not a url")).toThrow();
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

describe("seed shape check (H-14 depends on it)", () => {
  // Known input: the exact shape devEval/seed creates.
  const good = () => ({
    found: true,
    meeting: { title: "Eval harness smoke meeting", state: "active", organizerWorkosUserId: "local-test-a" },
    users: ["a", "b", "c", "o"].map((k) => ({ workosUserId: `local-test-${k}` })),
    participants: [
      { workosUserId: "local-test-a", role: "host" },
      { workosUserId: "local-test-b", role: "participant" },
      { workosUserId: "local-test-c", role: "participant" },
    ],
    meetingState: { active: true },
  });

  it("accepts the seeded shape", () => {
    expect(seedShapeProblems(good())).toEqual([]);
  });

  it("rejects a missing meeting and an empty result", () => {
    expect(seedShapeProblems(null)).toEqual(["shape query returned nothing"]);
    expect(seedShapeProblems({ found: false })).toEqual(["meeting not found"]);
  });

  it("rejects the outsider holding a participant row", () => {
    const s = good();
    s.participants.push({ workosUserId: "local-test-o", role: "participant" });
    expect(seedShapeProblems(s)).toEqual(["outsider local-test-o has a participant row"]);
  });

  it("rejects a wrong organizer, a wrong role, an inactive meeting and a missing user", () => {
    const s = good();
    s.meeting.organizerWorkosUserId = "local-test-b";
    s.participants[1].role = "host";
    s.meeting.state = "scheduled";
    s.users = s.users.filter((u) => u.workosUserId !== "local-test-c");
    expect(seedShapeProblems(s)).toEqual([
      'meeting state is "scheduled", expected "active"',
      'organizer is "local-test-b", expected "local-test-a"',
      'local-test-b participant rows ["host"], expected ["participant"]',
      "user local-test-c missing",
    ]);
  });

  it("rejects a seed receipt in place of the shape", () => {
    expect(seedShapeProblems({ meetingId: "m1" })).toEqual(["meeting not found"]);
  });
});

describe("shellQuote", () => {
  it("survives quotes and spaces in values", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
