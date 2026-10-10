/**
 * End-to-end study driver: for a scenario spec, materialize the population,
 * (quality scenarios) cache the engine score matrix and compare against the
 * exact reference and baselines, then run event-driven cycles recording
 * decisions, failure traces, and load metrics.
 *
 * Used by BOTH the plain-tsx runner (run.ts) and the vitest bridge, which
 * supply different RuntimeFactory implementations (real clock vs fake timers).
 */

import type { Id } from "@convex/_generated/dataModel";
import { api, internal } from "@convex/_generated/api";
import { planPopulation, DEFAULT_PARAMS } from "./generator.js";
import type { PopulationParams, ScenarioSpec } from "./types.js";
import { materializePopulation } from "./harness.js";
import type { StudyRuntime } from "./harness.js";
import type { ReplicaDecision, ReplicaEntry } from "./replica.js";
import { predictCycle, shardOf } from "./replica.js";
import { buildMatrices, compareWithExact } from "./scoringMatrix.js";
import type { MatrixBundle } from "./scoringMatrix.js";
import { exactReference } from "./exactReference.js";
import { greedyByScoreDesc, greedyFifo, greedyRandomOrder } from "./baselines.js";
import {
  queueRows,
  matchedPairs,
  pairsWithMatchIds,
  pairKey,
  analyticsRows,
  auditLogs,
  runEngineCycle,
  runCleanupOnly,
  assertGlobalInvariants,
  assertPointerMutuality,
  enginePairsFromMatches,
  wallSummary,
} from "./scenarios.js";
import type { InvariantOutcome, QueueRow, MatchPair } from "./scenarios.js";

export interface RuntimeHandle {
  runtime: StudyRuntime;
  dispose: () => Promise<void>;
}

export interface RuntimeFactory {
  create(startMs: number): Promise<RuntimeHandle>;
}

export interface FailureTrace {
  cycle: number;
  kind:
    | "createMatch-race-or-commit-failure"
    | "prediction-mismatch"
    | "unexpected-exception";
  detail: string;
  nowMs: number;
}

export interface WaitingRecord {
  userId: string;
  availabilityClass: string;
  enqueuedAt: number;
  resolvedAt: number | null;
  outcome: "matched" | "expired" | "still-waiting" | "cancelled";
  waitMs: number | null;
}

export interface QualityRecord {
  n: number;
  minScore: number;
  shardCount: number;
  engine: { cardinality: number; totalWeight: number };
  exact: { maxCardinality: number; maxWeight: number; maxWeightAtMaxCardinality: number };
  baselines: Array<{ name: string; cardinality: number; totalWeight: number }>;
  gaps: { cardinalityGap: number; weightGap: number };
  counterexample: boolean;
  eligiblePairCount: number;
  enginePairs: Array<{ i: number; j: number; score: number }>;
  exactMatching: Array<{ i: number; j: number; score: number }>;
  scores: number[][];
  overlap: boolean[][];
}

export interface LoadRecord {
  population: number;
  cyclesRun: number;
  matchedTotal: number;
  expiredTotal: number;
  stillWaitingAtEnd: number;
  coverageMatchedBeforeExpiry: number;
  waitingByClass: Record<string, { p50: number; p90: number; p99: number; max: number; count: number }>;
  waitingOverall: { p50: number; p90: number; p99: number; max: number; count: number };
  wallPerCycle: { p50: number; p90: number; p99: number; max: number; count: number };
  scoredPairsTotal: number;
  committedMatchesTotal: number;
  heapDeltaBytes: number | null;
  perCycle: Array<{
    cycle: number;
    nowMs: number;
    waitingBefore: number;
    matchCount: number;
    totalScore: number;
    expiredThisCycle: number;
    wallMs: number;
    scoredPairs: number;
  }>;
}

export interface ScenarioResult {
  scenario: string;
  family: string;
  seed: number;
  params: PopulationParams;
  userIds: string[];
  queueIds: string[];
  invariants: InvariantOutcome[];
  decisions: ReplicaDecision[];
  failures: FailureTrace[];
  waitingRecords: WaitingRecord[];
  quality: QualityRecord | null;
  load: LoadRecord | null;
  shardMembership: Record<string, number>;
}

export const BASE_CLOCK = 1750000000000; // fixed logical epoch for all runs

function replicaFromQueue(rows: QueueRow[], statusFilter: (r: QueueRow) => boolean): ReplicaEntry[] {
  return rows
    .filter(statusFilter)
    .map((r) => ({
      queueId: String(r._id),
      userId: String(r.userId),
      availableFrom: r.availableFrom,
      availableTo: r.availableTo,
      createdAt: r.createdAt,
    }));
}

