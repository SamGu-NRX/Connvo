/**
 * Eval runner (README §runs).
 *
 * Usage: npx tsx tools/matching-eval/src/run.ts --seeds=5 --rounds=12
 *
 * Per seed: build the synthetic population, derive embeddings once,
 * then run every matcher direction for N rounds. Each round: matcher
 * proposes matches → the outcome simulator responds → the matcher
 * observes outcomes. After the final round, run the permission
 * differential and the allocation check with the direction's weight
 * vector. Results aggregate across seeds and print as a markdown
 * table with per-direction PASS/FAIL against the frozen bars.
 */

import { makePopulation } from "./population";
import { makeGroundTruth } from "./ground-truth";
import { deriveEmbedding } from "./embeddings";
import {
  SAM_DEFAULT_WEIGHTS,
  computeFeatures,
  cosineSim,
  weightedSum,
} from "./features";
import {
  TUNED_WEIGHTS,
  baselineDefaults,
  tunedWeights,
  learnedLinear,
  adaptiveHybrid,
} from "./matchers";
import {
  permissionDifferential,
  allocationCheckAtN8,
  percentile,
  mean,
} from "./metrics";
import { newSimState, simulatePair, decayFatigue } from "./outcomes";
import { Rng } from "./rng";
import type { EvalProfile, Matcher, FeatureKey } from "./types";

/**
 * Frozen pass bars (README §bars): set from the calibration run, they
 * guard against regressions rather than encode aspirations. The
 * permission bars are absolute: zero violations and a non-vacuous
 * negative control, for every direction.
 */
const BARS = {
  successRate: 0.6,
  precisionAtTop: 0.7,
  fatiguedP99: 0.75,
  coverage: 0.95,
  allocationWeightGap: 0.02,
  stabilityTop5: 0.8,
  permissionViolations: 0,
} as const;

interface DirectionStats {
  name: string;
  successRate: number;
  precisionAtTop: number;
  fatiguedP99: number;
  longTailP50: number;
  coverage: number;
  allocationWeightGap: number;
  stabilityTop5: number;
  permissionMaxDelta: number;
  permissionViolations: number;
  permissionVacuous: boolean;
  latencyP95Ms: number;
}

interface DirSpec {
  name: string;
  make: () => Matcher;
  weights: Record<FeatureKey, number>;
}

const DIRECTIONS: DirSpec[] = [
  { name: "baseline-defaults", make: baselineDefaults, weights: SAM_DEFAULT_WEIGHTS },
  { name: "tuned-weights", make: tunedWeights, weights: TUNED_WEIGHTS },
  { name: "learned-linear", make: learnedLinear, weights: TUNED_WEIGHTS },
  { name: "adaptive-hybrid", make: adaptiveHybrid, weights: TUNED_WEIGHTS },
];

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return a.size === 0 ? 0 : n / a.size;
}

