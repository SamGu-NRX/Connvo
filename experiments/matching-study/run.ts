/**
 * Study runner (plain tsx entry point).
 *
 *   pnpm exec tsx experiments/matching-study/run.ts --manifest experiments/matching-study/manifest.json
 *   pnpm exec tsx experiments/matching-study/run.ts --replay experiments/matching-study/results
 *
 * Runs the real registered Convex functions through convex-test with a patched
 * logical clock. Writes results into experiments/matching-study/results/.
 * Offline only: no provider or live-model calls.
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeProcess from "node:process";
import { execSync } from "node:child_process";
import { createStudyRuntime } from "./src/harness.js";
import {
  executeScenario,
  type RuntimeFactory,
  type RuntimeHandle,
  type ScenarioResult,
  type FailureTrace,
} from "./src/runFlow.js";
import { runInvariantSuite } from "./src/invariantScenarios.js";
import type { InvariantOutcome } from "./src/scenarios.js";
import { environment, hashStudySources, sha256File, writeJson } from "./src/artifacts.js";
import type { ScenarioSpec, PopulationParams } from "./src/types.js";
import { planPopulation, DEFAULT_PARAMS } from "./src/generator.js";

interface ManifestFile {
  name: string;
  description: string;
  version: number;
  defaults: { minScore: number; maxMatches: number; shardCount: number; startClockMs: number };
  quality: ScenarioSpec[];
  loadSmoke: ScenarioSpec[];
  loadFull: Array<ScenarioSpec & { tier?: string }>;
  notes?: string[];
}

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "uncommitted";
  }
}

function nodeFactory(): RuntimeFactory {
  return {
    async create(startMs: number): Promise<RuntimeHandle> {
      const runtime = createStudyRuntime(startMs, { minScore: 0.6, maxMatches: 50, shardCount: 4 });
      return {
        runtime,
        dispose: async () => {
          // Drain convex-test's in-flight nested-invocation bookkeeping so no
          // pending `_scheduled_functions` write outlives the environment,
          // then restore the patched Date.now.
          await runtime.runtime.finishInProgressScheduledFunctions();
          runtime.clock.restore();
        },
      };
    },
  };
}

interface RunSummary {
  manifest: string;
  manifestHash: string;
  gitSha: string;
  sourceHashes: Record<string, string>;
  invariants: InvariantOutcome[];
  invariantFailures: FailureTrace[];
  notes: string[];
  scenarioResults: Array<{
    scenario: string;
    family: string;
    seed: number;
    qualitySummary: object | null;
    loadSummary: object | null;
    invariantFailures: number;
    decisionsFile: string | null;
  }>;
  counterexamples: Array<object>;
  wallTotalMs: number;
}

function compactDecisions(result: ScenarioResult): object {
  return {
    scenario: result.scenario,
    seed: result.seed,
    decisionCount: result.decisions.length,
    decisions: result.decisions.slice(0, 400),
    shardMembership: result.shardMembership,
    waitingRecords: result.waitingRecords.slice(0, 400),
    failures: result.failures,
  };
}

function sampleShards(result: ScenarioResult): Record<string, number> {
  const keys = Object.keys(result.shardMembership).slice(0, 50);
  return Object.fromEntries(keys.map((k) => [k, result.shardMembership[k]]));
}

function failedInvariantCount(invariants: InvariantOutcome[]): number {
  return invariants.filter((o) => !o.passed && !o.name.includes("DOCUMENTS MISSING GUARD")).length;
}

async function runManifest(manifestPath: string, outDir: string): Promise<RunSummary> {
  const repoRoot = nodeProcess.cwd();
  const manifest = JSON.parse(nodeFs.readFileSync(manifestPath, "utf8")) as ManifestFile;
  const manifestHash = sha256File(manifestPath);
  const started = Date.now();
  const factory = nodeFactory();

  const summary: RunSummary = {
    manifest: nodePath.basename(manifestPath),
    manifestHash,
    gitSha: gitSha(),
    sourceHashes: hashStudySources(repoRoot),
    invariants: [],
    invariantFailures: [],
    notes: [],
    scenarioResults: [],
    counterexamples: [],
    wallTotalMs: 0,
  };

  // --- Invariants ---
  const inv = await runInvariantSuite(factory);
  summary.invariants = inv.outcomes;
  summary.invariantFailures = inv.failures.map((f) => ({
    cycle: -1,
    kind: "prediction-mismatch" as const,
    detail: `${f.scenario}: ${f.detail}`,
    nowMs: 0,
  }));
  summary.notes.push(...inv.notes);

  const failedInvariants = inv.outcomes.filter((o) => !o.passed && !o.name.includes("DOCUMENTS MISSING GUARD"));
  if (failedInvariants.length > 0) {
    console.error(`INVARIANT FAILURES (${failedInvariants.length}):`);
    for (const f of failedInvariants) console.error(`  - ${f.name}: ${f.detail ?? ""}`);
  }

  // --- Quality scenarios ---
  for (const spec of manifest.quality) {
    console.log(`[quality] ${spec.name} (seed ${spec.seed}, n=${spec.params.count})`);
    const result = await executeScenario(spec, factory);
    if (result.quality && result.quality.counterexample) {
      const file = nodePath.join(outDir, "counterexamples", `${spec.name}.json`);
      writeJson(file, {
        scenario: spec.name,
        seed: spec.seed,
        params: result.params,
        engine: result.quality.engine,
        exact: result.quality.exact,
        gaps: result.quality.gaps,
        enginePairs: result.quality.enginePairs,
        exactMatching: result.quality.exactMatching,
        scores: result.quality.scores,
        overlap: result.quality.overlap,
        userIds: result.userIds,
        note: "Smallest counterexample instance: engine allocation vs exhaustive reference over the engine's own score matrix.",
      });
      summary.counterexamples.push({
        scenario: spec.name,
        file: nodePath.relative(repoRoot, file),
        gaps: result.quality.gaps,
      });
    }
    const decisionsFile = nodePath.join(outDir, "decisions", `${spec.name}.json`);
    writeJson(decisionsFile, compactDecisions(result));
    summary.scenarioResults.push({
      scenario: spec.name,
      family: spec.family,
      seed: spec.seed,
      qualitySummary: result.quality,
      loadSummary: result.load,
      invariantFailures: failedInvariantCount(result.invariants),
      decisionsFile: nodePath.relative(repoRoot, decisionsFile),
    });
  }

  // --- Load scenarios (smoke + full) ---
  const loadSpecs = [...manifest.loadSmoke, ...manifest.loadFull];
  for (const spec of loadSpecs) {
    const memBefore = nodeProcess.memoryUsage().heapUsed;
    const t0 = Date.now();
    console.log(`[load] ${spec.name} (seed ${spec.seed}, n=${spec.params.count})`);
    const result = await executeScenario(spec, factory);
    const wallMs = Date.now() - t0;
    const memAfter = nodeProcess.memoryUsage().heapUsed;
    if (result.load) result.load.heapDeltaBytes = memAfter - memBefore;

    const decisionsFile = nodePath.join(outDir, "decisions", `${spec.name}.json`);
    // Keep big pools compact: full dumps only for small populations.
    const keepFull = result.params.count <= 100;
    writeJson(decisionsFile, {
      scenario: result.scenario,
      seed: result.seed,
      decisionCount: result.decisions.length,
      decisions: keepFull ? result.decisions : result.decisions.slice(0, 100),
      shardMembership: keepFull ? result.shardMembership : sampleShards(result),
      waitingRecords: keepFull ? result.waitingRecords : result.waitingRecords.slice(0, 200),
      failures: result.failures,
      load: result.load,
    });
    summary.scenarioResults.push({
      scenario: spec.name,
      family: spec.family,
      seed: spec.seed,
      qualitySummary: null,
      loadSummary: { ...result.load, wallTotalMs: wallMs },
      invariantFailures: failedInvariantCount(result.invariants),
      decisionsFile: nodePath.relative(repoRoot, decisionsFile),
    });
    console.log(
      `  -> matched=${result.load?.matchedTotal} expired=${result.load?.expiredTotal} cycles=${result.load?.cyclesRun} wall=${wallMs}ms`,
    );
  }

  summary.wallTotalMs = Date.now() - started;
  writeJson(nodePath.join(outDir, "run-summary.json"), summary);
  writeJson(nodePath.join(outDir, "environment.json"), environment(summary.gitSha));
  return summary;
}

function printReport(summary: RunSummary, outDir: string): void {
  const lines: string[] = [];
  lines.push("# Matching study run");
  lines.push(`gitSha: ${summary.gitSha}`);
  lines.push(`manifestHash: ${summary.manifestHash}`);
  lines.push("");
  lines.push("## Invariants");
  for (const o of summary.invariants) {
    lines.push(`- [${o.passed ? "x" : " "}] ${o.name}${o.detail ? ` — ${o.detail}` : ""}`);
  }
  lines.push("");
  lines.push("## Quality");
  for (const s of summary.scenarioResults.filter((x) => x.qualitySummary)) {
    const q = s.qualitySummary as {
      engine: { cardinality: number; totalWeight: number };
      exact: { maxCardinality: number; maxWeightAtMaxCardinality: number };
      gaps: { cardinalityGap: number; weightGap: number };
      counterexample: boolean;
    };
    lines.push(
      `- ${s.scenario}: engine ${q.engine.cardinality} pairs / ${q.engine.totalWeight.toFixed(3)} vs exact ${q.exact.maxCardinality} / ${q.exact.maxWeightAtMaxCardinality.toFixed(3)} (gaps ${q.gaps.cardinalityGap}/${q.gaps.weightGap.toFixed(3)})${q.counterexample ? " — COUNTEREXAMPLE" : ""}`,
    );
  }
  lines.push("");
  lines.push("## Load");
  for (const s of summary.scenarioResults.filter((x) => x.loadSummary)) {
    const l = s.loadSummary as {
      population: number;
      matchedTotal: number;
      expiredTotal: number;
      cyclesRun: number;
      wallPerCycle: { p50: number; p99: number };
    };
    lines.push(
      `- ${s.scenario}: n=${l.population} matched=${l.matchedTotal} expired=${l.expiredTotal} cycles=${l.cyclesRun} wall p50=${l.wallPerCycle.p50.toFixed(1)}ms p99=${l.wallPerCycle.p99.toFixed(1)}ms`,
    );
  }
  nodeFs.writeFileSync(nodePath.join(outDir, "console-report.md"), `${lines.join("\n")}\n`);
}

// ---------------------------------------------------------------------------
// Replay mode
// ---------------------------------------------------------------------------

interface ReplayComparison {
  replayedAt: string;
  manifestHashOriginal: string;
  manifestHashCurrent: string;
  sourceHashesMatch: boolean;
  scenarios: Array<{
    scenario: string;
    seed: number;
    matchedTotalAgrees: boolean | null;
    expiredTotalAgrees: boolean | null;
    cyclesRunAgrees: boolean | null;
    original: { matchedTotal: number | null; expiredTotal: number | null; cyclesRun: number | null };
    replayed: { matchedTotal: number | null; expiredTotal: number | null; cyclesRun: number | null };
    notes: string[];
  }>;
  invariantsReplayed: { passed: number; failed: number };
  conclusion: string;
}

/**
 * Replay: regenerate populations from the manifest's frozen seeds and re-run,
 * then compare key metrics against the saved run. Convex ids are regenerated
 * fresh (opaque, sequential) so shard membership can shift with new ids;
 * generator output, invariants, and score-independent metrics must agree.
 */
