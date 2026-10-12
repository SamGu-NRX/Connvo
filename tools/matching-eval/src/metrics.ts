/**
 * Metrics + the permission differential test, with two techniques from
 * the fleet studies (PRs #15/#19):
 *
 * 1. EXACT-REFERENCE ALLOCATION CHECK (from #15): a hand-written
 *    exhaustive pairing enumerator for small n over a given score
 *    matrix, deliberately independent of any queue/allocation logic,
 *    plus trivial greedy baselines. Reports the weight/cardinality gap
 *    a matcher's greedy selection leaves on the table.
 * 2. PLANTED-LEAK NEGATIVE CONTROL (from #19): a deliberately leaky
 *    scorer that reads withheld fields MUST be flagged by the
 *    differential test; if the control is not caught, the permission
 *    result is vacuous and fails.
 */

import { computeFeatures, NEUTRAL, weightedSum } from "./features";
import type {
  EvalProfile,
  FeatureKey,
  Population,
  SuggestedMatch,
} from "./types";
import { Rng } from "./rng";

export interface PairScored {
  a: EvalProfile;
  b: EvalProfile;
  features: Record<FeatureKey, number>;
  score: number;
  usedFields: string[];
}

/** Score every pair once per round. */
export function scoreAllPairs(
  population: Population,
  cos: (a: string, b: string) => number | undefined,
  weights: Record<FeatureKey, number>,
): PairScored[] {
  const out: PairScored[] = [];
  for (let i = 0; i < population.profiles.length; i++) {
    for (let j = i + 1; j < population.profiles.length; j++) {
      const a = population.profiles[i];
      const b = population.profiles[j];
      const { features, usedFields } = computeFeatures(
        a,
        b,
        cos(a.id, b.id),
      );
      out.push({ a, b, features, score: weightedSum(features, weights), usedFields });
    }
  }
  return out;
}