async function runDirection(
  spec: DirSpec,
  population: ReturnType<typeof makePopulation>,
  gt: ReturnType<typeof makeGroundTruth>,
  cos: (a: string, b: string) => number | undefined,
  seed: number,
  rounds: number,
): Promise<DirectionStats> {
  const matcher = spec.make();
  const state = newSimState();
  const simRng = new Rng(seed * 77 + 5);
  const probeRng = new Rng(seed * 13 + 3);

  const byId = new Map<string, EvalProfile>(population.profiles.map((p) => [p.id, p]));
  const idxOf = new Map<string, number>(population.profiles.map((p, i) => [p.id, i]));

  const latencies: number[] = [];
  const shownG: number[] = [];
  const matchCount = new Map<string, number>();
  const completedUsers = new Set<string>();
  let stabilitySum = 0;
  let stabilityN = 0;
  let prevTop5: Set<string> | null = null;

  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    const out = matcher.round({
      population,
      round: r,
      embeddingCosine: cos,
    });
    latencies.push(performance.now() - t0);

    const top5 = new Set(out.matches.slice(0, 5).map((m) => `${m.userA}|${m.userB}`));
    // Post-warmup stability: adaptive matchers reshuffle while cold;
    // the property we guard is the warm matcher's top-5.
    if (prevTop5 !== null && r >= Math.floor(rounds * 0.4)) {
      stabilitySum += overlap(top5, prevTop5);
      stabilityN++;
    }
    prevTop5 = top5;

    for (const match of out.matches) {
      const a = byId.get(match.userA);
      const b = byId.get(match.userB);
      if (!a || !b) continue;
      const oc = simulatePair(
        { population, gt, state, rng: simRng },
        a,
        b,
      );
      matchCount.set(a.id, (matchCount.get(a.id) ?? 0) + 1);
      matchCount.set(b.id, (matchCount.get(b.id) ?? 0) + 1);
      if (oc.outcome === "completed") {
        completedUsers.add(a.id);
        completedUsers.add(b.id);
      }
      const ia = idxOf.get(oc.userA);
      const ib = idxOf.get(oc.userB);
      if (ia !== undefined && ib !== undefined) {
        const la = population.latents[ia];
        const lb = population.latents[ib];
        if (la && lb) shownG.push(gt.deterministic(a, b, la, lb));
      }
      matcher.observe?.({
        population,
        outcome: { userA: oc.userA, userB: oc.userB, outcome: oc.outcome },
        features: computeFeatures(a, b, cos(a.id, b.id)).features,
      });
    }
    decayFatigue(state);
  }

  const total = state.history.length;
  const completed = state.history.filter((o) => o.outcome === "completed").length;
  const successRate = total === 0 ? 0 : completed / total;

  const tau = gt.threshold;
  const precisionAtTop =
    shownG.length === 0 ? 0 : shownG.filter((g) => g > tau).length / shownG.length;

  const fatigueVals = [...state.fatigue.values()];
  const fatiguedP99 = percentile(fatigueVals, 0.99);
  const tailVals = population.profiles.map((p) => matchCount.get(p.id) ?? 0);

  const gaps: number[] = [];
  for (let s = 0; s < 8; s++) {
    const check = allocationCheckAtN8(population, cos, spec.weights, probeRng);
    gaps.push(check.weightGap);
  }

  const perm = permissionDifferential(population, cos, (a, b) =>
    weightedSum(computeFeatures(a, b, cos(a.id, b.id)).features, spec.weights),
  );

  return {
    name: spec.name,
    successRate,
    precisionAtTop,
    fatiguedP99,
    longTailP50: percentile(tailVals, 0.5),
    coverage: completedUsers.size / population.profiles.length,
    allocationWeightGap: mean(gaps),
    stabilityTop5: stabilityN === 0 ? 1 : stabilitySum / stabilityN,
    permissionMaxDelta: perm.maxDelta,
    permissionViolations: perm.violations + (perm.vacuous ? 1 : 0),
    permissionVacuous: perm.vacuous,
    latencyP95Ms: percentile(latencies, 0.95),
  };
}

