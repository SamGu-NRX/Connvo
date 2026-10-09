/**
 * Contract tests for convex/matching/analytics.ts.
 *
 * Pins the tightened boundaries of the analytics module:
 * - rating validation rejects NaN/Infinity (the legacy inline range check let
 *   NaN through because both comparisons are false for NaN)
 * - feedback for a match without an own analytics record fails loudly
 *   (previously a silent no-op that also swallowed cross-user writes)
 * - pagination and time-range arguments are bounded via MATCHING_LIMITS
 * - weight optimization requires an authenticated org admin
 * - getMatchesForOptimization only surfaces completed/declined outcomes
 * - calculateWeightImprovement only weighs FEATURE_KEYS
 *
 * Error-message texts asserted here are part of the module's public contract
 * (shared with validators.ts) and must stay stable.
 */

import { describe, expect, it } from "vitest";
import type { UserIdentity } from "convex/server";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";
import { MATCHING_LIMITS } from "./validators";
import { calculateWeightImprovement } from "./analytics";
import type { CompatibilityFeatures } from "@convex/types/entities/matching";

type TestServer = ReturnType<typeof createTestEnvironment>;
type AuthedTestServer = ReturnType<TestServer["withIdentity"]>;

interface TestUser {
  id: Id<"users">;
  workosUserId: string;
  auth: AuthedTestServer;
}

let userSequence = 0;

/**
 * Seeds a users-table document. orgRole lands on the document because
 * requireIdentity reads the role from the user record, not the JWT.
 */
async function seedUser(
  t: TestServer,
  options: { orgRole?: "admin" | "member" } = {},
): Promise<TestUser> {
  userSequence += 1;
  const workosUserId = `analytics-user-${userSequence}`;
  const now = Date.now();
  const id = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      workosUserId,
      email: `${workosUserId}@example.com`,
      displayName: `Analytics User ${userSequence}`,
      orgId: "test-org",
      orgRole: options.orgRole ?? "member",
      isActive: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const identity: Partial<UserIdentity> = {
    subject: workosUserId,
    tokenIdentifier: `test|${workosUserId}`,
    email: `${workosUserId}@example.com`,
    name: `Analytics User ${userSequence}`,
    issuer: "https://example.com",
  };

  return { id, workosUserId, auth: t.withIdentity(identity) };
}

function defaultFeatures(): Record<string, number> {
  return {
    interestOverlap: 0.8,
    experienceGap: 0.4,
    industryMatch: 0.5,
    timezoneCompatibility: 0.9,
    vectorSimilarity: 0.7,
    orgConstraintMatch: 0.6,
    languageOverlap: 0.75,
    roleComplementarity: 0.85,
  };
}

async function seedAnalyticsRecord(
  t: TestServer,
  input: {
    userId: Id<"users">;
    matchId: string;
    outcome: "accepted" | "declined" | "completed";
    features?: Record<string, number>;
    feedback?: { rating: number; comments?: string };
    createdAt?: number;
  },
): Promise<Id<"matchingAnalytics">> {
  return t.run(async (ctx) =>
    ctx.db.insert("matchingAnalytics", {
      userId: input.userId,
      matchId: input.matchId,
      outcome: input.outcome,
      features: input.features ?? defaultFeatures(),
      weights: defaultFeatures(),
      feedback: input.feedback,
      createdAt: input.createdAt ?? Date.now() - 1000,
    }),
  );
}

