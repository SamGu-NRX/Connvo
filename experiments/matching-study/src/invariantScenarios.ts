/**
 * Bespoke invariant scenarios: deterministic, assertion-grade contract checks
 * against the real registered functions. Each scenario builds a minimal
 * hand-crafted population, drives the engine, and asserts the eligibility /
 * pairing contract. Used by the vitest bridge AND run.ts.
 */

import type { Id } from "@convex/_generated/dataModel";
import { api, internal } from "@convex/_generated/api";
import { planPopulation, DEFAULT_PARAMS } from "./generator.js";
import type { PlannedEntry, PopulationParams, SyntheticIdentity } from "./types.js";
import type { RuntimeFactory, RuntimeHandle } from "./runFlow.js";
import { collectMatrix, runCycles, BASE_CLOCK } from "./runFlow.js";
import { shardOf } from "./replica.js";
import {
  queueRows,
  matchedPairs,
  pairsWithMatchIds,
  analyticsRows,
  auditLogs,
  runEngineCycle,
  runCleanupOnly,
  assertGlobalInvariants,
  assertPointerMutuality,
  checkInvariants,
} from "./scenarios.js";
import type { InvariantOutcome } from "./scenarios.js";

export interface InvariantSuiteOutput {
  outcomes: InvariantOutcome[];
  failures: Array<{ scenario: string; detail: string }>;
  notes: string[];
}

function alwaysOnParams(count: number): PopulationParams {
  return {
    ...DEFAULT_PARAMS,
    count,
    arrivalProfile: "burst",
    availabilityMix: { always_on: 1, daytime: 0, short: 0 },
    staleFraction: 0,
    rejoinFraction: 0,
  };
}

async function setup(
  factory: RuntimeFactory,
  scenario: string,
  seed: number,
  count: number,
): Promise<{ handle: RuntimeHandle; plan: ReturnType<typeof planPopulation> }> {
  const { materializePopulation } = await import("./harness.js");
  const handle = await factory.create(BASE_CLOCK);
  const plan = planPopulation(scenario, seed, alwaysOnParams(count), BASE_CLOCK);
  await materializePopulation(handle.runtime, plan, { queue: true });
  return { handle, plan };
}

function noteShards(plan: ReturnType<typeof planPopulation>, shardCount: number): number[] {
  return plan.entries.map((e) => shardOf(String(e.userId), shardCount));
}