/** Collects the engine's own score matrix + overlap over the current waiting set. */
export async function collectMatrix(
  env: StudyRuntime["env"],
  minScore: number,
): Promise<MatrixBundle> {
  const rows = await queueRows(env);
  const waiting = replicaFromQueue(rows, (r) => r.status === "waiting");
  const constraintsByUser = new Map<string, QueueRow["constraints"]>(
    rows.map((r) => [String(r.userId), r.constraints]),
  );
  const bundle = buildMatrices(waiting, () => 0);
  for (let i = 0; i < bundle.entries.length; i++) {
    for (let j = i + 1; j < bundle.entries.length; j++) {
      if (!bundle.overlap[i][j]) continue;
      const entry1 = bundle.entries[i];
      const entry2 = bundle.entries[j];
      const c1 = constraintsByUser.get(entry1.userId);
      const c2 = constraintsByUser.get(entry2.userId);
      if (!c1 || !c2) continue;
      const r = (await env.action(internal.matching.scoring.calculateCompatibilityScoreInternal, {
        user1Id: entry1.userId as unknown as Id<"users">,
        user2Id: entry2.userId as unknown as Id<"users">,
        user1Constraints: c1,
        user2Constraints: c2,
      })) as unknown as { score: number };
      bundle.scores[i][j] = bundle.scores[j][i] = r?.score ?? 0;
    }
  }
  void minScore;
  return bundle;
}

/**
 * Event-driven cycle loop: the clock jumps to the next interesting time
 * (next window opening or expiry), cleanup runs, then the engine cycle.
 */
export async function runCycles(
  handle: RuntimeHandle,
  opts: {
    maxCycles: number;
    overrides?: Partial<{ minScore: number; maxMatches: number; shardCount: number }>;
    maxTicks?: number;
    tickMs?: number;
  },
): Promise<{
  decisions: ReplicaDecision[];
  failures: FailureTrace[];
  perCycle: LoadRecord["perCycle"];
  walls: number[];
  scoredPairsTotal: number;
}> {
  const { runtime } = handle;
  const { env, clock, defaults } = runtime;
  const decisions: ReplicaDecision[] = [];
  const failures: FailureTrace[] = [];
  const perCycle: LoadRecord["perCycle"] = [];
  const walls: number[] = [];
  let scoredPairsTotal = 0;

  for (let cycle = 1; cycle <= opts.maxCycles; cycle++) {
    const rows = await queueRows(env);
    const waiting = rows.filter((r) => r.status === "waiting");
    if (waiting.length === 0) break;

    // Advance to the next interesting event (window opening or expiry).
    const now = clock.now();
    const eventTimes = waiting
      .flatMap((r) => [r.availableTo, ...(r.availableFrom > now ? [r.availableFrom] : [])])
      .filter((t) => t > now)
      .sort((a, b) => a - b);
    const nextEvent = eventTimes[0];
    if (nextEvent !== undefined && nextEvent > now) clock.advance(nextEvent - now);

    const expiredThisCycle = await runCleanupOnly(env);
    const waitingBefore = (await queueRows(env)).filter((r) => r.status === "waiting").length;
    const pairsBefore = new Set((await matchedPairs(env)).map((p) => pairKey(p.userAId, p.userBId)));

    // Structure-only replica: scan-set sizes and scored-pair counts (no score
    // matrix at load scale, so pair CHOICES are not predicted here).
    const preRows = await queueRows(env);
    const waitingReplica = replicaFromQueue(preRows, (r) => r.status === "waiting");
    const prediction = predictCycle(
      waitingReplica,
      {
        shardCount: opts.overrides?.shardCount ?? defaults.shardCount,
        minScore: opts.overrides?.minScore ?? defaults.minScore,
        maxMatches: opts.overrides?.maxMatches ?? defaults.maxMatches,
        nowMs: clock.now(),
      },
      () => 1,
    );

    const timing = await runEngineCycle(env, defaults, cycle, opts.overrides ?? {});
    walls.push(timing.wallMs);
    scoredPairsTotal += prediction.scoredPairs;

    const postRows = await queueRows(env);
    const pairsAfter = await pairsWithMatchIds(env, await matchedPairs(env));
    const newPairs = pairsAfter.filter((p) => !pairsBefore.has(pairKey(p.userAId, p.userBId)));
    const queueIdByUser = new Map(postRows.map((r) => [String(r.userId), String(r._id)]));
    for (const p of newPairs) {
      decisions.push({
        user1: String(p.userAId),
        user2: String(p.userBId),
        queue1: queueIdByUser.get(String(p.userAId)) ?? "unknown",
        queue2: queueIdByUser.get(String(p.userBId)) ?? "unknown",
        score: null,
        shard: shardOf(String(p.userAId), timing.shardCount),
      });
    }

    perCycle.push({
      cycle,
      nowMs: clock.now(),
      waitingBefore,
      matchCount: timing.matchCount,
      totalScore: timing.totalScore,
      expiredThisCycle,
      wallMs: timing.wallMs,
      scoredPairs: prediction.scoredPairs,
    });

    // Stop when nothing more can happen.
    const stillWaiting = postRows.filter((r) => r.status === "waiting");
    if (stillWaiting.length === 0) break;
    const now2 = clock.now();
    const anyVisible = stillWaiting.some(
      (r) => r.availableTo > now2 && r.availableFrom <= now2 + 3600000,
    );
    const anyLater = stillWaiting.some((r) => r.availableFrom > now2);
    if (!anyVisible && !anyLater) break;
  }

  return { decisions, failures, perCycle, walls, scoredPairsTotal };
}