async function main(): Promise<void> {
  // The repo tsconfig excludes node's ambient types; read argv through
  // a guarded global instead of importing node:process.
  const argv: string[] =
    (globalThis as unknown as { process?: { argv?: string[] } }).process?.argv ?? [];
  const seedsArg = argv.find((a) => /^--seeds=\d+$/.test(a));
  const roundsArg = argv.find((a) => /^--rounds=\d+$/.test(a));
  const seeds = Number(seedsArg?.slice("--seeds=".length) ?? 5) || 5;
  const rounds = Number(roundsArg?.slice("--rounds=".length) ?? 12) || 12;

  const perDir = new Map<string, DirectionStats[]>();
  const taus: number[] = [];

  for (let seed = 1; seed <= seeds; seed++) {
    const population = makePopulation(seed);
    const gt = makeGroundTruth(population);
    taus.push(gt.threshold);

    const vecs = new Map<string, number[]>();
    for (const p of population.profiles) {
      vecs.set(p.id, await deriveEmbedding(p.bio));
    }
    const cos = (a: string, b: string): number | undefined => {
      const va = vecs.get(a);
      const vb = vecs.get(b);
      return va && vb ? cosineSim(va, vb) : undefined;
    };

    for (const spec of DIRECTIONS) {
      const stats = await runDirection(spec, population, gt, cos, seed, rounds);
      const acc = perDir.get(spec.name) ?? [];
      acc.push(stats);
      perDir.set(spec.name, acc);
    }
  }

  const rows: string[] = [];
  const failures: string[] = [];
  let allPass = true;

  for (const spec of DIRECTIONS) {
    const acc = perDir.get(spec.name) as DirectionStats[];
    const agg = {
      successRate: mean(acc.map((s) => s.successRate)),
      precisionAtTop: mean(acc.map((s) => s.precisionAtTop)),
      fatiguedP99: mean(acc.map((s) => s.fatiguedP99)),
      longTailP50: mean(acc.map((s) => s.longTailP50)),
      coverage: mean(acc.map((s) => s.coverage)),
      allocationWeightGap: mean(acc.map((s) => s.allocationWeightGap)),
      stabilityTop5: mean(acc.map((s) => s.stabilityTop5)),
      permissionMaxDelta: mean(acc.map((s) => s.permissionMaxDelta)),
      permissionViolations: mean(acc.map((s) => s.permissionViolations)),
      latencyP95Ms: mean(acc.map((s) => s.latencyP95Ms)),
    };
    const failed: string[] = [];
    if (agg.successRate < BARS.successRate) failed.push(`successRate >= ${BARS.successRate}`);
    if (agg.precisionAtTop < BARS.precisionAtTop) failed.push(`precisionAtTop >= ${BARS.precisionAtTop}`);
    if (agg.fatiguedP99 > BARS.fatiguedP99) failed.push(`fatiguedP99 <= ${BARS.fatiguedP99}`);
    if (agg.coverage < BARS.coverage) failed.push(`coverage >= ${BARS.coverage}`);
    if (agg.allocationWeightGap > BARS.allocationWeightGap) failed.push(`allocationWeightGap <= ${BARS.allocationWeightGap}`);
    if (agg.stabilityTop5 < BARS.stabilityTop5) failed.push(`stabilityTop5 >= ${BARS.stabilityTop5}`);
    if (agg.permissionViolations > BARS.permissionViolations) failed.push("permission: zero violations, non-vacuous control");
    if (failed.length > 0) allPass = false;
    failures.push(failed.length === 0 ? "PASS" : `FAIL — ${failed.join(", ")}`);

    rows.push(
      `| ${spec.name} | ${(agg.successRate * 100).toFixed(1)}% | ${(agg.precisionAtTop * 100).toFixed(1)}% | ${agg.fatiguedP99.toFixed(2)} | ${agg.longTailP50.toFixed(2)} | ${(agg.coverage * 100).toFixed(0)}% | ${(agg.allocationWeightGap * 100).toFixed(1)}% | ${agg.stabilityTop5.toFixed(2)} | ${agg.permissionMaxDelta.toFixed(4)} | ${agg.latencyP95Ms.toFixed(0)} |`,
    );
  }

  console.log(`# matching-eval results (seeds ${seeds}, ${rounds} rounds)\n`);
  console.log(`Ground-truth tau (mean): ${(mean(taus)).toFixed(4)}. allPass: ${allPass}\n`);
  console.log(
    "| direction | success | precision | fatigued p99 | long-tail p50 | coverage | alloc gap | stability | perm maxD | latency p95 ms |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const row of rows) console.log(row);
  console.log("");
  DIRECTIONS.forEach((spec, i) => {
    console.log(`- **${spec.name}**: ${failures[i]}`);
  });
}

main().catch((e) => {
  console.error(e);
  throw e;
});
