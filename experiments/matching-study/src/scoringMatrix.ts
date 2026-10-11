/**
 * Score-matrix helpers (pure). The engine's score for a pair is oriented:
 * user1 = FIFO-earlier entry, user2 = the scan partner. Matrices here are
 * indexed by FIFO order (creation time), so scores[i][j] with i<j matches the
 * engine's evaluation orientation exactly.
 */

import type { ReplicaEntry } from "./replica.js";
import { hasTimeOverlapReplica } from "./replica.js";

export interface MatrixBundle {
  /** scores[i][j] = score(user1=entry[i], user2=entry[j]) as the engine would evaluate it. */
  scores: number[][];
  /** overlap[i][j] = hasTimeOverlap(entry[i], entry[j]) (strict comparisons). */
  overlap: boolean[][];
  /** FIFO order entries (sorted by createdAt; Convex ids break ties). */
  entries: ReplicaEntry[];
}

export function buildMatrices(
  entries: ReplicaEntry[],
  scoreOf: (a: ReplicaEntry, b: ReplicaEntry) => number,
): MatrixBundle {
  const ordered = [...entries].sort(
    (a, b) => a.createdAt - b.createdAt || (a.queueId < b.queueId ? -1 : 1),
  );
  const n = ordered.length;
  const scores: number[][] = [];
  const overlap: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    scores.push(new Array<number>(n).fill(0));
    overlap.push(new Array<boolean>(n).fill(false));
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      overlap[i][j] = overlap[j][i] = hasTimeOverlapReplica(ordered[i], ordered[j]);
      if (overlap[i][j]) scores[i][j] = scores[j][i] = scoreOf(ordered[i], ordered[j]);
    }
  }
  return { scores, overlap, entries: ordered };
}

export interface InstancePairLite {
  i: number;
  j: number;
  score: number;
}

/** Instance-level deltas vs the exact reference. */
export interface ComparisonDelta {
  cardinalityGap: number; // exact.maxCardinality - engine.cardinality
  weightGap: number; // exactMaxCardWeight - engine.totalWeight
  unmatchedEligiblePairs: InstancePairLite[]; // eligible pairs with both endpoints unmatched
}

export function compareWithExact(
  enginePairs: Array<{ i: number; j: number; score: number }>,
  exact: { maxCardinality: number; maxWeightAtMaxCardinality: number },
  overlap: boolean[][],
  scores: number[][],
  minScore: number,
): ComparisonDelta {
  const engineUsed = new Set<number>();
  let engineWeight = 0;
  for (const p of enginePairs) {
    engineUsed.add(p.i);
    engineUsed.add(p.j);
    engineWeight += p.score;
  }
  const unmatchedEligiblePairs: InstancePairLite[] = [];
  for (let i = 0; i < overlap.length; i++) {
    for (let j = i + 1; j < overlap.length; j++) {
      if (overlap[i][j] && scores[i][j] > minScore && !engineUsed.has(i) && !engineUsed.has(j)) {
        unmatchedEligiblePairs.push({ i, j, score: scores[i][j] });
      }
    }
  }
  return {
    cardinalityGap: exact.maxCardinality - enginePairs.length,
    weightGap: exact.maxWeightAtMaxCardinality - engineWeight,
    unmatchedEligiblePairs,
  };
}