describe("submitMatchFeedback", () => {
  it("patches the caller's own analytics record for the match", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);
    const recordId = await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-happy",
      outcome: "accepted",
    });

    const result = await user.auth.mutation(
      api.matching.analytics.submitMatchFeedback,
      {
        matchId: "match-happy",
        outcome: "completed",
        feedback: { rating: 5, comments: "Great match" },
      },
    );

    expect(result).toBeNull();
    const doc = await t.run(async (ctx) => ctx.db.get(recordId));
    expect(doc?.outcome).toBe("completed");
    expect(doc?.feedback).toEqual({ rating: 5, comments: "Great match" });
  });

  it("rejects rating 0 with the exact validators message", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);
    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-zero",
      outcome: "accepted",
    });

    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-zero",
        outcome: "completed",
        feedback: { rating: 0 },
      }),
    ).rejects.toThrow("Rating must be between 1 and 5 (got 0)");
  });

  it("rejects rating 6 with the exact validators message", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);
    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-six",
      outcome: "accepted",
    });

    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-six",
        outcome: "completed",
        feedback: { rating: 6 },
      }),
    ).rejects.toThrow("Rating must be between 1 and 5 (got 6)");
  });

  it("rejects NaN ratings — the legacy inline check let NaN into the database", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);
    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-nan",
      outcome: "accepted",
    });

    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-nan",
        outcome: "completed",
        feedback: { rating: Number.NaN },
      }),
    ).rejects.toThrow("Rating must be between 1 and 5 (got NaN)");
  });

  it("rejects Infinity ratings", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);
    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-inf",
      outcome: "accepted",
    });

    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-inf",
        outcome: "completed",
        feedback: { rating: Number.POSITIVE_INFINITY },
      }),
    ).rejects.toThrow("Rating must be between 1 and 5 (got Infinity)");
  });

  it("rejects comments longer than MAX_COMMENTS_LENGTH", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);
    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-long-comments",
      outcome: "accepted",
    });

    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-long-comments",
        outcome: "completed",
        feedback: {
          rating: 4,
          comments: "c".repeat(MATCHING_LIMITS.MAX_COMMENTS_LENGTH + 1),
        },
      }),
    ).rejects.toThrow(
      `comments: must be a string of at most ${MATCHING_LIMITS.MAX_COMMENTS_LENGTH} characters (got ${MATCHING_LIMITS.MAX_COMMENTS_LENGTH + 1})`,
    );
  });

  it("rejects matchIds longer than MAX_MATCH_ID_LENGTH", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);

    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "m".repeat(MATCHING_LIMITS.MAX_MATCH_ID_LENGTH + 1),
        outcome: "completed",
        feedback: { rating: 4 },
      }),
    ).rejects.toThrow(
      `matchId: must be a string of at most ${MATCHING_LIMITS.MAX_MATCH_ID_LENGTH} characters (got ${MATCHING_LIMITS.MAX_MATCH_ID_LENGTH + 1})`,
    );
  });

  it("rejects empty matchIds", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);

    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "",
        outcome: "completed",
      }),
    ).rejects.toThrow("matchId: must be a non-empty string");
  });

  it("fails loudly when no own analytics record exists for the matchId", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);

    // On the base branch this silently returned null; the fix must throw.
    await expect(
      user.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-missing",
        outcome: "completed",
        feedback: { rating: 4 },
      }),
    ).rejects.toThrow(
      "Match analytics record with ID match-missing not found",
    );
  });

  it("does not touch another user's analytics record for the same matchId", async () => {
    const t = createTestEnvironment();
    const owner = await seedUser(t);
    const other = await seedUser(t);
    const ownersRecord = await seedAnalyticsRecord(t, {
      userId: owner.id,
      matchId: "match-shared",
      outcome: "accepted",
    });

    await expect(
      other.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-shared",
        outcome: "completed",
        feedback: { rating: 1, comments: "not mine" },
      }),
    ).rejects.toThrow(
      "Match analytics record with ID match-shared not found",
    );

    const doc = await t.run(async (ctx) => ctx.db.get(ownersRecord));
    expect(doc?.outcome).toBe("accepted");
    expect(doc?.feedback).toBeUndefined();
  });
});

