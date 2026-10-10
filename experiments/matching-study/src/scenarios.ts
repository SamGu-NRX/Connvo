/**
 * Scenario library: drives the REAL registered Convex functions through the
 * convex-test environment and observes committed state.
 *
 * Observation model (matches the schema): there is no `matches` table. A
 * match is the PAIR of `matchingQueue` rows with status "matched" pointing at
 * each other via `matchedWith`, plus two `matchingAnalytics` rows sharing a
 * string matchId. All match-level views here are derived from those rows.
 *
 * Three families, per the study brief:
 *   - invariants: assertion-grade behavioral contract checks (must pass)
 *   - quality:    measured allocation quality vs exact reference + baselines
 *   - load:       degradation/workload measurements (bounded, no assertion on
 *                 optimality; smoke tiers also run in vitest, full tiers only
 *                 via run.ts)
 *
 * Synthetic preferences are DECLARED OBJECTIVES for measurement — never
 * social-quality ground truth. Absolute score levels are not transferable.
 */

import type { Id } from "@convex/_generated/dataModel";
import { api, internal } from "@convex/_generated/api";
import type { StudyEnv } from "./types.js";
import type { MatrixBundle } from "./scoringMatrix.js";
import { percentileSummary } from "./artifacts.js";

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

export interface QueueRow {
  _id: Id<"matchingQueue">;
  userId: Id<"users">;
  status: string;
  availableFrom: number;
  availableTo: number;
  constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
  };
  createdAt: number;
  updatedAt?: number;
  matchedWith?: Id<"users"> | null;
}

/** Derived match: two mutually-pointing matched queue rows. */
export interface MatchPair {
  userAId: Id<"users">;
  userBId: Id<"users">;
  matchId: string | null;
}

export function pairKey(
  userA: string | Id<"users">,
  userB: string | Id<"users">,
): string {
  return [String(userA), String(userB)].sort().join("|");
}

export async function queueRows(env: StudyEnv): Promise<QueueRow[]> {
  return env.run(async (ctx) => {
    const rows = await ctx.db.query("matchingQueue").collect();
    return rows as unknown as QueueRow[];
  });
}

/** Derives committed matches from matched queue rows (mutual pointers). */
export async function matchedPairs(env: StudyEnv): Promise<MatchPair[]> {
  const rows = await queueRows(env);
  const byUser = new Map<string, QueueRow>(
    rows.map((r) => [String(r.userId), r]),
  );
  const seen = new Set<string>();
  const pairs: MatchPair[] = [];
  for (const r of rows) {
    if (r.status !== "matched" || !r.matchedWith) continue;
    const partner = byUser.get(String(r.matchedWith));
    if (!partner || partner.status !== "matched") continue;
    const key = pairKey(r.userId, partner.userId);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ userAId: r.userId, userBId: partner.userId, matchId: null });
  }
  return pairs;
}

/** Attaches the analytics matchId to each derived pair (when present). */
export async function pairsWithMatchIds(
  env: StudyEnv,
  pairs: MatchPair[],
): Promise<MatchPair[]> {
  const analytics = await analyticsRows(env);
  const byUser = new Map<string, string[]>();
  for (const row of analytics) {
    const uid = String(row.userId);
    const mid = row.matchId === undefined ? null : String(row.matchId);
    byUser.set(uid, [
      ...(byUser.get(uid) ?? []),
      ...(mid === null ? [] : [mid]),
    ]);
  }
  return pairs.map((p) => {
    const a = byUser.get(String(p.userAId)) ?? [];
    const b = byUser.get(String(p.userBId)) ?? [];
    const shared = a.find((m) => b.includes(m)) ?? null;
    return { ...p, matchId: shared };
  });
}

export async function analyticsRows(
  env: StudyEnv,
): Promise<Array<Record<string, unknown>>> {
  return env.run(async (ctx) => {
    const rows = await ctx.db.query("matchingAnalytics").collect();
    return rows as unknown as Array<Record<string, unknown>>;
  });
}

export async function auditLogs(
  env: StudyEnv,
): Promise<Array<Record<string, unknown>>> {
  return env.run(async (ctx) => {
    const rows = await ctx.db.query("auditLogs").collect();
    return rows as unknown as Array<Record<string, unknown>>;
  });
}

// ---------------------------------------------------------------------------
// Cycle execution
// ---------------------------------------------------------------------------

export interface CycleTiming {
  cycle: number;
  shardCount: number;
  /** Engine-reported committed matches (pairs) for this cycle. */
  totalMatches: number;
  /** Engine-reported mean score across committed matches. */
  averageScore: number;
  wallMs: number;
}

/** Runs one engine cycle (the real public action) with wall timing. */
export async function runEngineCycle(
  env: StudyEnv,
  defaults: { minScore: number; maxMatches: number; shardCount: number },
  cycle: number,
  overrides: Partial<{
    minScore: number;
    maxMatches: number;
    shardCount: number;
  }> = {},
): Promise<CycleTiming> {
  const started = performance.now();
  // runMatchingCycle (public action) returns { processedShards, totalMatches,
  // averageScore, processingTimeMs } — the { matchCount, totalScore } shape
  // belongs to the internal processMatchingShard action, not this one.
  const result = (await env.action(api.matching.engine.runMatchingCycle, {
    minScore: overrides.minScore ?? defaults.minScore,
    maxMatches: overrides.maxMatches ?? defaults.maxMatches,
    shardCount: overrides.shardCount ?? defaults.shardCount,
  })) as unknown as { totalMatches?: number; averageScore?: number };
  return {
    cycle,
    shardCount: overrides.shardCount ?? defaults.shardCount,
    totalMatches: result?.totalMatches ?? 0,
    averageScore: result?.averageScore ?? 0,
    wallMs: performance.now() - started,
  };
}