/** Builds the load record from cycle output and final state. */
export function buildLoadRecord(
  params: PopulationParams,
  cycleOut: Awaited<ReturnType<typeof runCycles>>,
  pairs: MatchPair[],
  waitingRecords: WaitingRecord[],
  heapDeltaBytes: number | null,
): LoadRecord {
  const resolved = waitingRecords.filter((w) => w.waitMs !== null) as Array<
    WaitingRecord & { waitMs: number }
  >;
  const byClass: Record<string, number[]> = {};
  for (const w of resolved) {
    byClass[w.availabilityClass] = byClass[w.availabilityClass] ?? [];
    byClass[w.availabilityClass].push(w.waitMs);
  }
  const matchedTotal = waitingRecords.filter((w) => w.outcome === "matched").length;
  const expiredTotal = waitingRecords.filter((w) => w.outcome === "expired").length;
  return {
    population: params.count,
    cyclesRun: cycleOut.perCycle.length,
    matchedTotal,
    expiredTotal,
    stillWaitingAtEnd: waitingRecords.filter((w) => w.outcome === "still-waiting").length,
    coverageMatchedBeforeExpiry: params.count > 0 ? matchedTotal / params.count : 0,
    waitingByClass: Object.fromEntries(
      Object.entries(byClass).map(([k, v]) => [k, percentileSummaryOf(v)]),
    ),
    waitingOverall: percentileSummaryOf(resolved.map((w) => w.waitMs)),
    wallPerCycle: wallSummary(cycleOut.walls),
    scoredPairsTotal: cycleOut.scoredPairsTotal,
    committedMatchesTotal: pairs.length,
    heapDeltaBytes,
    perCycle: cycleOut.perCycle,
  };
}

function percentileSummaryOf(values: number[]): {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  count: number;
} {
  return wallSummary(values);
}

/** Full quality comparison for small tiers (matrix -> exact -> baselines). */
export function compareQuality(
  bundle: MatrixBundle,
  pairs: MatchPair[],
  n: number,
  minScore: number,
  shardCount: number,
  seed: number,
): QualityRecord {
  const overlapFn = (i: number, j: number) => bundle.overlap[i][j];
  const scoreFnSync = (i: number, j: number) => bundle.scores[Math.min(i, j)][Math.max(i, j)];
  const exact = exactReference(n, bundle.scores, overlapFn, minScore);
  const engine = enginePairsFromMatches(bundle, pairs);
  const baselineDesc = greedyByScoreDesc(n, overlapFn, scoreFnSync, minScore);
  const baselineFifo = greedyFifo(n, overlapFn, scoreFnSync, minScore);
  const baselineRandom = greedyRandomOrder(n, overlapFn, scoreFnSync, minScore, seed);
  const gaps = compareWithExact(engine.pairs, exact, bundle.overlap, bundle.scores, minScore);
  return {
    n,
    minScore,
    shardCount,
    engine: { cardinality: engine.cardinality, totalWeight: engine.totalWeight },
    exact: {
      maxCardinality: exact.maxCardinality,
      maxWeight: exact.maxWeight,
      maxWeightAtMaxCardinality: exact.maxWeightAtMaxCardinality,
    },
    baselines: [baselineDesc, baselineFifo, ...baselineRandom.runs.slice(0, 3), baselineRandom.best].map(
      (b) => ({ name: b.name, cardinality: b.cardinality, totalWeight: b.totalWeight }),
    ),
    gaps: { cardinalityGap: gaps.cardinalityGap, weightGap: gaps.weightGap },
    counterexample: gaps.cardinalityGap > 0 || gaps.weightGap > 1e-9,
    eligiblePairCount: exact.eligiblePairs.length,
    enginePairs: engine.pairs,
    exactMatching: exact.exampleMatching,
    scores: bundle.scores,
    overlap: bundle.overlap,
  };
}