describe("getMatchHistory", () => {
  it("rejects limit 0 and limit above MAX_LIMIT with exact messages", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);

    await expect(
      user.auth.query(api.matching.analytics.getMatchHistory, { limit: 0 }),
    ).rejects.toThrow(
      `limit: must be an integer between 1 and ${MATCHING_LIMITS.MAX_LIMIT} (got 0)`,
    );

    await expect(
      user.auth.query(api.matching.analytics.getMatchHistory, {
        limit: MATCHING_LIMITS.MAX_LIMIT + 1,
      }),
    ).rejects.toThrow(
      `limit: must be an integer between 1 and ${MATCHING_LIMITS.MAX_LIMIT} (got ${MATCHING_LIMITS.MAX_LIMIT + 1})`,
    );
  });

  it("rejects a negative offset with an exact message", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);

    await expect(
      user.auth.query(api.matching.analytics.getMatchHistory, { offset: -1 }),
    ).rejects.toThrow(
      `offset: must be an integer between 0 and ${MATCHING_LIMITS.MAX_LIMIT} (got -1)`,
    );
  });

  it("returns only the caller's records, newest first, honoring limit and offset", async () => {
    const t = createTestEnvironment();
    const userA = await seedUser(t);
    const userB = await seedUser(t);

    // Insertion order fixes _creationTime; the query orders newest first.
    await seedAnalyticsRecord(t, {
      userId: userA.id,
      matchId: "match-A1",
      outcome: "accepted",
      createdAt: Date.now() - 3000,
    });
    await seedAnalyticsRecord(t, {
      userId: userA.id,
      matchId: "match-A2",
      outcome: "declined",
      createdAt: Date.now() - 2000,
      feedback: { rating: 2, comments: "ok" },
    });
    await seedAnalyticsRecord(t, {
      userId: userA.id,
      matchId: "match-A3",
      outcome: "completed",
      createdAt: Date.now() - 1000,
    });
    await seedAnalyticsRecord(t, {
      userId: userB.id,
      matchId: "match-B1",
      outcome: "completed",
      createdAt: Date.now() - 500,
    });

    const history = await userA.auth.query(
      api.matching.analytics.getMatchHistory,
      { limit: 10 },
    );

    expect(history.map((row) => row.matchId)).toEqual([
      "match-A3",
      "match-A2",
      "match-A1",
    ]);
    expect(history[1].feedback).toEqual({ rating: 2, comments: "ok" });
    expect(history[0].features.interestOverlap).toBe(0.8);

    const page = await userA.auth.query(
      api.matching.analytics.getMatchHistory,
      { limit: 2, offset: 1 },
    );
    expect(page.map((row) => row.matchId)).toEqual(["match-A2", "match-A1"]);
  });
});

describe("getGlobalMatchingAnalytics", () => {
  it("rejects non-admin callers with the legacy message", async () => {
    const t = createTestEnvironment();
    const member = await seedUser(t, { orgRole: "member" });

    await expect(
      member.auth.query(api.matching.analytics.getGlobalMatchingAnalytics, {}),
    ).rejects.toThrow("Admin access required");
  });

  it("lets an org admin aggregate across all users", async () => {
    const t = createTestEnvironment();
    const admin = await seedUser(t, { orgRole: "admin" });
    const member = await seedUser(t, { orgRole: "member" });

    await seedAnalyticsRecord(t, {
      userId: admin.id,
      matchId: "match-ga-1",
      outcome: "completed",
    });
    await seedAnalyticsRecord(t, {
      userId: member.id,
      matchId: "match-ga-2",
      outcome: "accepted",
    });

    const stats = await admin.auth.query(
      api.matching.analytics.getGlobalMatchingAnalytics,
      {},
    );

    expect(stats.totalMatches).toBe(2);
    expect(stats.outcomeDistribution).toEqual({
      accepted: 1,
      declined: 0,
      completed: 1,
    });
    expect(Number.isFinite(stats.averageScore)).toBe(true);
    expect(stats.matchingTrends.length).toBeGreaterThan(0);
  });

  it("rejects a negative timeRange with an exact message", async () => {
    const t = createTestEnvironment();
    const admin = await seedUser(t, { orgRole: "admin" });

    await expect(
      admin.auth.query(api.matching.analytics.getGlobalMatchingAnalytics, {
        timeRange: -1,
      }),
    ).rejects.toThrow(
      `timeRange: must be a number between 0 and ${MATCHING_LIMITS.MAX_TIME_RANGE_MS} (got -1)`,
    );
  });
});