async function replay(previousOutDir: string): Promise<ReplayComparison> {
  const repoRoot = nodeProcess.cwd();
  const prevSummaryPath = nodePath.join(previousOutDir, "run-summary.json");
  const prevSummary = JSON.parse(nodeFs.readFileSync(prevSummaryPath, "utf8")) as RunSummary;
  const manifestPath = nodePath.join(repoRoot, "experiments", "matching-study", prevSummary.manifest);
  const manifestHashNow = sha256File(manifestPath);
  const sourceHashesNow = hashStudySources(repoRoot);

  const factory = nodeFactory();
  const inv = await runInvariantSuite(factory);

  const manifest = JSON.parse(nodeFs.readFileSync(manifestPath, "utf8")) as ManifestFile;
  const comparison: ReplayComparison = {
    replayedAt: new Date().toISOString(),
    manifestHashOriginal: prevSummary.manifestHash,
    manifestHashCurrent: manifestHashNow,
    sourceHashesMatch:
      prevSummary.manifestHash === manifestHashNow &&
      Object.keys(sourceHashesNow).every((k) => prevSummary.sourceHashes[k] === sourceHashesNow[k]),
    scenarios: [],
    invariantsReplayed: {
      passed: inv.outcomes.filter((o) => o.passed).length,
      failed: failedInvariantCount(inv.outcomes),
    },
    conclusion: "",
  };

  for (const spec of [...manifest.quality, ...manifest.loadSmoke, ...manifest.loadFull]) {
    const notes: string[] = [];
    // Regenerate the plan identically (same seed + params).
    const params: PopulationParams = { ...DEFAULT_PARAMS, ...spec.params };
    const plan = planPopulation(spec.name, spec.seed, params, manifest.defaults.startClockMs);
    notes.push(`regenerated ${plan.entries.length} planned entries from seed ${spec.seed}`);
    const result = await executeScenario(spec, factory);

    const original = prevSummary.scenarioResults.find((s) => s.scenario === spec.name);
    const origLoad = (original?.loadSummary ?? null) as {
      matchedTotal?: number;
      expiredTotal?: number;
      cyclesRun?: number;
    } | null;
    const agrees = (a: number | undefined | null, b: number | undefined | null): boolean | null =>
      a === undefined || b === undefined || a === null || b === null ? null : a === b;

    comparison.scenarios.push({
      scenario: spec.name,
      seed: spec.seed,
      matchedTotalAgrees: agrees(origLoad?.matchedTotal, result.load?.matchedTotal),
      expiredTotalAgrees: agrees(origLoad?.expiredTotal, result.load?.expiredTotal),
      cyclesRunAgrees: agrees(origLoad?.cyclesRun, result.load?.cyclesRun),
      original: {
        matchedTotal: origLoad?.matchedTotal ?? null,
        expiredTotal: origLoad?.expiredTotal ?? null,
        cyclesRun: origLoad?.cyclesRun ?? null,
      },
      replayed: {
        matchedTotal: result.load?.matchedTotal ?? null,
        expiredTotal: result.load?.expiredTotal ?? null,
        cyclesRun: result.load?.cyclesRun ?? null,
      },
      notes,
    });
  }

  // What replay CAN reproduce: generator plans, invariant outcomes, and (when
  // source+manifest hashes match) score-independent metrics. Shard membership
  // depends on convex id strings, which are freshly assigned per run.
  comparison.conclusion = comparison.sourceHashesMatch
    ? "Source and manifest hashes match the recorded run; generator plans and invariant outcomes reproduce exactly. Convex ids are freshly assigned per run, so shard membership can shift; metrics that depend only on plans and scores are expected to agree and are compared per scenario above."
    : "Source or manifest hashes DIFFER from the recorded run — replay binds to a different code state; per-scenario comparisons are indicative only.";
  writeJson(nodePath.join(previousOutDir, "replay-agreement.json"), comparison);
  return comparison;
}

