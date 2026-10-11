/**
 * Seeded greedy baselines over the same score matrix and eligibility rules —
 * deliberately independent of engine code. These contextualize the engine's
 * allocation quality: if the engine's numbers trail even simple baselines,
 * that is an avoidable-weakness signal.
 */

import { mulberry32 } from "./rng.js";
import type { InstancePair } from "./exactReference.js";

export type OverlapFn = (i: number, j: number) => boolean;
export type ScoreFn = (i: number, j: number) => number; // oriented i<j

export interface BaselineResult {
  name: string;
  pairs: InstancePair[];
  cardinality: number;
  totalWeight: number;
}

function eligiblePairs(n: number, overlap: OverlapFn, score: ScoreFn, minScore: number): InstancePair[] {
  const pairs: InstancePair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlap(i, j) && score(i, j) > minScore) pairs.push({ i, j, score: score(i, j) });
    }
  }
  return pairs;
}

function summarize(name: string, chosen: InstancePair[]): BaselineResult {
  return {
    name,
    pairs: chosen,
    cardinality: chosen.length,
    totalWeight: chosen.reduce((s, p) => s + p.score, 0),
  };
}

/** Greedy by score descending: take highest-score eligible pairs first. */
export function greedyByScoreDesc(
  n: number,
  overlap: OverlapFn,
  score: ScoreFn,
  minScore: number,
): BaselineResult {
  const pairs = eligiblePairs(n, overlap, score, minScore).sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  const chosen: InstancePair[] = [];
  for (const p of pairs) {
    if (used.has(p.i) || used.has(p.j)) continue;
    used.add(p.i);
    used.add(p.j);
    chosen.push(p);
  }
  return summarize("greedy-score-desc", chosen);
}

/** FIFO greedy: earlier arrivals take their best available partner (engine-like order). */
export function greedyFifo(
  n: number,
  overlap: OverlapFn,
  score: ScoreFn,
  minScore: number,
): BaselineResult {
  const used = new Set<number>();
  const chosen: InstancePair[] = [];
  for (let i = 0; i < n; i++) {
    if (used.has(i)) continue;
    let best: { j: number; s: number } | null = null;
    let bestScore = minScore; // strict >, mirroring the engine boundary
    for (let j = i + 1; j < n; j++) {
      if (used.has(j) || !overlap(i, j)) continue;
      const s = score(i, j);
      if (s > bestScore) {
        best = { j, s };
        bestScore = s;
      }
    }
    if (best) {
      used.add(i);
      used.add(best.j);
      chosen.push({ i, j: best.j, score: best.s });
    }
  }
  return summarize("greedy-fifo", chosen);
}

/** Random-order greedy, seeded; run 20 times and report each draw plus the best. */
export function greedyRandomOrder(
  n: number,
  overlap: OverlapFn,
  score: ScoreFn,
  minScore: number,
  seed: number,
  runs = 20,
): { runs: BaselineResult[]; best: BaselineResult } {
  const out: BaselineResult[] = [];
  for (let r = 0; r < runs; r++) {
    const rng = mulberry32((seed + r * 2654435761) >>> 0);
    const order = Array.from({ length: n }, (_, k) => k);
    for (let k = n - 1; k > 0; k--) {
      const m = Math.floor(rng() * (k + 1));
      [order[k], order[m]] = [order[m], order[k]];
    }
    const used = new Set<number>();
    const chosen: InstancePair[] = [];
    for (const i of order) {
      if (used.has(i)) continue;
      let best: { j: number; s: number } | null = null;
      let bestScore = minScore;
      const partners = Array.from({ length: n }, (_, k) => k)
        .filter((j) => j !== i && !used.has(j) && overlap(Math.min(i, j), Math.max(i, j)));
      for (const j of partners) {
        const s = score(Math.min(i, j), Math.max(i, j));
        if (s > bestScore) {
          best = { j, s };
          bestScore = s;
        }
      }
      if (best) {
        used.add(i);
        used.add(best.j);
        chosen.push({ i: Math.min(i, best.j), j: Math.max(i, best.j), score: best.s });
      }
    }
    out.push(summarize(`greedy-random-${r}`, chosen));
  }
  const best = out.reduce((a, b) =>
    b.cardinality > a.cardinality ||
    (b.cardinality === a.cardinality && b.totalWeight > a.totalWeight)
      ? b
      : a,
  );
  return { runs: out, best };
}