describe("optimizeMatchingWeights", () => {
  it("rejects non-admin callers with the legacy message", async () => {
    const t = createTestEnvironment();
    const member = await seedUser(t, { orgRole: "member" });
    // Seed one record so the base branch (no auth check) reaches the
    // insufficient-data path instead of erroring before it — the rejection
    // must be the admin gate, not an accident of empty data.
    await seedAnalyticsRecord(t, {
      userId: member.id,
      matchId: "match-opt-auth",
      outcome: "completed",
    });

    await expect(
      member.auth.action(api.matching.analytics.optimizeMatchingWeights, {
        minSamples: 1,
      }),
    ).rejects.toThrow("Admin access required");
  });

  it("rejects minSamples below MIN_MIN_SAMPLES with an exact message", async () => {
    const t = createTestEnvironment();
    const admin = await seedUser(t, { orgRole: "admin" });

    await expect(
      admin.auth.action(api.matching.analytics.optimizeMatchingWeights, {
        minSamples: 0,
      }),
    ).rejects.toThrow(
      `minSamples: must be an integer between ${MATCHING_LIMITS.MIN_MIN_SAMPLES} and ${MATCHING_LIMITS.MAX_MIN_SAMPLES} (got 0)`,
    );
  });

  it("rejects minSamples above MAX_MIN_SAMPLES with an exact message", async () => {
    const t = createTestEnvironment();
    const admin = await seedUser(t, { orgRole: "admin" });

    await expect(
      admin.auth.action(api.matching.analytics.optimizeMatchingWeights, {
        minSamples: MATCHING_LIMITS.MAX_MIN_SAMPLES + 1,
      }),
    ).rejects.toThrow(
      `minSamples: must be an integer between ${MATCHING_LIMITS.MIN_MIN_SAMPLES} and ${MATCHING_LIMITS.MAX_MIN_SAMPLES} (got ${MATCHING_LIMITS.MAX_MIN_SAMPLES + 1})`,
    );
  });

  it("rejects optimization when there is insufficient data, with the legacy message", async () => {
    const t = createTestEnvironment();
    const admin = await seedUser(t, { orgRole: "admin" });
    await seedAnalyticsRecord(t, {
      userId: admin.id,
      matchId: "match-opt-insufficient",
      outcome: "completed",
    });

    await expect(
      admin.auth.action(api.matching.analytics.optimizeMatchingWeights, {
        minSamples: 2,
      }),
    ).rejects.toThrow(
      "Insufficient data for optimization. Need at least 2 samples, got 1",
    );
  });

  it("returns normalized optimized weights for an admin with enough data", async () => {
    const t = createTestEnvironment();
    const admin = await seedUser(t, { orgRole: "admin" });
    await seedAnalyticsRecord(t, {
      userId: admin.id,
      matchId: "match-opt-ok",
      outcome: "completed",
    });

    const result = await admin.auth.action(
      api.matching.analytics.optimizeMatchingWeights,
      { minSamples: 1 },
    );

    expect(result.sampleSize).toBe(1);
    expect(Number.isFinite(result.improvement)).toBe(true);
    const weightSum = Object.values(result.optimizedWeights).reduce(
      (sum, w) => sum + w,
      0,
    );
    expect(weightSum).toBeCloseTo(1, 6);
  });
});