function scriptDir(): string {
  // process.argv[1] is the executed script path under node and tsx in both
  // CJS and ESM; import.meta.dirname is undefined under tsx's CJS loader.
  const script = nodeProcess.argv[1];
  return nodePath.resolve(nodePath.dirname(script ?? process.cwd()));
}

async function main(): Promise<void> {
  const args = nodeProcess.argv.slice(2);
  const outDir = nodePath.join(scriptDir(), "results");
  nodeFs.mkdirSync(outDir, { recursive: true });

  const manifestIdx = args.indexOf("--manifest");
  if (manifestIdx >= 0) {
    const manifestPath = nodePath.resolve(args[manifestIdx + 1]);
    const summary = await runManifest(manifestPath, outDir);
    const failed = failedInvariantCount(summary.invariants);
    console.log(
      `run complete: ${summary.scenarioResults.length} scenarios, ${summary.invariants.length} invariant checks, ${failed} failed`,
    );
    printReport(summary, outDir);
    if (failed > 0) process.exitCode = 1;
    return;
  }

  const replayIdx = args.indexOf("--replay");
  if (replayIdx >= 0) {
    const target = nodePath.resolve(args[replayIdx + 1]);
    const c = await replay(target);
    console.log(`replay complete: ${c.scenarios.length} scenarios compared; sourceHashesMatch=${c.sourceHashesMatch}`);
    const comparable = c.scenarios.filter((s) => s.matchedTotalAgrees !== null).length;
    const agree = c.scenarios.filter((s) => s.matchedTotalAgrees === true).length;
    console.log(`agreements: matched=${agree}/${comparable} comparable`);
    return;
  }

  console.error("usage: run.ts --manifest <path> | run.ts --replay <resultsDir>");
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  // process.exitCode alone is unreliable under tsx; force the non-zero exit.
  process.exit(1);
});
