/**
 * Offline weight fitting for the tuned-weights direction (README §tuned).
 *
 * Coordinate ascent over the eight feature weights. Objective: precision
 * of the top-1500 global selection (the per-user-cap greedy takes
 * roughly 1500 matches at cap 3 over 700 users) — P(G > tau | selected)
 * on two fit seeds. This is deliberately eval-aware: the tuned
 * direction measures how much weight quality alone buys over Sam's
 * defaults. Fitted weights are FROZEN into matchers.ts constants so
 * runs stay deterministic and replayable.
 *
 * Performance: pair features are materialized ONCE into typed arrays;
 * each objective is a dot product + argsort top-K over a Float64Array —
 * no per-eval pair objects.
 *
 * Usage: npx tsx tools/matching-eval/src/fit-weights.ts
 */

import { makePopulation } from "./population";
import { makeGroundTruth } from "./ground-truth";
import { deriveEmbedding } from "./embeddings";
import { cosineSim, computeFeatures, SAM_DEFAULT_WEIGHTS } from "./features";
import type { EvalProfile, FeatureKey } from "./types";

const KEYS: FeatureKey[] = [
  "interestOverlap", "vectorSimilarity", "experienceGap", "industryMatch",
  "timezoneCompatibility", "languageOverlap", "orgPreferenceFit", "roleComplementarity",
];

interface Prepared {
  /** Feature columns, one Float64Array per key, indexed by pair index. */
  cols: Record<FeatureKey, Float64Array>;
  /** Deterministic ground truth per pair index. */
  g: Float64Array;
  tau: number;
  nPairs: number;
}

async function prepare(seed: number): Promise<Prepared> {
  const population = makePopulation(1000 + seed, 700);
  const gt = makeGroundTruth(population);

  const vecs = new Map<string, number[]>();
  for (const p of population.profiles) vecs.set(p.id, await deriveEmbedding(p.bio));
  const cos = (a: string, b: string): number | undefined => {
    const va = vecs.get(a);
    const vb = vecs.get(b);
    return va && vb ? cosineSim(va, vb) : undefined;
  };

  const n = population.profiles.length;
  const nPairs = (n * (n - 1)) / 2;
  const cols = {} as Record<FeatureKey, Float64Array>;
  for (const k of KEYS) cols[k] = new Float64Array(nPairs);
  const g = new Float64Array(nPairs);

  let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = population.profiles[i] as EvalProfile;
    const la = population.latents[i];
    for (let j = i + 1; j < n; j++) {
      const b = population.profiles[j] as EvalProfile;
      const lb = population.latents[j];
      if (!la || !lb) continue;
      const { features } = computeFeatures(a, b, cos(a.id, b.id));
      for (const k of KEYS) (cols[k] as Float64Array)[idx] = features[k];
      g[idx] = gt.deterministic(a, b, la, lb);
      idx++;
    }
  }

  return { cols, g, tau: gt.threshold, nPairs: idx };
}

function precisionOf(prep: Prepared, weights: Record<FeatureKey, number>): number {
  const w = KEYS.map((k) => weights[k]);
  const scores = new Float64Array(prep.nPairs);
  for (let i = 0; i < prep.nPairs; i++) {
    let s = 0;
    for (let k = 0; k < KEYS.length; k++) {
      s += (w[k] as number) * (prep.cols[KEYS[k] as FeatureKey] as Float64Array)[i];
    }
    scores[i] = s;
  }
  // NOTE: Array.from(number) yields an EMPTY array (a number has no
  // `length`) — the selection would compare nothing. Pass an array-like.
  const order = Array.from({ length: prep.nPairs }, (_, i) => i);
  order.sort((a, b) => (scores[b] as number) - (scores[a] as number));
  const topK = Math.min(1500, prep.nPairs);
  let hits = 0;
  for (let i = 0; i < topK; i++) {
    if ((prep.g[order[i] as number] as number) > prep.tau) hits++;
  }
  return hits / topK;
}

async function main(): Promise<void> {
  const preps: Prepared[] = [];
  for (const s of [1, 2]) preps.push(await prepare(s));

  const weights: Record<FeatureKey, number> = { ...SAM_DEFAULT_WEIGHTS };
  const objective = (): number =>
    preps.reduce((acc, p) => acc + precisionOf(p, weights), 0) / preps.length;

  let best = objective();
  console.log(`start precision=${best.toFixed(4)} (Sam defaults)`);

  const steps = [-0.08, -0.04, -0.02, -0.01, 0.01, 0.02, 0.04, 0.08];
  for (let iter = 0; iter < 8; iter++) {
    let improved = false;
    for (const k of KEYS) {
      const orig = weights[k] as number;
      let bestStep = 0;
      for (const st of steps) {
        const v = Math.max(0, orig + st);
        if (v === orig) continue;
        weights[k] = v;
        const obj = objective();
        if (obj > best + 1e-5) {
          best = obj;
          bestStep = v - orig;
        }
      }
      weights[k] = Math.max(0, orig + bestStep);
      if (bestStep !== 0) improved = true;
    }
    const sum = KEYS.reduce((a, k) => a + (weights[k] as number), 0);
    for (const k of KEYS) weights[k] = Math.round(((weights[k] as number) / sum) * 1000) / 1000;
    console.log(`iter ${iter}: precision=${best.toFixed(4)} weights=${JSON.stringify(weights)}`);
    if (!improved) break;
  }

  console.log("\n// Frozen fitted weights (fit-weights.ts, seeds 1-2):");
  console.log("export const TUNED_WEIGHTS: Record<FeatureKey, number> = {");
  for (const k of KEYS) console.log(`  ${k}: ${weights[k]},`);
  console.log("};");
}

main().catch((e) => {
  console.error(e);
  throw e;
});
