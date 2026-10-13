/**
 * Independent exact reference for small instances (n <= 8).
 *
 * A hand-written exhaustive enumerator over the pair-score matrix —
 * deliberately NOT reusing any engine logic. Computes maximum-cardinality and
 * maximum-weight matchings under the engine's eligibility rules (time-window
 * overlap and score strictly greater than minScore).
 *
 * Enumeration is bitmask DP over users: for each mask, either leave the
 * lowest-indexed user unmatched or pair them with any eligible partner.
 */

export interface InstancePair {
  i: number;
  j: number;
  score: number;
}

export interface ExactReference {
  n: number;
  eligiblePairs: InstancePair[];
  maxCardinality: number;
  maxWeight: number;
  /** Maximum total weight among maximum-cardinality matchings. */
  maxWeightAtMaxCardinality: number;
  /** One optimal max-cardinality matching (for counterexample artifacts). */
  exampleMatching: InstancePair[];
}

export function exactReference(
  n: number,
  scores: number[][], // scores[i][j] = engine score for pair (i, j) with i FIFO-earlier
  overlap: (i: number, j: number) => boolean,
  minScore: number,
): ExactReference {
  const eligible: InstancePair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlap(i, j) && scores[i][j] > minScore) {
        eligible.push({ i, j, score: scores[i][j] });
      }
    }
  }

  const size = 1 << n;
  // card[mask]: max matching cardinality within mask.
  const card = new Int16Array(size);
  // weight[mask]: max weight among matchings of card[mask].
  const weight = new Float64Array(size);
  // freeWeight[mask]: max weight over ALL matchings (any cardinality).
  const freeWeight = new Float64Array(size);
  // choice[mask]: partner chosen for the lowest set bit (-1 = leave unmatched).
  const choice = new Int16Array(size).fill(-1);

  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const u = 31 - Math.clz32(low);
    // Option 1: leave u unmatched.
    const restWithoutU = mask ^ low;
    let bestCard = card[restWithoutU];
    let bestWeight = weight[restWithoutU];
    let bestChoice = -1;
    // Option 2: pair u with some eligible v in mask.
    for (const pair of eligible) {
      if (pair.i !== u) continue; // u is the lowest bit; partner must be > u
      const bitV = 1 << pair.j;
      if (!(mask & bitV)) continue;
      const rest = (mask ^ low) ^ bitV;
      const candCard = 1 + card[rest];
      const candWeight = pair.score + weight[rest];
      if (candCard > bestCard || (candCard === bestCard && candWeight > bestWeight)) {
        bestCard = candCard;
        bestWeight = candWeight;
        bestChoice = pair.j;
      }
    }
    card[mask] = bestCard;
    weight[mask] = bestWeight;
    choice[mask] = bestChoice;
    freeWeight[mask] = Math.max(freeWeight[restWithoutU], ...eligible
      .filter((p) => p.i === u && mask & (1 << p.j))
      .map((p) => p.score + freeWeight[(mask ^ low) ^ (1 << p.j)]));
  }

  // Reconstruct an optimal matching for the full mask.
  const exampleMatching: InstancePair[] = [];
  let mask = size - 1;
  while (mask > 0) {
    const low = mask & -mask;
    const u = 31 - Math.clz32(low);
    const partner = choice[mask];
    if (partner >= 0 && mask & (1 << partner)) {
      exampleMatching.push({ i: u, j: partner, score: scores[u][partner] });
      mask = (mask ^ low) ^ (1 << partner);
    } else {
      mask ^= low;
    }
  }

  return {
    n,
    eligiblePairs: eligible,
    maxCardinality: card[size - 1],
    maxWeight: freeWeight[size - 1],
    maxWeightAtMaxCardinality: weight[size - 1],
    exampleMatching,
  };
}