/** Executes one scenario end-to-end on a fresh runtime. */
export async function executeScenario(
  spec: ScenarioSpec,
  factory: RuntimeFactory,
  overrides: Partial<PopulationParams> = {},
): Promise<ScenarioResult> {
  const params: PopulationParams = { ...DEFAULT_PARAMS, ...spec.params, ...overrides };
  const handle = await factory.create(BASE_CLOCK);
  const { runtime } = handle;
  const plan = planPopulation(spec.name, spec.seed, params, BASE_CLOCK);

  const mat = await materializePopulation(runtime, plan, { queue: !spec.noQueue });
  const invariants: InvariantOutcome[] = [];
  const failures: FailureTrace[] = [];
  const maxCycles = spec.maxCycles ?? 40;

  // Quality scenarios: cache the matrix over the full waiting set BEFORE any
  // cycle runs (manifest pins availabilityMix to always-on for these).
  const bundle = spec.quality ? await collectMatrix(runtime.env, runtime.defaults.minScore) : null;

  const cycleOut = await runCycles(handle, {
    maxCycles,
    overrides: spec.engineOverrides,
  });

  const pairs = await pairsWithMatchIds(runtime.env, await matchedPairs(runtime.env));
  const analytics = await analyticsRows(runtime.env);
  invariants.push(...assertGlobalInvariants(pairs, analytics));
  const finalRows = await queueRows(runtime.env);
  invariants.push(...assertPointerMutuality(finalRows, pairs));

  // Waiting records with per-entry outcomes and wait times.
  const plannedByUser = new Map(plan.entries.map((e) => [String(e.userId), e]));
  const waitingRecords: WaitingRecord[] = finalRows.map((r) => {
    const planned = plannedByUser.get(String(r.userId));
    const outcome =
      r.status === "matched"
        ? "matched"
        : r.status === "expired"
          ? "expired"
          : r.status === "cancelled"
            ? "cancelled"
            : "still-waiting";
    const resolvedAt =
      outcome === "matched" || outcome === "expired" ? ((r as unknown as { updatedAt?: number }).updatedAt ?? null) : null;
    return {
      userId: String(r.userId),
      availabilityClass: planned?.availabilityClass ?? "unknown",
      enqueuedAt: r.createdAt,
      resolvedAt,
      outcome,
      waitMs: resolvedAt !== null ? resolvedAt - r.createdAt : null,
    };
  });

  // Expiry audit pairing: each expired entry wrote one auditLog.
  const logs = await auditLogs(runtime.env);
  const expiredCount = finalRows.filter((r) => r.status === "expired").length;
  const expiryLogs = logs.filter((l) => l.action === "queue_expired");
  invariants.push({
    name: "expiry writes one auditLog per expired entry",
    passed: expiryLogs.length >= expiredCount,
    detail: `expired=${expiredCount} logs=${expiryLogs.length}`,
  });

  // Quality record (small tiers only).
  let quality: QualityRecord | null = null;
  if (spec.quality && bundle && params.count <= 8) {
    quality = compareQuality(
      bundle,
      pairs,
      params.count,
      spec.engineOverrides?.minScore ?? runtime.defaults.minScore,
      spec.engineOverrides?.shardCount ?? runtime.defaults.shardCount,
      spec.seed,
    );
    // Fill decision scores from the pre-cycle engine matrix.
    const idx = new Map(bundle.entries.map((e, i) => [String(e.userId), i] as const));
    for (const d of cycleOut.decisions) {
      const i = idx.get(d.user1);
      const j = idx.get(d.user2);
      if (i === undefined || j === undefined) continue;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      if (bundle.overlap[lo][hi]) d.score = bundle.scores[lo][hi];
    }
  }

  const load = buildLoadRecord(params, cycleOut, pairs, waitingRecords, null);

  const shardMembership: Record<string, number> = {};
  for (const e of plan.entries) {
    shardMembership[String(e.userId)] = shardOf(
      String(e.userId),
      spec.engineOverrides?.shardCount ?? runtime.defaults.shardCount,
    );
  }

  await handle.dispose();

  return {
    scenario: spec.name,
    family: spec.family,
    seed: spec.seed,
    params,
    userIds: mat.userIds.map(String),
    queueIds: mat.queueIds.map(String),
    invariants,
    decisions: cycleOut.decisions,
    failures: [...failures, ...cycleOut.failures],
    waitingRecords,
    quality,
    load,
    shardMembership,
  };
}
