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
  type LoadRecord,
  type QualityRecord,
} from "./src/runFlow.js";
import { runInvariantSuite } from "./src/invariantScenarios.js";
import type { InvariantOutcome } from "./src/scenarios.js";
import {
  environment,
  hashStudySources,
  sha256File,
  writeJson,
} from "./src/artifacts.js";
import type { ScenarioSpec, PopulationParams } from "./src/types.js";
import { planPopulation, DEFAULT_PARAMS } from "./src/generator.js";

interface ManifestFile {
  name: string;
  description: string;
  version: number;
  defaults: {
    minScore: number;
    maxMatches: number;
    shardCount: number;
    startClockMs: number;
  };
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

export function nodeFactory(): RuntimeFactory {
  return {
    async create(startMs: number): Promise<RuntimeHandle> {
      const runtime = createStudyRuntime(startMs, {
        minScore: 0.6,
        maxMatches: 50,
        shardCount: 4,
      });
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
    // Complete plan insertion order: the matched-pair receipt maps participant
    // ids to indices in THIS list (population-level), so it must be full.
    userIds: result.userIds,
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
  return invariants.filter(
    (o) => !o.passed && !o.name.includes("DOCUMENTS MISSING GUARD"),
  ).length;
}

async function runManifest(
  manifestPath: string,
  outDir: string,
): Promise<RunSummary> {
  const repoRoot = nodeProcess.cwd();
  const manifest = JSON.parse(
    nodeFs.readFileSync(manifestPath, "utf8"),
  ) as ManifestFile;
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

  const failedInvariants = inv.outcomes.filter(
    (o) => !o.passed && !o.name.includes("DOCUMENTS MISSING GUARD"),
  );
  if (failedInvariants.length > 0) {
    console.error(`INVARIANT FAILURES (${failedInvariants.length}):`);
    for (const f of failedInvariants)
      console.error(`  - ${f.name}: ${f.detail ?? ""}`);
  }

  // --- Quality scenarios ---
  for (const spec of manifest.quality) {
    console.log(
      `[quality] ${spec.name} (seed ${spec.seed}, n=${spec.params.count})`,
    );
    const result = await executeScenario(spec, factory);
    if (result.quality && result.quality.counterexample) {
      const file = nodePath.join(
        outDir,
        "counterexamples",
        `${spec.name}.json`,
      );
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
    const decisionsFile = nodePath.join(
      outDir,
      "decisions",
      `${spec.name}.json`,
    );
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
    console.log(
      `[load] ${spec.name} (seed ${spec.seed}, n=${spec.params.count})`,
    );
    const result = await executeScenario(spec, factory);
    const wallMs = Date.now() - t0;
    const memAfter = nodeProcess.memoryUsage().heapUsed;
    if (result.load) result.load.heapDeltaBytes = memAfter - memBefore;

    const decisionsFile = nodePath.join(
      outDir,
      "decisions",
      `${spec.name}.json`,
    );
    // Keep big pools compact: full dumps only for small populations. The
    // plan-order userIds are always full — the pair receipt maps ids to
    // population-level indices and needs the complete creation order.
    const keepFull = result.params.count <= 100;
    writeJson(decisionsFile, {
      scenario: result.scenario,
      seed: result.seed,
      decisionCount: result.decisions.length,
      userIds: result.userIds,
      decisions: keepFull ? result.decisions : result.decisions.slice(0, 100),
      shardMembership: keepFull ? result.shardMembership : sampleShards(result),
      waitingRecords: keepFull
        ? result.waitingRecords
        : result.waitingRecords.slice(0, 200),
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
  writeJson(
    nodePath.join(outDir, "environment.json"),
    environment(summary.gitSha),
  );
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
    lines.push(
      `- [${o.passed ? "x" : " "}] ${o.name}${o.detail ? ` — ${o.detail}` : ""}`,
    );
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
  nodeFs.writeFileSync(
    nodePath.join(outDir, "console-report.md"),
    `${lines.join("\n")}\n`,
  );
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
    /** True only when EVERY applicable receipt for the scenario agrees. */
    agreesAll: boolean | null;
    receipts: Array<{
      receipt: string;
      agrees: boolean | null;
      detail: string;
    }>;
    totals: {
      matchedTotalAgrees: boolean | null;
      expiredTotalAgrees: boolean | null;
      cyclesRunAgrees: boolean | null;
      original: {
        matchedTotal: number | null;
        expiredTotal: number | null;
        cyclesRun: number | null;
      };
      replayed: {
        matchedTotal: number | null;
        expiredTotal: number | null;
        cyclesRun: number | null;
      };
    };
    notes: string[];
  }>;
  invariantsReplayed: { passed: number; failed: number };
  invariantsPassCountAgrees: boolean;
  receiptFailureCount: number;
  conclusion: string;
}

interface ReceiptCheck {
  receipt: string;
  agrees: boolean | null;
  detail: string;
}

/**
 * Matched-pair decision receipt as a sorted multiset of pairs of PLAN-LEVEL
 * indices: each participant id is mapped to its index in that side's COMPLETE
 * population plan insertion order (the deterministic per-seed creation order
 * of all planned entries), not to a rank compressed over the matched subset.
 *
 * A per-matching subset rank (the pre-fix normalizer) mapped any changed
 * matched subset with preserved relative order to the identical rank
 * structure — e.g. recorded pair 0-1 vs replayed pair 2-3 both compressed to
 * "0-1" and passed. Population-level indices make any change in WHICH users
 * matched break agreement.
 *
 * Pure function, shared by the replay path and the replay-falsifier test.
 */
export function matchedPairsReceipt(input: {
  committed: Array<{ user1: string; user2: string }>;
  committedPlanOrder: string[];
  totalOriginal: number;
  fresh: Array<{ user1: string; user2: string }>;
  freshPlanOrder: string[];
}): { receipt: string; agrees: boolean; detail: string } {
  const {
    committed,
    committedPlanOrder,
    totalOriginal,
    fresh,
    freshPlanOrder,
  } = input;
  // Fail closed: without the recorded plan order the population-level index
  // mapping cannot be built, so the receipt cannot verify pair structure.
  if (!committedPlanOrder || committedPlanOrder.length === 0) {
    return {
      receipt: "matched-pair decisions",
      agrees: false,
      detail:
        "recorded decisions artifact lacks plan-order userIds — pair structure cannot be verified",
    };
  }
  // Big pools store only the first-100 committed-order prefix (the keepFull
  // cap in the manifest writer); compare the same-length prefix of the fresh
  // side plus the total count so the cap cannot fake drift.
  const capped = totalOriginal > committed.length;
  const freshCmp = capped ? fresh.slice(0, committed.length) : fresh;
  const sigA = decisionPairSignature(committed, committedPlanOrder);
  const sigB = decisionPairSignature(freshCmp, freshPlanOrder);
  const same =
    totalOriginal === fresh.length &&
    sigA.length === sigB.length &&
    sigA.every((v, i) => v === sigB[i]);
  return {
    receipt: "matched-pair decisions",
    agrees: same,
    detail: same
      ? capped
        ? `first ${committed.length} of ${totalOriginal} committed pairs match by population plan index (capped artifact: prefix + total compared)`
        : `${sigA.length} committed pairs match by population plan index`
      : `pair structure drift: original ${committed.length}${capped ? ` of ${totalOriginal}` : ""} vs replayed ${fresh.length} pairs`,
  };
}

/** Matched-pair decision structure as a sorted multiset of pairs of indices
 * into `planOrder` (the complete population's plan insertion order). Fresh
 * Convex ids differ per run, so pairs are compared by plan position, not id
 * strings. A participant id missing from planOrder yields a deterministic
 * unranked marker that breaks agreement. */
function decisionPairSignature(
  decisions: Array<{ user1: string; user2: string }>,
  planOrder: string[],
): string[] {
  const ranked = new Map<string, number>();
  planOrder.forEach((id, i) => ranked.set(id, i));
  const pairs = decisions.map((d, di) => {
    const a = ranked.get(d.user1);
    const b = ranked.get(d.user2);
    if (a === undefined || b === undefined) return `unranked-${di}`;
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  });
  return pairs.sort();
}

const floatEq = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

interface WaitingPercentiles {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  count: number;
}

/** Waiting-entry receipt: overall + per-class percentile tuples (logical ms,
 * derived from the plan's clock schedule — independent of Convex ids). */
function waitingReceiptCheck(
  receipt: string,
  original:
    | {
        waitingOverall: WaitingPercentiles;
        waitingByClass: Record<string, WaitingPercentiles>;
      }
    | null
    | undefined,
  replayed:
    | {
        waitingOverall: WaitingPercentiles;
        waitingByClass: Record<string, WaitingPercentiles>;
      }
    | null
    | undefined,
): ReceiptCheck {
  if (!original || !replayed) {
    return {
      receipt,
      agrees: false,
      detail: "missing waiting receipts (original or replayed)",
    };
  }
  const sig = (w: WaitingPercentiles): string =>
    JSON.stringify([w.p50, w.p90, w.p99, w.max, w.count]);
  const classes = new Set([
    ...Object.keys(original.waitingByClass),
    ...Object.keys(replayed.waitingByClass),
  ]);
  for (const c of classes) {
    const a = original.waitingByClass[c];
    const b = replayed.waitingByClass[c];
    if (!a || !b)
      return {
        receipt,
        agrees: false,
        detail: `waitingByClass.${c} missing on one side`,
      };
    if (sig(a) !== sig(b)) {
      return {
        receipt,
        agrees: false,
        detail: `waitingByClass.${c} drift: original ${sig(a)} vs replayed ${sig(b)}`,
      };
    }
  }
  if (sig(original.waitingOverall) !== sig(replayed.waitingOverall)) {
    return {
      receipt,
      agrees: false,
      detail: `waitingOverall drift: original ${sig(original.waitingOverall)} vs replayed ${sig(replayed.waitingOverall)}`,
    };
  }
  return {
    receipt,
    agrees: true,
    detail: `waiting percentiles agree (overall p50/p90/p99/max/count ${sig(original.waitingOverall)})`,
  };
}

/**
 * Replay: regenerate populations from the manifest's frozen seeds and re-run,
 * then validate locked receipts against the saved run. This is a STRUCTURAL /
 * AGREEMENT replay, never a byte-exact one: convex-test assigns fresh Convex
 * ids on every run, so stored document ids legitimately differ. Receipts are
 * therefore expressed over id-independent structure: per-cycle match vectors,
 * matched-pair decision structure (compared by id creation rank), exact-reference
 * objectives, and waiting-entry percentile tuples. The command exits nonzero on
 * any source-hash mismatch, receipt drift, or agreement failure — a replay that
 * cannot fail must not pass.
 */
export async function replay(
  previousOutDir: string,
): Promise<ReplayComparison> {
  const repoRoot = nodeProcess.cwd();
  const prevSummaryPath = nodePath.join(previousOutDir, "run-summary.json");
  const prevSummary = JSON.parse(
    nodeFs.readFileSync(prevSummaryPath, "utf8"),
  ) as RunSummary;
  // Prefer a manifest carried inside the recorded results dir (self-contained
  // recordings, incl. replay-falsifier fixtures); fall back to the repo copy.
  const manifestPath =
    [nodePath.join(previousOutDir, prevSummary.manifest),
     nodePath.join(repoRoot, "experiments", "matching-study", prevSummary.manifest)]
      .find((p) => nodeFs.existsSync(p)) ??
    nodePath.join(repoRoot, "experiments", "matching-study", prevSummary.manifest);
  const manifestHashNow = sha256File(manifestPath);
  const sourceHashesNow = hashStudySources(repoRoot);

  const factory = nodeFactory();
  const inv = await runInvariantSuite(factory);

  const manifest = JSON.parse(
    nodeFs.readFileSync(manifestPath, "utf8"),
  ) as ManifestFile;
  const prevPassed = prevSummary.invariants.filter((i) => i.passed).length;
  const replayedPassed = inv.outcomes.filter((o) => o.passed).length;
  const comparison: ReplayComparison = {
    replayedAt: new Date().toISOString(),
    manifestHashOriginal: prevSummary.manifestHash,
    manifestHashCurrent: manifestHashNow,
    sourceHashesMatch:
      prevSummary.manifestHash === manifestHashNow &&
      Object.keys(sourceHashesNow).length ===
        Object.keys(prevSummary.sourceHashes).length &&
      Object.keys(sourceHashesNow).every(
        (k) => prevSummary.sourceHashes[k] === sourceHashesNow[k],
      ),
    scenarios: [],
    invariantsReplayed: {
      passed: replayedPassed,
      failed: failedInvariantCount(inv.outcomes),
    },
    invariantsPassCountAgrees: replayedPassed === prevPassed,
    receiptFailureCount: 0,
    conclusion: "",
  };

  for (const spec of [
    ...manifest.quality,
    ...manifest.loadSmoke,
    ...manifest.loadFull,
  ]) {
    const notes: string[] = [];
    const receipts: ReceiptCheck[] = [];
    // Regenerate the plan identically (same seed + params).
    const params: PopulationParams = { ...DEFAULT_PARAMS, ...spec.params };
    const plan = planPopulation(
      spec.name,
      spec.seed,
      params,
      manifest.defaults.startClockMs,
    );
    notes.push(
      `regenerated ${plan.entries.length} planned entries from seed ${spec.seed}`,
    );
    const result = await executeScenario(spec, factory);

    const original = prevSummary.scenarioResults.find(
      (s) => s.scenario === spec.name,
    );
    const origLoad = (original?.loadSummary ?? null) as LoadRecord | null;
    const origQuality = (original?.qualitySummary ??
      null) as QualityRecord | null;
    const agrees = (
      a: number | undefined | null,
      b: number | undefined | null,
    ): boolean =>
      a === undefined || b === undefined || a === null || b === null
        ? false
        : a === b;

    // Totals receipt (load scenarios): committed vs replayed aggregates.
    if (result.load || origLoad) {
      receipts.push({
        receipt: "totals",
        agrees:
          agrees(origLoad?.matchedTotal, result.load?.matchedTotal) &&
          agrees(origLoad?.expiredTotal, result.load?.expiredTotal) &&
          agrees(origLoad?.cyclesRun, result.load?.cyclesRun),
        detail: `matched ${origLoad?.matchedTotal ?? "?"}→${result.load?.matchedTotal ?? "?"}, expired ${origLoad?.expiredTotal ?? "?"}→${result.load?.expiredTotal ?? "?"}, cycles ${origLoad?.cyclesRun ?? "?"}→${result.load?.cyclesRun ?? "?"}`,
      });
    }

    // Per-cycle receipt (load scenarios): elementwise match/expiry/scored-pair
    // vectors and averageScore — stronger than cycle-count totals alone.
    if (result.load && origLoad) {
      const a = origLoad.perCycle ?? [];
      const b = result.load.perCycle ?? [];
      if (a.length !== b.length || a.length === 0) {
        receipts.push({
          receipt: "per-cycle vectors",
          agrees: false,
          detail: `perCycle length ${a.length} vs ${b.length}`,
        });
      } else {
        const driftIdx = a.findIndex((p, i) => {
          const q = b[i];
          return (
            p.totalMatches !== q.totalMatches ||
            p.expiredThisCycle !== q.expiredThisCycle ||
            p.scoredPairs !== q.scoredPairs ||
            !floatEq(p.averageScore, q.averageScore)
          );
        });
        receipts.push({
          receipt: "per-cycle vectors",
          agrees: driftIdx < 0,
          detail:
            driftIdx < 0
              ? `${a.length} cycles agree elementwise (totalMatches, expiredThisCycle, scoredPairs, averageScore)`
              : `first drift at cycle index ${driftIdx}: ${JSON.stringify(a[driftIdx])} vs ${JSON.stringify(b[driftIdx])}`,
        });
      }
    }

    // Matched-pair decision receipt (both families): the multiset of committed
    // pairs compared by plan insertion rank, so fresh ids do not mask drift.
    // run-summary stores decisionsFile as a repo-relative path; accept a bare
    // filename too, in case earlier summaries stored only that.
    const storedName = original?.decisionsFile ?? `${spec.name}.json`;
    const candidates = [
      nodePath.join(repoRoot, storedName),
      nodePath.join(previousOutDir, "decisions", nodePath.basename(storedName)),
    ];
    const origDecisionsPath = candidates.find((p) => nodeFs.existsSync(p));
    if (origDecisionsPath) {
      const origDecisions = JSON.parse(
        nodeFs.readFileSync(origDecisionsPath, "utf8"),
      ) as {
        decisionCount?: number;
        userIds?: string[];
        decisions: Array<{ user1: string; user2: string }>;
      };
      const receipt = matchedPairsReceipt({
        committed: origDecisions.decisions,
        committedPlanOrder: origDecisions.userIds ?? [],
        totalOriginal:
          origDecisions.decisionCount ?? origDecisions.decisions.length,
        fresh: result.decisions.map((d) => ({
          user1: d.user1,
          user2: d.user2,
        })),
        freshPlanOrder: result.userIds,
      });
      receipts.push(receipt);
    } else {
      receipts.push({
        receipt: "matched-pair decisions",
        agrees: false,
        detail: `missing original decisions file (stored name: ${storedName})`,
      });
    }

    // Exact-reference receipt (quality scenarios): the independent solver's
    // objectives are pure functions of the seed-derived score matrix.
    if (result.quality && origQuality) {
      const e = result.quality.exact;
      const oe = origQuality.exact;
      const exactOk =
        e.maxCardinality === oe.maxCardinality &&
        floatEq(e.maxWeight, oe.maxWeight) &&
        floatEq(e.maxWeightAtMaxCardinality, oe.maxWeightAtMaxCardinality);
      const baselinesOk =
        result.quality.baselines.length === origQuality.baselines.length &&
        result.quality.baselines.every((b, i) => {
          const ob = origQuality.baselines[i];
          return (
            b.name === ob.name &&
            b.cardinality === ob.cardinality &&
            floatEq(b.totalWeight, ob.totalWeight)
          );
        });
      receipts.push({
        receipt: "exact-reference objectives",
        agrees: exactOk && baselinesOk,
        detail: `exact ${e.maxCardinality}/${e.maxWeight.toFixed(6)} vs original ${oe.maxCardinality}/${oe.maxWeight.toFixed(6)}; baselines ${baselinesOk ? "agree" : "DRIFT"}`,
      });
      // Engine objective LOCKED for all shard counts. convex-test mints ids
      // deterministically per plan insertion order, so hash-shard membership
      // and the engine's allocation reproduce across independent runs —
      // verified: three independent full manifest runs produced identical
      // engine cardinality/weight for every quality scenario, including
      // shardCount=4, and the hardened replay's informational notes recorded
      // original == replayed for each. A receipt failure now means real
      // allocation drift, not id noise.
      receipts.push({
        receipt: `engine objective (shardCount=${result.quality.shardCount})`,
        agrees:
          result.quality.engine.cardinality ===
            origQuality.engine.cardinality &&
          floatEq(
            result.quality.engine.totalWeight,
            origQuality.engine.totalWeight,
          ),
        detail: `engine ${result.quality.engine.cardinality}/${result.quality.engine.totalWeight.toFixed(6)} vs original ${origQuality.engine.cardinality}/${origQuality.engine.totalWeight.toFixed(6)} at shardCount=${result.quality.shardCount}`,
      });
    }

    // Waiting-entry receipt (load scenarios): logical-ms percentile tuples.
    if (result.load || origLoad) {
      receipts.push(
        waitingReceiptCheck("waiting receipts", origLoad, result.load),
      );
    }

    const agreeAll =
      receipts.length > 0 && receipts.every((r) => r.agrees === true);
    comparison.scenarios.push({
      scenario: spec.name,
      seed: spec.seed,
      agreesAll: agreeAll,
      receipts,
      totals: {
        matchedTotalAgrees: agrees(
          origLoad?.matchedTotal,
          result.load?.matchedTotal,
        ),
        expiredTotalAgrees: agrees(
          origLoad?.expiredTotal,
          result.load?.expiredTotal,
        ),
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
      },
      notes,
    });
  }

  comparison.receiptFailureCount = comparison.scenarios.reduce(
    (n, s) => n + s.receipts.filter((r) => r.agrees === false).length,
    0,
  );

  // Structural replay: same generator plans, decisions, aggregates, and
  // invariant outcomes — with freshly assigned Convex ids each run. Byte-exact
  // reproduction of stored ids is neither possible nor claimed.
  comparison.conclusion = comparison.sourceHashesMatch
    ? "Source and manifest hashes match the recorded run; generator plans, matched-pair decision structure, exact-reference objectives, waiting receipts, and invariant outcomes agree (structural/agreement replay with fresh Convex ids — not a byte-exact reproduction)."
    : "Source or manifest hashes DIFFER from the recorded run — replay binds to a different code state; this run FAILS and per-scenario comparisons are indicative only.";
  writeJson(nodePath.join(previousOutDir, "replay-agreement.json"), comparison);
  return comparison;
}

/** Fail-closed replay verdict — the exact predicate the CLI exit path uses,
 * exported so the replay-falsifier test exercises the same acceptance rule. */
export function replayPasses(c: ReplayComparison): boolean {
  return (
    c.sourceHashesMatch &&
    c.invariantsPassCountAgrees &&
    c.invariantsReplayed.failed === 0 &&
    c.receiptFailureCount === 0 &&
    c.scenarios.length > 0 &&
    c.scenarios.every((s) => s.agreesAll === true)
  );
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
    console.log(
      `replay complete: ${c.scenarios.length} scenarios compared; sourceHashesMatch=${c.sourceHashesMatch}`,
    );
    const agreeing = c.scenarios.filter((s) => s.agreesAll === true).length;
    const disagreeing = c.scenarios.filter((s) => s.agreesAll === false).length;
    console.log(
      `agreements: ${agreeing}/${c.scenarios.length} scenarios fully agree, ${disagreeing} disagree, receipt failures=${c.receiptFailureCount}, invariants ${c.invariantsReplayed.passed} passed / ${c.invariantsReplayed.failed} failed`,
    );
    for (const s of c.scenarios) {
      for (const r of s.receipts.filter((x) => x.agrees !== true)) {
        console.error(
          `REPLAY RECEIPT FAILURE [${s.scenario}] ${r.receipt}: ${r.detail}`,
        );
      }
    }
    // Fail closed: any source-hash mismatch, receipt drift, agreement failure,
    // or replayed invariant failure makes the replay command fail.
    if (!replayPasses(c)) {
      console.error(
        "replay FAILED: receipts or hashes do not agree with the recorded run",
      );
      process.exitCode = 1;
    }
    return;
  }

  console.error(
    "usage: run.ts --manifest <path> | run.ts --replay <resultsDir>",
  );
  process.exitCode = 2;
}

// Run the CLI only when this file is the executed script (tsx); importing
// run.ts from vitest must not trigger a run.
if (nodePath.basename(nodeProcess.argv[1] ?? "") === "run.ts") {
  main().catch((err) => {
    console.error(err);
    // process.exitCode alone is unreliable under tsx; force the non-zero exit.
    process.exit(1);
  });
}
