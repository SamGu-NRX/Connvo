/**
 * Engine replica: a study-side mirror of the engine's greedy control flow
 * (convex/matching/engine.ts processMatchingShard + getShardQueueEntries).
 *
 * Deliberately re-implemented from the published behavior — NOT imported from
 * the engine — so it can run against a cached score matrix and predict pair
 * choices for observability. Divergence between replica predictions and the
 * engine's actual db outcomes is itself a measured signal (commit failures,
 * races); any such divergence is recorded in failure traces.
 */

import { stringHash32 } from "./rng.js";

export interface ReplicaEntry {
  queueId: string;
  userId: string;
  availableFrom: number;
  availableTo: number;
  createdAt: number;
}

/** Mirrors engine.ts hashUserId: 32-bit string hash, Math.abs'd. */
export function hashUserIdReplica(userId: string): number {
  return stringHash32(userId);
}

export function shardOf(userId: string, shardCount: number): number {
  return hashUserIdReplica(userId) % shardCount;
}

/** Mirrors engine.ts hasTimeOverlap: strict comparisons (touching = no overlap). */
export function hasTimeOverlapReplica(a: ReplicaEntry, b: ReplicaEntry): boolean {
  return a.availableFrom < b.availableTo && b.availableFrom < a.availableTo;
}

export interface CycleOptions {
  shardCount: number;
  minScore: number;
  maxMatches: number;
  nowMs: number;
}

export interface ReplicaDecision {
  user1: string; // userId
  user2: string;
  queue1: string;
  queue2: string;
  /** Pair score from the engine matrix when cached (quality), else null (load scale). */
  score: number | null;
  shard: number;
}

export interface ReplicaCycleOutput {
  decisions: ReplicaDecision[];
  /** Entries considered per shard after FIFO cap (scan-set sizes). */
  scannedPerShard: number[];
  /** Score evaluations performed by the greedy scan (replica-derived). */
  scoredPairs: number;
  /** FIFO cap per shard = 2 * ceil(maxMatches / shardCount). */
  fifoCapPerShard: number;
  /** Entries in the availability window, per shard, before the cap. */
  eligiblePerShard: number[];
}

/**
 * Predicts one engine cycle over the given waiting entries using the cached
 * score matrix. scoreOf must reflect the engine's call orientation:
 * user1 = the FIFO-earlier entry.
 */
export function predictCycle(
  entries: ReplicaEntry[],
  opts: CycleOptions,
  scoreOf: (a: ReplicaEntry, b: ReplicaEntry) => number,
): ReplicaCycleOutput {
  // getShardQueueEntries: collect ALL waiting entries, filter in memory by
  // availability window (availableFrom <= now+1h, availableTo > now), shard
  // by hash, FIFO sort, cap.
  const inWindow = entries.filter(
    (e) => e.availableFrom <= opts.nowMs + 3600000 && e.availableTo > opts.nowMs,
  );
  const fifoCapPerShard = 2 * Math.ceil(opts.maxMatches / opts.shardCount);

  const decisions: ReplicaDecision[] = [];
  const scannedPerShard: number[] = [];
  let scoredPairs = 0;
  const eligiblePerShard: number[] = [];

  for (let shard = 0; shard < opts.shardCount; shard++) {
    const shardEntries = inWindow
      .filter((e) => shardOf(e.userId, opts.shardCount) === shard)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, fifoCapPerShard);
    eligiblePerShard.push(
      inWindow.filter((e) => shardOf(e.userId, opts.shardCount) === shard).length,
    );
    scannedPerShard.push(shardEntries.length);

    const processed = new Set<string>();
    const maxMatchesPerShard = Math.ceil(opts.maxMatches / opts.shardCount);
    let matchCount = 0;

    for (let i = 0; i < shardEntries.length && matchCount < maxMatchesPerShard; i++) {
      const user1 = shardEntries[i];
      if (processed.has(user1.userId)) continue;

      let best: { partner: ReplicaEntry; score: number } | null = null;
      let bestScore = opts.minScore; // mirrors engine: init to minScore, strict >

      for (let j = i + 1; j < shardEntries.length; j++) {
        const user2 = shardEntries[j];
        if (processed.has(user2.userId)) continue;
        if (!hasTimeOverlapReplica(user1, user2)) continue;
        scoredPairs++;
        const score = scoreOf(user1, user2);
        if (score > bestScore) {
          best = { partner: user2, score };
          bestScore = score;
        }
      }

      if (best) {
        decisions.push({
          user1: user1.userId,
          user2: best.partner.userId,
          queue1: user1.queueId,
          queue2: best.partner.queueId,
          score: best.score,
          shard,
        });
        // createMatch success assumed in the replica; commit failures are
        // detected by comparing predictions with actual outcomes.
        processed.add(user1.userId);
        processed.add(best.partner.userId);
        matchCount++;
      }
    }
  }

  return { decisions, scannedPerShard, scoredPairs, fifoCapPerShard, eligiblePerShard };
}