/** Runs only the expiry cleanup (isolates expiry behavior when wanted). */
export async function runCleanupOnly(env: StudyEnv): Promise<number> {
  const result = (await env.mutation(
    internal.matching.queue.cleanupExpiredEntries as never,
    {},
  )) as unknown as { expiredCount: number };
  return result?.expiredCount ?? 0;
}

// ---------------------------------------------------------------------------
// Invariant checks (assert-grade)
// ---------------------------------------------------------------------------

export interface InvariantOutcome {
  name: string;
  passed: boolean;
  detail?: string;
}

export function checkInvariants(
  name: string,
  passed: boolean,
  detail?: string,
): InvariantOutcome {
  return { name, passed, detail };
}

/** No user in two matches; every matchId has 2 analytics rows for the pair. */
export function assertGlobalInvariants(
  pairs: MatchPair[],
  analytics: Array<Record<string, unknown>>,
): InvariantOutcome[] {
  const out: InvariantOutcome[] = [];
  const perUser = new Map<string, number>();
  for (const p of pairs) {
    perUser.set(String(p.userAId), (perUser.get(String(p.userAId)) ?? 0) + 1);
    perUser.set(String(p.userBId), (perUser.get(String(p.userBId)) ?? 0) + 1);
  }
  const doubleBooked = [...perUser.entries()].filter(([, c]) => c > 1);
  out.push(
    checkInvariants(
      "no user in two simultaneous matches",
      doubleBooked.length === 0,
      doubleBooked.length > 0
        ? `users with >1 match: ${doubleBooked.map(([u]) => u).join(",")}`
        : undefined,
    ),
  );

  const rowsPerMatch = new Map<string, number>();
  const usersPerMatch = new Map<string, Set<string>>();
  for (const row of analytics) {
    const key = String(row.matchId);
    rowsPerMatch.set(key, (rowsPerMatch.get(key) ?? 0) + 1);
    if (!usersPerMatch.has(key)) usersPerMatch.set(key, new Set());
    usersPerMatch.get(key)!.add(String(row.userId));
  }
  const badRows = [...rowsPerMatch.entries()].filter(([, c]) => c !== 2);
  const badUsers = [...usersPerMatch.entries()].filter(([, s]) => s.size !== 2);
  out.push(
    checkInvariants(
      "every matchId has exactly two analytics rows with distinct userIds",
      badRows.length === 0 && badUsers.length === 0,
      badRows.length + badUsers.length > 0
        ? `bad row counts: ${badRows.length}, bad user sets: ${badUsers.length}`
        : undefined,
    ),
  );

  const pairKeys = new Set(pairs.map((p) => pairKey(p.userAId, p.userBId)));
  const analyticsPairKeys = new Set(
    [...usersPerMatch.keys()].map((mid) => {
      const users = [...(usersPerMatch.get(mid) ?? [])];
      return users.length === 2
        ? pairKey(users[0], users[1])
        : `malformed:${mid}`;
    }),
  );
  const sameSet =
    pairKeys.size === analyticsPairKeys.size &&
    [...pairKeys].every((k) => analyticsPairKeys.has(k));
  out.push(
    checkInvariants(
      "derived match pairs agree with analytics matchId groups",
      sameSet,
      `pairs=${pairKeys.size} analyticsGroups=${analyticsPairKeys.size}`,
    ),
  );
  return out;
}

/** matchedWith mutuality on queue rows. */
export function assertPointerMutuality(
  rows: QueueRow[],
  pairs: MatchPair[],
): InvariantOutcome[] {
  const byUser = new Map<string, QueueRow>();
  for (const row of rows) byUser.set(String(row.userId), row);
  const matchedRows = rows.filter(
    (r) => r.status === "matched" && r.matchedWith,
  );
  const mutual = matchedRows.every((r) => {
    const partner = byUser.get(String(r.matchedWith));
    return (
      !!partner &&
      String(partner.matchedWith) === String(r.userId) &&
      partner.status === "matched"
    );
  });
  return [
    checkInvariants(
      "matchedWith pointers mutual and paired",
      mutual && matchedRows.length === 2 * pairs.length,
      `matchedRows=${matchedRows.length} pairs=${pairs.length}`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Quality comparison helpers
// ---------------------------------------------------------------------------

export interface EngineOutcomeSummary {
  cardinality: number;
  totalWeight: number;
  pairs: Array<{ i: number; j: number; score: number }>;
}

/** Maps derived match pairs onto matrix indices; scores come from the engine's own cached matrix. */
export function enginePairsFromMatches(
  bundle: MatrixBundle,
  pairs: MatchPair[],
): EngineOutcomeSummary {
  const indexOf = new Map<string, number>();
  bundle.entries.forEach((e, idx) => indexOf.set(String(e.userId), idx));
  const out: Array<{ i: number; j: number; score: number }> = [];
  for (const p of pairs) {
    const i = indexOf.get(String(p.userAId));
    const j = indexOf.get(String(p.userBId));
    if (i === undefined || j === undefined || i === j) continue;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    out.push({ i: lo, j: hi, score: bundle.scores[lo][hi] });
  }
  return {
    cardinality: out.length,
    totalWeight: out.reduce((s, x) => s + x.score, 0),
    pairs: out,
  };
}

/** Timing summary from per-cycle wall times. */
export function wallSummary(walls: number[]): {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  count: number;
} {
  return percentileSummary(walls);
}