/** Greedy queue builder — mirrors convex/matching/queue.ts semantics. */
export function buildQueue(
  pairs: PairScored[],
  opts: { perUserCap: number; minScore: number },
): SuggestedMatch[] {
  const eligible = pairs
    .filter((p) => p.score > opts.minScore)
    .sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  const count = new Map<string, number>();
  const matches: SuggestedMatch[] = [];
  for (const p of eligible) {
    if ((count.get(p.a.id) ?? 0) >= opts.perUserCap) continue;
    if ((count.get(p.b.id) ?? 0) >= opts.perUserCap) continue;
    count.set(p.a.id, (count.get(p.a.id) ?? 0) + 1);
    count.set(p.b.id, (count.get(p.b.id) ?? 0) + 1);
    matches.push({ userA: p.a.id, userB: p.b.id, score: p.score, reasons: [] });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Exact-reference allocation (independent implementation, #15 technique)
// ---------------------------------------------------------------------------

/** Max-weight matching by exhaustive recursion over a score matrix. */
export function exactMaxWeight(
  ids: string[],
  w: Map<string, number>,
): { cardinality: number; weight: number } {
  const n = ids.length;
  const used = new Array<boolean>(n).fill(false);
  let best = { cardinality: 0, weight: 0 };
  const rec = (i: number, card: number, weight: number): void => {
    if (weight > best.weight || (weight === best.weight && card > best.cardinality)) {
      best = { cardinality: card, weight };
    }
    if (i >= n) return;
    // Bound: even taking all remaining weight cannot beat best.
    rec(i + 1, card, weight);
    if (!used[i]) {
      for (let j = i + 1; j < n; j++) {
        if (used[j]) continue;
        const key = `${ids[i]}|${ids[j]}`;
        const val = w.get(key);
        if (val === undefined) continue;
        used[i] = true;
        used[j] = true;
        rec(i + 1, card + 1, weight + val);
        used[i] = false;
        used[j] = false;
      }
    }
  };
  rec(0, 0, 0);
  return best;
}

export interface AllocationCheck {
  n: number;
  greedy: { cardinality: number; weight: number };
  exact: { cardinality: number; weight: number };
  weightGap: number; // (exact - greedy) / max(exact, 1e-9)
  cardinalityGap: number;
}

/** Compare greedy queue construction against the exact optimum on a
 *  random n<=8 subset, scored with the given weights. */
export function allocationCheckAtN8(
  population: Population,
  cos: (a: string, b: string) => number | undefined,
  weights: Record<FeatureKey, number>,
  rng: Rng,
  n = 8,
): AllocationCheck {
  const subset: EvalProfile[] = rng.sample(population.profiles, n);
  const ids = subset.map((p) => p.id);
  const w = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { features } = computeFeatures(subset[i], subset[j], cos(ids[i], ids[j]));
      w.set(`${ids[i]}|${ids[j]}`, weightedSum(features, weights));
    }
  }
  const greedyPairs = buildQueue(
    subset.flatMap((a, i) =>
      subset.slice(i + 1).map((b) => ({
        a, b,
        features: {} as Record<FeatureKey, number>,
        score: w.get(`${a.id}|${b.id}`) as number,
        usedFields: [],
      })),
    ),
    { perUserCap: 1, minScore: 0 },
  );
  const greedyWeight = greedyPairs.reduce((acc, m) => acc + m.score, 0);
  const exact = exactMaxWeight(ids, w);
  return {
    n,
    greedy: { cardinality: greedyPairs.length, weight: greedyWeight },
    exact,
    weightGap: exact.weight === 0 ? 0 : (exact.weight - greedyWeight) / exact.weight,
    cardinalityGap: exact.cardinality - greedyPairs.length,
  };
}

// ---------------------------------------------------------------------------
// Permission differential (#19 negative-control technique)
// Value-permutation semantics: a compliant scorer must not depend on the
// VALUES of fields a subject withheld.
// ---------------------------------------------------------------------------

export interface PermissionResult {
  /** Max |score(permuted) - score(original)| over sampled pairs. */
  maxDelta: number;
  /** Pairs exceeding the tolerance (empty when compliant). */
  violations: number;
  /** Negative control: leaky scorer caught? */
  leakyCaught: boolean;
  vacuous: boolean;
}

/**
 * A deliberately leaky scorer: directly reads experience/industry/
 * timezone/org whether or not permitted. Used ONLY as a negative
 * control to prove the differential test can catch violations.
 */
function leakyScore(a: EvalProfile, b: EvalProfile): number {
  const exp = Math.abs((a.experienceYears ?? 0) - (b.experienceYears ?? 0));
  const ind = a.industry === b.industry ? 1 : 0;
  const tz = Math.max(0, 1 - Math.abs((a.timezoneOffset ?? 0) - (b.timezoneOffset ?? 0)) / 10);
  const org = a.orgId !== undefined && a.orgId === b.orgId ? 1 : 0;
  return 0.25 * (exp / 20) + 0.25 * ind + 0.25 * tz + 0.25 * org;
}

/** Field-value pools sampled when randomizing withheld data. */
export interface FieldPools {
  experience: number[];
  industry: string[];
  timezone: number[];
  organization: string[];
}

const DEFAULT_POOLS: FieldPools = {
  experience: [-2, 1, 3, 6, 9, 14, 22],
  industry: ["software", "fintech", "healthcare", "education", "climate"],
  timezone: [-8, -5, 0, 1, 5.5, 9],
  organization: ["org-0", "org-1", "org-2", "org-3", "org-4", "org-5"],
};

const permitsField = (p: EvalProfile, f: string): boolean =>
  p.permittedFields.includes(f as EvalProfile["permittedFields"][number]);

function permuteProfile(
  p: EvalProfile,
  pools: FieldPools,
  rng: Rng,
): EvalProfile {
  // Only withheld fields move; permitted values must stay (the score
  // may legitimately depend on those).
  return {
    ...p,
    experienceYears: permitsField(p, "experience")
      ? p.experienceYears
      : rng.pick(pools.experience),
    industry: permitsField(p, "industry") ? p.industry : rng.pick(pools.industry),
    timezoneOffset: permitsField(p, "timezone")
      ? p.timezoneOffset
      : rng.pick(pools.timezone),
    orgId: permitsField(p, "organization") ? p.orgId : rng.pick(pools.organization),
  };
}

/**
 * Permission differential, value-permutation semantics: for each
 * sampled pair, randomize every WITHHELD field's stored value and
 * re-score. A compliant scorer's features depend only on permitted
 * values (withheld inputs collapse to the neutral constant), so its
 * score must be invariant; any movement is a leak. The leaky control
 * reads stored values directly and MUST move; if it does not, the
 * test is vacuous and fails.
 */
export function permissionDifferential(
  population: Population,
  cos: (a: string, b: string) => number | undefined,
  scoreFn: (a: EvalProfile, b: EvalProfile) => number,
  tol = 1e-9,
  pools: FieldPools = DEFAULT_POOLS,
): PermissionResult {
  const rng = new Rng(1234);
  let violations = 0;
  let maxDelta = 0;
  const sample = rng.sample(population.profiles, 60);
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const a = sample[i];
      const b = sample[j];
      const s0 = scoreFn(a, b);
      const s1 = scoreFn(
        permuteProfile(a, pools, rng),
        permuteProfile(b, pools, rng),
      );
      const d = Math.abs(s0 - s1);
      if (d > maxDelta) maxDelta = d;
      if (d > tol) violations++;
    }
  }
  // Negative control with an independent stream.
  const rng2 = new Rng(5678);
  let leakyMoved = false;
  for (let i = 0; i < sample.length && !leakyMoved; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const a = sample[i];
      const b = sample[j];
      const s0 = leakyScore(a, b);
      const s1 = leakyScore(
        permuteProfile(a, pools, rng2),
        permuteProfile(b, pools, rng2),
      );
      if (s0 !== s1) {
        leakyMoved = true;
        break;
      }
    }
  }
  return { maxDelta, violations, leakyCaught: leakyMoved, vacuous: !leakyMoved };
}

// ---------------------------------------------------------------------------
// Population-level metrics
// ---------------------------------------------------------------------------

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, x) => a + x, 0) / xs.length;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export interface HeadlineMetrics {
  successRate: number;
  precisionAtK: number;
  fatiguedP99: number;
  longTailP50: number;
  permissionMaxDelta: number;
  allocationWeightGap: number;
  stabilityTop5Overlap: number;
  latencyP95Ms: number;
}

export function metricsFromOutcomes(
  outcomes: Array<{ outcome: string }>,
): { completed: number; accepted: number; total: number } {
  const total = outcomes.length;
  const accepted = outcomes.filter((o) => o.outcome !== "declined").length;
  const completed = outcomes.filter((o) => o.outcome === "completed").length;
  return { completed, accepted, total };
}

export { computeFeatures, NEUTRAL, weightedSum };