describe("getMatchesForOptimization", () => {
  it("returns only completed and declined outcomes", async () => {
    const t = createTestEnvironment();
    const user = await seedUser(t);

    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-mo-accepted",
      outcome: "accepted",
    });
    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-mo-declined",
      outcome: "declined",
      // Features without vectorSimilarity: the pass-through mapping must keep
      // it undefined instead of coercing the other feature values.
      features: {
        interestOverlap: 0.5,
        experienceGap: 0.5,
        industryMatch: 0.5,
        timezoneCompatibility: 0.5,
        orgConstraintMatch: 0.5,
        languageOverlap: 0.5,
        roleComplementarity: 0.5,
      },
    });
    await seedAnalyticsRecord(t, {
      userId: user.id,
      matchId: "match-mo-completed",
      outcome: "completed",
    });

    const rows = await t.query(
      internal.matching.analytics.getMatchesForOptimization,
      { minSamples: 10 },
    );

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.outcome))).toEqual(
      new Set(["completed", "declined"]),
    );
    const withoutVector = rows.find(
      (row) => row.features.vectorSimilarity === undefined,
    );
    expect(withoutVector?.outcome).toBe("declined");
    expect(withoutVector?.features.interestOverlap).toBe(0.5);
  });

  it("rejects minSamples below MIN_MIN_SAMPLES with an exact message", async () => {
    const t = createTestEnvironment();

    await expect(
      t.query(internal.matching.analytics.getMatchesForOptimization, {
        minSamples: 0,
      }),
    ).rejects.toThrow(
      `minSamples: must be an integer between ${MATCHING_LIMITS.MIN_MIN_SAMPLES} and ${MATCHING_LIMITS.MAX_MIN_SAMPLES} (got 0)`,
    );
  });
});

describe("calculateWeightImprovement", () => {
  function weights(
    overrides: Partial<Record<string, number>>,
  ): CompatibilityFeatures {
    return {
      interestOverlap: 0,
      experienceGap: 0,
      industryMatch: 0,
      timezoneCompatibility: 0,
      vectorSimilarity: 0,
      orgConstraintMatch: 0,
      languageOverlap: 0,
      roleComplementarity: 0,
      ...overrides,
    };
  }

  function sample(
    features: Record<string, number>,
    outcome: "accepted" | "declined" | "completed",
  ): { features: Record<string, number>; outcome: "accepted" | "declined" | "completed" } {
    return { features, outcome };
  }

  const currentWeights = weights({ interestOverlap: 0.25, industryMatch: 0.1 });
  const newWeights = weights({ interestOverlap: 0.9, industryMatch: 0.05 });

  const completedHighInterest = sample({ interestOverlap: 1.0 }, "completed");
  const declinedIndustry = sample({ industryMatch: 1.0 }, "declined");

  it("computes the weighted accuracy delta", () => {
    // current: completed sample scores 1.0*0.25=0.25 (miss), declined sample
    // scores 1.0*0.1=0.1 (correctly low) -> accuracy 1/2. new: completed
    // scores 0.9 (hit), declined scores 0.05 (correctly low) -> accuracy 2/2.
    const improvement = calculateWeightImprovement(
      [completedHighInterest, declinedIndustry],
      currentWeights,
      newWeights,
    );
    expect(improvement).toBeCloseTo(0.5, 10);
  });

  it("is antisymmetric in the weight sets", () => {
    const samples = [completedHighInterest, declinedIndustry];
    const forward = calculateWeightImprovement(
      samples,
      currentWeights,
      newWeights,
    );
    const backward = calculateWeightImprovement(
      samples,
      newWeights,
      currentWeights,
    );
    expect(backward).toBeCloseTo(-forward, 10);
  });

  it("ignores feature keys that are not in FEATURE_KEYS", () => {
    // A rogue key carrying a huge value must contribute exactly nothing:
    // with two known samples the improvement is 2/3, and appending a third
    // sample with or without the rogue key yields the identical 2/3.
    const withoutRogue = [
      completedHighInterest,
      declinedIndustry,
      sample({ interestOverlap: 1.0 }, "completed"),
    ];
    const withRogue = [
      completedHighInterest,
      declinedIndustry,
      sample({ interestOverlap: 1.0, traitAlignment: 50.0 }, "completed"),
    ];

    const baseline = calculateWeightImprovement(
      withoutRogue,
      currentWeights,
      newWeights,
    );
    const withRogueResult = calculateWeightImprovement(
      withRogue,
      currentWeights,
      newWeights,
    );

    expect(baseline).toBeCloseTo(2 / 3, 10);
    expect(withRogueResult).toBeCloseTo(baseline, 10);
  });
});
