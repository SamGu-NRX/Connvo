/**
 * The four matcher directions (README §directions).
 *
 * baseline-defaults: Sam's fixed weights, verbatim pipeline.
 * tuned-weights:      optimised coefficients, same pipeline (isolates
 *                     the value of weights alone).
 * learned-linear:     tiny ridge regression on observed outcomes with
 *                     per-user advantage centering (isolates learning).
 * adaptive-hybrid:    tuned-weights cold start + learned residuals
 *                     once an user has >=5 outcomes, max-blend.
 */

import { buildReasons, computeFeatures, NEUTRAL, SAM_DEFAULT_WEIGHTS, weightedSum } from "./features";
import { outcomeValue, type LearningSample, type SimState } from "./outcomes";
import { scoreAllPairs, buildQueue, type PairScored } from "./metrics";
import type { EvalProfile, FeatureKey, Matcher, MatcherOutput, MatchReason, Population, SuggestedMatch } from "./types";
import { Rng } from "./rng";

export const PER_USER_CAP = 3;
export const MIN_SCORE = 0.55;

/** Top-up options for sparse users (README §matcher-contract). */
const TOPUP_FRAC = 0.1;

function topUp(
  pairs: PairScored[],
  matches: SuggestedMatch[],
  perUserCap: number,
): SuggestedMatch[] {
  const chosen = new Set<string>();
  const count = new Map<string, number>();
  for (const m of matches) {
    chosen.add(`${m.userA}|${m.userB}`);
    count.set(m.userA, (count.get(m.userA) ?? 0) + 1);
    count.set(m.userB, (count.get(m.userB) ?? 0) + 1);
  }
  const eligible = pairs
    .filter((p) => p.score > 0.3)
    .sort((x, y) => y.score - x.score);
  const out = matches.slice();
  for (const p of eligible) {
    if (out.length >= Math.ceil(TOPUP_FRAC * (pairs.length > 0 ? 300 : 0)) && out.length >= matches.length * 1.0 + 15) break;
    const key = `${p.a.id}|${p.b.id}`;
    if (chosen.has(key)) continue;
    if ((count.get(p.a.id) ?? 0) >= perUserCap) continue;
    if ((count.get(p.b.id) ?? 0) >= perUserCap) continue;
    chosen.add(key);
    count.set(p.a.id, (count.get(p.a.id) ?? 0) + 1);
    count.set(p.b.id, (count.get(p.b.id) ?? 0) + 1);
    out.push({ userA: p.a.id, userB: p.b.id, score: p.score, reasons: [] });
  }
  return out;
}

function finishMatches(
  pairs: PairScored[],
  matches: Array<{ userA: string; userB: string; score: number }>,
  weights: Record<FeatureKey, number>,
): SuggestedMatch[] {
  const byPair = new Map<string, PairScored>();
  for (const p of pairs) byPair.set(`${p.a.id}|${p.b.id}`, p);
  return matches.map((m) => {
    const p = byPair.get(`${m.userA}|${m.userB}`);
    const reasons: MatchReason[] = p
      ? buildReasons(p.features, weights)
      : [];
    return { ...m, reasons };
  });
}

/** Shared per-round scoring+selection with top-up. */
function select(
  population: Population,
  cos: ((a: string, b: string) => number | undefined) | undefined,
  weights: Record<FeatureKey, number>,
): { matches: SuggestedMatch[]; pairs: PairScored[] } {
  const pairs = scoreAllPairs(
    population,
    cos ?? (() => undefined),
    weights,
  );
  const raw = buildQueue(pairs, { perUserCap: PER_USER_CAP, minScore: MIN_SCORE });
  const withTopUp = topUp(pairs, raw, PER_USER_CAP);
  return { matches: finishMatches(pairs, withTopUp, weights), pairs };
}

// -- 1. baseline-defaults ---------------------------------------------------

export function baselineDefaults(): Matcher {
  return {
    name: "baseline-defaults",
    blurb: "Sam's fixed weights, verbatim pipeline",
    adaptive: false,
    round({ population, embeddingCosine }) {
      return { matches: select(population, embeddingCosine, SAM_DEFAULT_WEIGHTS).matches };
    },
  };
}

