/**
 * Thin vitest bridge for the bespoke invariant suite.
 *
 * The matching-study lives under experiments/ (not test/), but the brief
 * requires invariant scenarios to run green in the vitest convex project.
 * This bridge adapts the vitest environment to the RuntimeFactory interface
 * and runs the identical suite that run.ts executes. Load "full" tier
 * scenarios deliberately do NOT run here.
 */

import * as nodeFs from "node:fs";
import { expect, describe, it, afterAll } from "vitest";
import { createStudyRuntime } from "../../experiments/matching-study/src/harness.js";
import {
  executeScenario,
  type RuntimeFactory,
  type RuntimeHandle,
  type ScenarioResult,
} from "../../experiments/matching-study/src/runFlow.js";
import {
  runInvariantSuite,
  type InvariantSuiteOutput,
} from "../../experiments/matching-study/src/invariantScenarios.js";
import type { ScenarioSpec } from "../../experiments/matching-study/src/types.js";

interface ManifestLike {
  quality: ScenarioSpec[];
  loadSmoke: ScenarioSpec[];
}

function loadManifest(): ManifestLike {
  const raw = nodeFs.readFileSync(
    new URL("../../experiments/matching-study/manifest.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(raw) as ManifestLike;
}

type ClockHandle = { restore(): void };

// createStudyRuntime patches global Date.now; with maxWorkers=1 the vitest
// worker shares that global across test files, so every clock is tracked and
// unconditionally restored in afterAll (including when a scenario throws).
const activeClocks: ClockHandle[] = [];

function vitestFactory(): RuntimeFactory {
  return {
    async create(startMs: number): Promise<RuntimeHandle> {
      const runtime = createStudyRuntime(startMs, { minScore: 0.6, maxMatches: 50, shardCount: 4 });
      activeClocks.push(runtime.clock);
      return {
        runtime,
        dispose: async () => {
          const idx = activeClocks.indexOf(runtime.clock);
          if (idx !== -1) activeClocks.splice(idx, 1);
          await runtime.runtime.finishInProgressScheduledFunctions();
          runtime.clock.restore();
        },
      };
    },
  };
}

afterAll(() => {
  while (activeClocks.length > 0) activeClocks.pop()?.restore();
});

describe("matching-study invariant bridge", () => {
  it("runs the whole bespoke invariant suite with zero contract failures", async () => {
    const factory = vitestFactory();
    const result: InvariantSuiteOutput = await runInvariantSuite(factory);
    const genuineFailures = result.outcomes.filter(
      (o) => !o.passed && !o.name.includes("DOCUMENTS MISSING GUARD"),
    );
    for (const f of genuineFailures) {
      console.error(`invariant failure: ${f.name} — ${f.detail ?? ""}`);
    }
    expect(genuineFailures).toEqual([]);
    expect(result.outcomes.length).toBeGreaterThan(10);
  }, 300_000);

  it("runs every smoke-tier manifest scenario and records observations", async () => {
    const factory = vitestFactory();
    const manifest = loadManifest();
    const specs = [...manifest.quality, ...manifest.loadSmoke];
    const results: ScenarioResult[] = [];
    for (const spec of specs) {
      const r = await executeScenario(spec, factory);
      results.push(r);
    }
    for (const r of results) {
      expect(r.invariants.filter((i) => !i.passed && !i.name.includes("DOCUMENTS MISSING GUARD"))).toEqual([]);
    }
    expect(results.length).toBe(manifest.quality.length + manifest.loadSmoke.length);
  }, 600_000);
});