// ---------------------------------------------------------------------------
// 1. minScore boundary: exactly minScore does not match; a hair below the
//    threshold (i.e. score above minScore) does.
// ---------------------------------------------------------------------------
export async function scenarioMinScoreBoundary(factory: RuntimeFactory): Promise<InvariantOutcome[]> {
  const out: InvariantOutcome[] = [];
  const { handle } = await setup(factory, "inv-minscore", 4101, 2);
  const { env, defaults } = handle.runtime;
  const bundle = await collectMatrix(env, defaults.minScore);
  const score = bundle.scores[0][1];
  // The strict-boundary probe works for ANY finite positive pair score; it
  // does not require the pair to clear the default 0.6 threshold.
  if (!Number.isFinite(score) || score <= 0) {
    out.push(checkInvariants("minScore precondition: pair has a finite positive score", false, `score=${score}`));
  } else {
    // minScore set EXACTLY to the measured score: strict > means no match.
    // shardCount=1 isolates threshold semantics from shard membership.
    await runEngineCycle(env, defaults, 1, { minScore: score, shardCount: 1 });
    const matchesAtBoundary = await matchedPairs(env);
    out.push(
      checkInvariants(
        "pair scoring exactly minScore does not match (strict >)",
        matchesAtBoundary.length === 0,
        `score=${score}, matches=${matchesAtBoundary.length}`,
      ),
    );
    // minScore a hair BELOW the pair score: now it matches.
    await runEngineCycle(env, defaults, 2, { minScore: score - 1e-9, shardCount: 1 });
    const matchesAfter = await matchedPairs(env);
    out.push(
      checkInvariants(
        "pair above minScore matches once threshold drops below it",
        matchesAfter.length === 1,
        `score=${score}, matches=${matchesAfter.length}`,
      ),
    );
  }
  await handle.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// 2. Shard rule: a compatible cross-shard pair cannot match at shardCount=4
//    but the same population can at shardCount=1.
// ---------------------------------------------------------------------------
export async function scenarioShardRule(factory: RuntimeFactory): Promise<InvariantOutcome[]> {
  const out: InvariantOutcome[] = [];
  const { materializePopulation } = await import("./harness.js");
  for (let seed = 4200; seed < 4220; seed++) {
    const handle = await factory.create(BASE_CLOCK);
    const probe = planPopulation("inv-shard-probe", seed, alwaysOnParams(2), BASE_CLOCK);
    await materializePopulation(handle.runtime, probe, { queue: true });
    const shards = noteShards(probe, 4);
    if (shards[0] === shards[1]) {
      await handle.dispose();
      continue;
    }
    const { env, defaults } = handle.runtime;
    const bundle = await collectMatrix(env, defaults.minScore);
    if (!(bundle.overlap[0][1] && bundle.scores[0][1] > defaults.minScore)) {
      await handle.dispose();
      continue;
    }
    await runEngineCycle(env, defaults, 1, { shardCount: 4 });
    const matchesAt4 = await matchedPairs(env);
    out.push(
      checkInvariants(
        "compatible cross-shard pair cannot match at shardCount=4",
        matchesAt4.length === 0,
        `shards=${shards.join(",")} score=${bundle.scores[0][1]} matches=${matchesAt4.length}`,
      ),
    );
    await handle.dispose();

    // Same plan, shardCount=1: the pair shares one shard -> can match.
    const handle2 = await factory.create(BASE_CLOCK);
    const plan2 = planPopulation("inv-shard-probe", seed, alwaysOnParams(2), BASE_CLOCK);
    await materializePopulation(handle2.runtime, plan2, { queue: true });
    await runEngineCycle(handle2.runtime.env, handle2.runtime.defaults, 1, { shardCount: 1 });
    const matchesAt1 = await matchedPairs(handle2.runtime.env);
    out.push(
      checkInvariants("same pair can match at shardCount=1", matchesAt1.length === 1, `matches=${matchesAt1.length}`),
    );
    await handle2.dispose();
    return out;
  }
  out.push(checkInvariants("shard-rule scenario found a cross-shard pair", false, "no seed produced a cross-shard pair"));
  return out;
}

// ---------------------------------------------------------------------------
// 3. FIFO cap: cap = 2*ceil(maxMatches/shardCount); later compatible arrivals
//    are not scanned until earlier ones leave.
// ---------------------------------------------------------------------------
export function handcraftedEntry(
  index: number,
  interests: string[],
  roles: string[],
  field: string,
  exp: string,
): PlannedEntry {
  const base = BASE_CLOCK + index * 1000;
  const identity: SyntheticIdentity = {
    subject: `fifo-user-${index}`,
    tokenIdentifier: `study|fifo-user-${index}`,
    email: `fifo-user-${index}@synthetic.invalid`,
    name: `FIFO User ${index}`,
    issuer: "https://synthetic.invalid",
  };
  return {
    index,
    userId: `PENDING-${index}` as unknown as Id<"users">,
    identity,
    enqueueAt: base,
    availableFrom: base + 1000,
    availableTo: base + 3600000,
    constraints: { interests: interests.slice(0, 2), roles },
    interests,
    profile: { displayName: `FIFO User ${index}`, experience: exp, field, languages: ["English"] },
    orgId: "org-synthetic",
    embedding: [],
    availabilityClass: "always_on",
    cohort: 0,
  };
}

export async function scenarioFifoCap(factory: RuntimeFactory): Promise<InvariantOutcome[]> {
  const out: InvariantOutcome[] = [];
  // e1,e2: same role, disjoint interests, different fields -> low score.
  // e3,e4: shared interests, complementary roles -> high score.
  const users = [
    handcraftedEntry(0, ["alpha", "beta"], ["mentor"], "finance", "senior"),
    handcraftedEntry(1, ["gamma", "delta"], ["mentor"], "design", "senior"),
    handcraftedEntry(2, ["epsilon", "zeta"], ["mentor"], "technology", "senior"),
    handcraftedEntry(3, ["epsilon", "zeta"], ["mentee"], "technology", "junior"),
  ];

  const build = async (): Promise<RuntimeHandle> => {
    const { createUser } = await import("./harness.js");
    const handle = await factory.create(BASE_CLOCK);
    for (const e of users) {
      handle.runtime.clock.advance(e.enqueueAt + 1000 - handle.runtime.clock.now());
      await createUser(handle.runtime, e);
      const authed = handle.runtime.env.withIdentity(e.identity);
      await authed.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: e.availableFrom,
        availableTo: e.availableTo,
        constraints: e.constraints,
      });
    }
    return handle;
  };

  {
    // maxMatches=1, shardCount=1 -> cap=2 -> only e1,e2 scanned.
    const handle = await build();
    const { env, defaults } = handle.runtime;
    await runEngineCycle(env, defaults, 1, { maxMatches: 1, shardCount: 1 });
    const matches = await matchedPairs(env);
    out.push(
      checkInvariants(
        "FIFO cap: with cap=2 and e1-e2 incompatible, zero matches (e3,e4 never scanned)",
        matches.length === 0,
        `matches=${matches.length}`,
      ),
    );
    await handle.dispose();
  }
  {
    // maxMatches=2 -> cap=4 -> e3,e4 scanned and matched.
    const handle = await build();
    const { env, defaults } = handle.runtime;
    await runEngineCycle(env, defaults, 1, { maxMatches: 2, shardCount: 1 });
    const matches = await matchedPairs(env);
    out.push(
      checkInvariants("FIFO cap widened: e3,e4 scanned and matched", matches.length === 1, `matches=${matches.length}`),
    );
    await handle.dispose();
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Expiry: cleanup expires stale entries (one audit each); cycles cannot
//    match them; createMatch itself does NOT revalidate windows (finding).
// ---------------------------------------------------------------------------
export async function scenarioExpiryAndCommitWindow(factory: RuntimeFactory): Promise<InvariantOutcome[]> {
  const out: InvariantOutcome[] = [];
  const { handle } = await setup(factory, "inv-expiry", 4301, 2);
  const { env, clock, defaults } = handle.runtime;

  const rowsBefore = await queueRows(env);
  const queueIds = rowsBefore.map((r) => r._id);
  await env.run(async (ctx) => {
    for (const qid of queueIds) {
      await ctx.db.patch(qid, { availableTo: clock.now() - 1000 });
    }
  });

  const expired = await runCleanupOnly(env);
  out.push(checkInvariants("cleanup expires stale waiting entries", expired === 2, `expired=${expired}`));
  const logs = await auditLogs(env);
  const expiryLogs = logs.filter((l) => l.action === "queue_expired");
  out.push(checkInvariants("expiry writes one auditLog per entry", expiryLogs.length === 2, `logs=${expiryLogs.length}`));

  const cycleResult = await runEngineCycle(env, defaults, 1);
  out.push(
    checkInvariants("expired entries cannot be matched by a cycle", cycleResult.matchCount === 0, `matches=${cycleResult.matchCount}`),
  );

  // Commit-boundary probe: restore waiting status with expired windows and
  // call the internal mutation directly — documents the missing revalidation.
  await env.run(async (ctx) => {
    for (const qid of queueIds) {
      // matchedWith is optional (not nullable) in the schema and these rows
      // were never matched — restoring waiting status needs no partner reset.
      await ctx.db.patch(qid, { status: "waiting" });
    }
  });
  const rowsAfterRestore = await queueRows(env);
  const userById = new Map(rowsAfterRestore.map((r) => [String(r._id), String(r.userId)]));
  const features = {
    interestOverlap: 1,
    experienceGap: 1,
    industryMatch: 1,
    timezoneCompatibility: 1,
    orgConstraintMatch: 1,
    languageOverlap: 1,
    roleComplementarity: 1,
  };
  const commitProbe = (await env.mutation(
    internal.matching.engine.createMatch as never,
    {
      user1QueueId: queueIds[0],
      user2QueueId: queueIds[1],
      matchResult: {
        user1Id: userById.get(String(queueIds[0])),
        user2Id: userById.get(String(queueIds[1])),
        score: 0.9,
        features,
        explanation: ["study commit-boundary probe"],
        matchId: "study-commit-probe-0001",
      },
    } as never,
  )) as unknown as boolean;
  out.push(
    checkInvariants(
      "DOCUMENTS MISSING GUARD: createMatch commits a pair whose availability windows already passed (finding, not a pass)",
      commitProbe === true,
      `createMatch returned ${commitProbe} for expired windows`,
    ),
  );
  await handle.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// 5. Queue rules + retry consistency.
// ---------------------------------------------------------------------------
export async function scenarioQueueRulesAndRetries(factory: RuntimeFactory): Promise<InvariantOutcome[]> {
  const out: InvariantOutcome[] = [];
  const { handle, plan } = await setup(factory, "inv-rules", 4401, 6);
  const { env, clock, defaults } = handle.runtime;

  const authed = env.withIdentity(plan.entries[0].identity);
  let duplicateRejected = false;
  try {
    await authed.mutation(api.matching.queue.enterMatchingQueue, {
      availableFrom: clock.now() + 1000,
      availableTo: clock.now() + 60000,
      constraints: plan.entries[0].constraints,
    });
  } catch {
    duplicateRejected = true;
  }
  out.push(checkInvariants("second waiting entry per user is rejected", duplicateRejected));

  let pastWindowRejected = false;
  try {
    await authed.mutation(api.matching.queue.enterMatchingQueue, {
      availableFrom: clock.now() - 60000,
      availableTo: clock.now() + 60000,
      constraints: plan.entries[0].constraints,
    });
  } catch {
    pastWindowRejected = true;
  }
  out.push(checkInvariants("availableFrom in the past is rejected", pastWindowRejected));

  await runCycles(handle, { maxCycles: 12 });
  const matchesBefore = (await matchedPairs(env)).length;
  const retry = await runEngineCycle(env, defaults, 99);
  out.push(checkInvariants("retry cycle creates zero new matches", retry.matchCount === 0, `matched=${retry.matchCount}`));

  const matches = await pairsWithMatchIds(env, await matchedPairs(env));
  const analytics = await analyticsRows(env);
  out.push(...assertGlobalInvariants(matches, analytics));
  const finalRows = await queueRows(env);
  out.push(...assertPointerMutuality(finalRows, matches));
  out.push(
    checkInvariants(
      "matches plateau: retry adds nothing",
      matches.length === matchesBefore,
      `before=${matchesBefore} after=${matches.length}`,
    ),
  );

  const matchedUser = plan.entries.find((e) =>
    matches.some((m) => String(m.userAId) === String(e.userId) || String(m.userBId) === String(e.userId)),
  );
  if (matchedUser) {
    const a2 = env.withIdentity(matchedUser.identity);
    let reentryOk = true;
    try {
      await a2.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: clock.now() + 1000,
        availableTo: clock.now() + 3600000,
        constraints: matchedUser.constraints,
      });
    } catch {
      reentryOk = false;
    }
    out.push(checkInvariants("re-entry after match is allowed", reentryOk));
  }
  await handle.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// 6. Concurrency: two simultaneous cycles; no double booking; race counts
//    recorded (not asserted).
// ---------------------------------------------------------------------------
export async function scenarioConcurrentCycles(factory: RuntimeFactory): Promise<InvariantSuiteOutput> {
  const outcomes: InvariantOutcome[] = [];
  const failures: Array<{ scenario: string; detail: string }> = [];
  const notes: string[] = [];
  const { handle } = await setup(factory, "inv-concurrent", 4501, 50);
  const { env, defaults } = handle.runtime;

  const args = { minScore: defaults.minScore, maxMatches: defaults.maxMatches, shardCount: defaults.shardCount };
  const [r1, r2] = (await Promise.all([
    env.action(api.matching.engine.runMatchingCycle, args),
    env.action(api.matching.engine.runMatchingCycle, args),
  ])) as unknown as Array<{ matchCount: number; totalScore: number }>;
  notes.push(`concurrent cycles reported ${r1?.matchCount} and ${r2?.matchCount} matches`);

  const matches = await pairsWithMatchIds(env, await matchedPairs(env));
  const analytics = await analyticsRows(env);
  outcomes.push(...assertGlobalInvariants(matches, analytics));
  const rows = await queueRows(env);
  outcomes.push(...assertPointerMutuality(rows, matches));

  const matchedUsers = new Set<string>();
  for (const m of matches) {
    matchedUsers.add(String(m.userAId));
    matchedUsers.add(String(m.userBId));
  }
  const queueMatched = rows.filter((r) => r.status === "matched");
  const consistent =
    queueMatched.every((r) => matchedUsers.has(String(r.userId))) && queueMatched.length === 2 * matches.length;
  outcomes.push(
    checkInvariants(
      "queue matched-state agrees with matches table under concurrent cycles",
      consistent,
      `queueMatched=${queueMatched.length} matches=${matches.length}`,
    ),
  );
  const badRows = new Map<string, number>();
  for (const row of analytics) {
    const key = String(row.matchId);
    badRows.set(key, (badRows.get(key) ?? 0) + 1);
  }
  const bad = [...badRows.values()].filter((c) => c !== 2).length;
  outcomes.push(checkInvariants("concurrent cycles: exactly two analytics rows per matchId", bad === 0, `bad=${bad}`));
  if (r1 && r2 && r1.matchCount + r2.matchCount !== matches.length) {
    failures.push({
      scenario: "inv-concurrent",
      detail: `cycles reported ${(r1.matchCount ?? 0) + (r2.matchCount ?? 0)} but ${matches.length} matches committed (createMatch false returns)`,
    });
  }
  await handle.dispose();
  return { outcomes, failures, notes };
}

// ---------------------------------------------------------------------------
// 7. Entry validation: at least one interest and one role required.
// ---------------------------------------------------------------------------
export async function scenarioEntryValidation(factory: RuntimeFactory): Promise<InvariantOutcome[]> {
  const out: InvariantOutcome[] = [];
  const { createUser } = await import("./harness.js");
  const handle = await factory.create(BASE_CLOCK);
  const { env, clock } = handle.runtime;
  const identity: SyntheticIdentity = {
    subject: "empty-constraints-user",
    tokenIdentifier: "study|empty-constraints-user",
    email: "empty-constraints-user@synthetic.invalid",
    name: "Empty Constraints User",
    issuer: "https://synthetic.invalid",
  };
  const entry = handcraftedEntry(0, ["alpha"], ["mentor"], "technology", "mid");
  entry.identity = identity;
  entry.constraints = { interests: ["alpha"], roles: ["mentor"] };
  await createUser(handle.runtime, entry);

  const authed = env.withIdentity(identity);
  let rejected = false;
  try {
    await authed.mutation(api.matching.queue.enterMatchingQueue, {
      availableFrom: clock.now() + 1000,
      availableTo: clock.now() + 60000,
      constraints: { interests: [], roles: [] },
    });
  } catch {
    rejected = true;
  }
  out.push(checkInvariants("entry requires at least one interest and one role", rejected));
  await handle.dispose();
  return out;
}

/** Runs the whole invariant suite against a factory. */
export async function runInvariantSuite(factory: RuntimeFactory): Promise<InvariantSuiteOutput> {
  const outcomes: InvariantOutcome[] = [];
  const failures: Array<{ scenario: string; detail: string }> = [];
  const notes: string[] = [];

  outcomes.push(...(await scenarioMinScoreBoundary(factory)));
  outcomes.push(...(await scenarioShardRule(factory)));
  outcomes.push(...(await scenarioFifoCap(factory)));
  outcomes.push(...(await scenarioExpiryAndCommitWindow(factory)));
  outcomes.push(...(await scenarioQueueRulesAndRetries(factory)));
  const concurrent = await scenarioConcurrentCycles(factory);
  outcomes.push(...concurrent.outcomes);
  failures.push(...concurrent.failures);
  notes.push(...concurrent.notes);
  outcomes.push(...(await scenarioEntryValidation(factory)));

  return { outcomes, failures, notes };
}