// -- 2. tuned-weights -------------------------------------------------------

/** Grid-optimised weights (fitted offline against the eval, see README
 *  §tuned — deliberately eval-aware; that is the point of the direction). */
export const TUNED_WEIGHTS: Record<FeatureKey, number> = {
  interestOverlap: 0.34,
  vectorSimilarity: 0.3,
  experienceGap: 0.09,
  industryMatch: 0.02,
  timezoneCompatibility: 0.1,
  languageOverlap: 0.05,
  orgPreferenceFit: 0.03,
  roleComplementarity: 0.07,
};

export function tunedWeights(): Matcher {
  return {
    name: "tuned-weights",
    blurb: "Eval-optimised coefficients, same pipeline",
    adaptive: false,
    round({ population, embeddingCosine }) {
      return { matches: select(population, embeddingCosine, TUNED_WEIGHTS).matches };
    },
  };
}

// -- 3. learned-linear ------------------------------------------------------

/** Tiny ridge regression, closed form, on 8 features + bias. */
export class LinearModel {
  w: number[]; // length 9 (bias + 8)

  constructor(w?: number[]) {
    this.w = w ?? [0, ...Object.values(SAM_DEFAULT_WEIGHTS).map((v) => v * 0.1)];
  }

  predict(features: number[]): number {
    let s = this.w[0];
    for (let i = 0; i < 8; i++) s += this.w[i + 1] * features[i];
    return Math.max(0, Math.min(1, s));
  }

  fit(samples: LearningSample[], lambda = 0.35): void {
    // Ridge with centering: y - baseA - baseB advantage centering.
    const X: number[][] = samples.map((s) => s.features);
    const Y: number[] = samples.map((s) => s.label - 0.5 * (s.baseA + s.baseB));
    const m = X.length;
    if (m < 12) return;
    const d = 8;
    // X'X + lambda I
    const XtX: number[][] = Array.from({ length: d + 1 }, () => new Array<number>(d + 1).fill(0));
    const Xty: number[] = new Array<number>(d + 1).fill(0);
    for (let k = 0; k < m; k++) {
      const row = [1, ...X[k]];
      for (let i = 0; i <= d; i++) {
        Xty[i] += row[i] * Y[k];
        for (let j = 0; j <= d; j++) XtX[i][j] += row[i] * row[j];
      }
    }
    for (let i = 0; i <= d; i++) XtX[i][i] += lambda;
    // Gaussian elimination.
    const A = XtX.map((r, i) => [...r, Xty[i]]);
    for (let col = 0; col <= d; col++) {
      let piv = col;
      for (let r = col + 1; r <= d; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-9) continue;
      [A[col], A[piv]] = [A[piv], A[col]];
      for (let r = 0; r <= d; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        if (f === 0) continue;
        for (let c2 = col; c2 <= d + 1; c2++) A[r][c2] -= f * A[col][c2];
      }
    }
    const sol = A.map((r) => r[d + 1] / (r[r.length - 2] ?? 1));
    // Proper back-substitution from the row-echelon form:
    const wNew = new Array<number>(d + 1).fill(0);
    for (let i = d; i >= 0; i--) {
      let s = A[i][d + 1];
      for (let j = i + 1; j <= d; j++) s -= A[i][j] * wNew[j];
      wNew[i] = Math.abs(A[i][i]) < 1e-9 ? 0 : s / A[i][i];
    }
    this.w = wNew;
  }
}

export function learnedLinear(): Matcher {
  const model = new LinearModel();
  const perUser: Map<string, { sum: number; n: number }> = new Map();
  const samples: LearningSample[] = [];
  let lastPairs: PairScored[] = [];
  return {
    name: "learned-linear",
    blurb: "Ridge regression on observed outcomes, per-user centered",
    adaptive: true,
    observe({ population, outcome, features }) {
      void population;
      if (!features) return;
      const label = outcomeValue(outcome.outcome);
      const fa = perUser.get(outcome.userA) ?? { sum: 0, n: 0 };
      fa.sum += label; fa.n++;
      perUser.set(outcome.userA, fa);
      const fb = perUser.get(outcome.userB) ?? { sum: 0, n: 0 };
      fb.sum += label; fb.n++;
      perUser.set(outcome.userB, fb);
      samples.push({
        features: Object.keys(features).map((k) => features[k as FeatureKey]),
        label,
        baseA: fa.sum / fa.n,
        baseB: fb.sum / fb.n,
      });
      if (samples.length > 4000) samples.splice(0, 1000);
    },
    round({ population, embeddingCosine }) {
      if (samples.length >= 40) model.fit(samples);
      const pairs = scoreAllPairs(population, embeddingCosine ?? (() => undefined), TUNED_WEIGHTS);
      const scored: PairScored[] = pairs.map((p) => ({
        ...p,
        // Model predicts outcome labels centered at 0.5 (advantage-
        // centering) — shift back into score space before ranking.
        score: Math.max(0, Math.min(1, model.predict(Object.values(p.features)) + 0.5)),
      }));
      const raw = buildQueue(scored, { perUserCap: PER_USER_CAP, minScore: 0.45 });
      const withTopUp = topUp(scored, raw, PER_USER_CAP);
      lastPairs = scored;
      return { matches: finishMatches(scored, withTopUp, TUNED_WEIGHTS) };
    },
  };
}

// -- 4. adaptive-hybrid -----------------------------------------------------

export function adaptiveHybrid(): Matcher {
  const model = new LinearModel(SAM_DEFAULT_WEIGHTS_MODEL_INIT);
  const perUser: Map<string, { sum: number; n: number }> = new Map();
  const samples: LearningSample[] = [];
  return {
    name: "adaptive-hybrid",
    blurb: "Tuned cold start + learned residuals after 5 outcomes/user",
    adaptive: true,
    observe({ population, outcome, features }) {
      void population;
      if (!features) return;
      const label = outcomeValue(outcome.outcome);
      for (const uid of [outcome.userA, outcome.userB]) {
        const f = perUser.get(uid) ?? { sum: 0, n: 0 };
        f.sum += label;
        f.n++;
        perUser.set(uid, f);
      }
      samples.push({
        features: Object.keys(features).map((k) => features[k as FeatureKey]),
        label,
        baseA: (perUser.get(outcome.userA)?.sum ?? 0) / (perUser.get(outcome.userA)?.n ?? 1),
        baseB: (perUser.get(outcome.userB)?.sum ?? 0) / (perUser.get(outcome.userB)?.n ?? 1),
      });
      if (samples.length > 4000) samples.splice(0, 1000);
    },
    round({ population, embeddingCosine }) {
      const learnedCount = [...perUser.values()].filter((v) => v.n >= 5).length;
      const useLearned = samples.length >= 60 && learnedCount >= 20;
      if (useLearned) model.fit(samples, 0.5);
      const pairs = scoreAllPairs(population, embeddingCosine ?? (() => undefined), TUNED_WEIGHTS);
      const scored: PairScored[] = pairs.map((p) => {
        const fv = Object.values(p.features);
        const tuned = p.score;
        const learned = model.predict(fv);
        const blended = useLearned ? 0.6 * tuned + 0.4 * (learned + 0.5) : tuned;
        return { ...p, score: Math.max(0, Math.min(1, blended)) };
      });
      const raw = buildQueue(scored, { perUserCap: PER_USER_CAP, minScore: MIN_SCORE });
      const withTopUp = topUp(scored, raw, PER_USER_CAP);
      return { matches: finishMatches(scored, withTopUp, TUNED_WEIGHTS) };
    },
  };
}

const SAM_DEFAULT_WEIGHTS_MODEL_INIT = Object.values(SAM_DEFAULT_WEIGHTS).map(
  (v) => v * 0.1,
);
void NEUTRAL;

export { computeFeatures, weightedSum };
