/**
 * Executable documentation: compatibility scoring and match analytics.
 *
 * This file is a runnable walkthrough of the scoring + analytics surface of
 * the matching module. It complements the behavioral tests in matching.test.ts:
 *
 *   1. Seed two fixture users (profiles, interests) and attach fixture
 *      embedding rows directly to the `embeddings` table - the same
 *      seed-through-the-test-harness pattern matching.test.ts uses for
 *      `matchingAnalytics` rows. No external embedding service is involved;
 *      scoring reads the stored vectors and computes cosine similarity
 *      locally via VectorUtils.
 *   2. Call calculateCompatibilityScore and pin the returned shape:
 *      { score, features (8 named feature scores), explanation: string[] }.
 *   3. Show the no-embedding path (vectorSimilarity undefined, its weight
 *      excluded from the weighted average) and the customWeights path.
 *   4. Submit match feedback, then read it back through getMatchHistory and
 *      getMatchingStats.
 *
 * Run: pnpm vitest run convex/matching/examples.scoring.test.ts
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { UserIdentity } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { VectorUtils } from "@convex/types/entities/embedding";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;
type AuthedTestServer = ReturnType<TestServer["withIdentity"]>;

interface UserContext {
  id: Id<"users">;
  identity: Partial<UserIdentity>;
  auth: AuthedTestServer;
}

/**
 * Feature scores stored on seeded matchingAnalytics rows. interestOverlap is
 * deliberately the highest so getMatchingStats ranks it first in topFeatures.
 * Typed as Record<string, number> to match the schema's numericMapV
 * (CompatibilityFeatures is not assignable because vectorSimilarity is
 * optional there).
 */
const SEEDED_FEATURES: Record<string, number> = {
  interestOverlap: 1.0,
  experienceGap: 0.5,
  industryMatch: 0.5,
  timezoneCompatibility: 0.5,
  vectorSimilarity: 0.5,
  orgConstraintMatch: 0.5,
  languageOverlap: 0.5,
  roleComplementarity: 0.5,
};

/** Default weights as applied by calculateCompatibilityScore when no custom weights are passed. */
const SEEDED_WEIGHTS: Record<string, number> = {
  interestOverlap: 0.25,
  experienceGap: 0.15,
  industryMatch: 0.1,
  timezoneCompatibility: 0.1,
  vectorSimilarity: 0.2,
  orgConstraintMatch: 0.05,
  languageOverlap: 0.1,
  roleComplementarity: 0.05,
};

describe("Scoring and analytics walkthrough", () => {
  let t: TestServer;
  let userA: UserContext;
  let userB: UserContext;

  beforeEach(async () => {
    t = createTestEnvironment();

    // Fixture pair: both users list the same four interests, speak English,
    // work in the "Technology" field, and sit two experience levels apart
    // ("junior" -> "senior"), which the scoring engine treats as the ideal
    // mentorship gap.
    userA = await createUserContext(t, {
      workosUserId: "scoring-user-a",
      email: "scoring-a@example.com",
      displayName: "Ada Mentor",
      interests: ["technology", "ai", "startups", "ml"],
      experience: "senior",
      company: "TechCorp",
    });

    userB = await createUserContext(t, {
      workosUserId: "scoring-user-b",
      email: "scoring-b@example.com",
      displayName: "Ben Mentee",
      interests: ["technology", "ai", "startups", "ml"],
      experience: "junior",
      company: "StartupCo",
    });
  });

  it("scores a well-matched pair with mocked embeddings and explains why", async () => {
    // "Mocked" embeddings are fixture rows written straight into the
    // embeddings table (the same seed pattern matching.test.ts uses for
    // matchingAnalytics). Identical vectors under the same model yield a
    // cosine similarity of ~1.0, which scoring normalizes from [-1, 1] to
    // [0, 1].
    await seedEmbedding(t, userA.id, [1, 2, 3, 4]);
    await seedEmbedding(t, userB.id, [1, 2, 3, 4]);

    // calculateCompatibilityScore is a public action and performs no
    // authentication check - it runs here without any identity attached.
    const result = await t.action(
      api.matching.scoring.calculateCompatibilityScore,
      {
        user1Id: userA.id,
        user2Id: userB.id,
        user1Constraints: {
          interests: ["technology", "ai"],
          roles: ["mentor"],
        },
        user2Constraints: {
          interests: ["technology", "ai"],
          roles: ["mentee"],
        },
      },
    );

    // Returned shape: { score, features: <8 named feature scores>,
    // explanation: string[] }.
    expect(Object.keys(result.features).sort()).toEqual(
      [
        "experienceGap",
        "industryMatch",
        "interestOverlap",
        "languageOverlap",
        "orgConstraintMatch",
        "roleComplementarity",
        "timezoneCompatibility",
        "vectorSimilarity",
      ].sort(),
    );

    expect(result.features.interestOverlap).toBeCloseTo(1, 10); // full overlap: 0.7 * actual + 0.3 * constraints
    expect(result.features.experienceGap).toBe(1); // two levels apart is the "ideal" gap
    expect(result.features.industryMatch).toBe(1); // both profiles have field: "Technology"
    expect(result.features.timezoneCompatibility).toBe(1); // hardcoded placeholder in scoring.ts
    expect(result.features.orgConstraintMatch).toBe(1); // no org constraints requested
    expect(result.features.languageOverlap).toBe(1); // both profiles speak ["English"]
    expect(result.features.roleComplementarity).toBe(1); // mentor <-> mentee pair
    expect(result.features.vectorSimilarity).toBeCloseTo(1, 10); // identical fixture vectors

    // Default weights sum to 1.0 and every feature is ~1.0 here, so the
    // weighted score is ~1.0.
    expect(result.score).toBeCloseTo(1, 10);

    // Explanation strings are emitted per feature threshold, in this order.
    expect(result.explanation).toEqual([
      "Strong interest alignment",
      "Ideal experience gap for mentorship",
      "High semantic profile similarity",
      "Complementary professional roles",
      "Strong language compatibility",
    ]);
  });

  it("scores without embeddings: vectorSimilarity is undefined and excluded from the average", async () => {
    // No embeddings were seeded in this test, so the vector-similarity
    // feature is skipped rather than defaulted to zero.
    const result = await t.action(
      api.matching.scoring.calculateCompatibilityScore,
      {
        user1Id: userA.id,
        user2Id: userB.id,
        user1Constraints: {
          interests: ["technology", "ai"],
          roles: ["mentor"],
        },
        user2Constraints: {
          interests: ["technology", "ai"],
          roles: ["mentee"],
        },
      },
    );

    expect(result.features.vectorSimilarity).toBeUndefined();

    // calculateWeightedScore normalizes over the weights actually present,
    // so the missing 0.2 vectorSimilarity weight does not drag the score
    // down: the remaining seven features still produce ~1.0.
    expect(result.score).toBeCloseTo(1, 10);

    // The vector-similarity explanation line only appears above 0.8.
    expect(result.explanation).not.toContain("High semantic profile similarity");
  });

  it("honors customWeights by fully replacing the default weight vector", async () => {
    await seedEmbedding(t, userA.id, [1, 2, 3, 4]);
    await seedEmbedding(t, userB.id, [1, 2, 3, 4]);

    const result = await t.action(
      api.matching.scoring.calculateCompatibilityScore,
      {
        user1Id: userA.id,
        user2Id: userB.id,
        user1Constraints: {
          interests: ["technology", "ai"],
          roles: ["mentor"],
        },
        user2Constraints: {
          interests: ["technology", "ai"],
          roles: ["mentee"],
        },
        customWeights: {
          interestOverlap: 1,
          experienceGap: 0,
          industryMatch: 0,
          timezoneCompatibility: 0,
          vectorSimilarity: 0,
          orgConstraintMatch: 0,
          languageOverlap: 0,
          roleComplementarity: 0,
        },
      },
    );

    // With only interestOverlap weighted (1.0), the weight-normalized score
    // equals that single feature: custom weights replace DEFAULT_WEIGHTS
    // entirely instead of being merged with them.
    expect(result.score).toBeCloseTo(result.features.interestOverlap, 12);
  });

  it("records feedback and reads it back through history and stats", async () => {
    // Seed one analytics row per match - the rows the matching engine would
    // create when a match is made. Rows are per-user.
    await seedAnalyticsRow(t, userA.id, "match-a-b-1", "accepted", {
      createdAt: Date.now() - 1000,
    });
    await seedAnalyticsRow(t, userA.id, "match-a-b-2", "accepted", {
      createdAt: Date.now(),
    });

    // submitMatchFeedback requires an authenticated user (requireIdentity)
    // and patches only the caller's own rows for the given matchId.
    await userA.auth.mutation(api.matching.analytics.submitMatchFeedback, {
      matchId: "match-a-b-1",
      outcome: "completed",
      feedback: { rating: 5, comments: "Great conversation!" },
    });

    // Attaching a rating without changing the outcome category is valid too.
    await userA.auth.mutation(api.matching.analytics.submitMatchFeedback, {
      matchId: "match-a-b-2",
      outcome: "accepted",
      feedback: { rating: 4 },
    });

    // userB has no analytics rows: the mutation is a silent no-op for them.
    await userB.auth.mutation(api.matching.analytics.submitMatchFeedback, {
      matchId: "match-a-b-1",
      outcome: "declined",
    });
    const userBHistory = await userB.auth.query(
      api.matching.analytics.getMatchHistory,
      { limit: 10 },
    );
    expect(userBHistory).toHaveLength(0);

    // getMatchHistory: newest first, feedback and features echoed per row.
    const history = await userA.auth.query(
      api.matching.analytics.getMatchHistory,
      { limit: 10 },
    );
    expect(history.map((row) => row.matchId)).toEqual([
      "match-a-b-2",
      "match-a-b-1",
    ]);
    expect(history[0].outcome).toBe("accepted");
    expect(history[0].feedback?.rating).toBe(4);
    expect(history[1].outcome).toBe("completed");
    expect(history[1].feedback?.rating).toBe(5);
    expect(history[1].features.interestOverlap).toBe(1);
    expect(history[1].features.vectorSimilarity).toBe(0.5);

    // getMatchingStats: aggregates across the caller's rows.
    const stats = await userA.auth.query(
      api.matching.analytics.getMatchingStats,
      {},
    );
    expect(stats.totalMatches).toBe(2);
    expect(stats.acceptedMatches).toBe(1); // match-a-b-2 stayed "accepted"
    expect(stats.completedMatches).toBe(1); // match-a-b-1 was patched to "completed"
    expect(stats.successRate).toBe(1); // completed / accepted
    expect(stats.averageRating).toBe(4.5); // (5 + 4) / 2
    expect(stats.topFeatures.length).toBe(5); // at most 5, sorted by average desc
    expect(stats.topFeatures[0]).toEqual({
      feature: "interestOverlap",
      averageScore: 1,
      count: 2,
    });
  });
});

/** Helper utilities ------------------------------------------------------- */

async function createUserContext(
  test: TestServer,
  options: {
    workosUserId: string;
    email: string;
    displayName: string;
    interests: string[];
    experience: string;
    company: string;
  },
): Promise<UserContext> {
  const now = Date.now();
  const id = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      workosUserId: options.workosUserId,
      email: options.email,
      displayName: options.displayName,
      orgId: "org-fixture",
      orgRole: "member",
      isActive: true,
      lastSeenAt: now,
      onboardingComplete: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  await test.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: id,
      displayName: options.displayName,
      bio: "Fixture profile for scoring examples",
      goals: "Find a mentor",
      languages: ["English"],
      experience: options.experience,
      field: "Technology",
      company: options.company,
      createdAt: now,
      updatedAt: now,
    });

    for (const interest of options.interests) {
      await ctx.db.insert("userInterests", {
        userId: id,
        interestKey: interest,
        createdAt: now,
      });
    }
  });

  const identity: Partial<UserIdentity> = {
    subject: options.workosUserId,
    tokenIdentifier: `test|${options.workosUserId}`,
    email: options.email,
    name: options.displayName,
    issuer: "https://example.com",
  };

  return {
    id,
    identity,
    auth: test.withIdentity(identity),
  };
}

/**
 * Seeds a fixture embedding row (the "mocked" vector) for a user. Scoring
 * reads the latest embedding via getUserScoringData's by_source index lookup.
 */
async function seedEmbedding(
  test: TestServer,
  userId: Id<"users">,
  values: number[],
  model = "text-embedding-3-small",
): Promise<void> {
  await test.run(async (ctx) => {
    await ctx.db.insert("embeddings", {
      sourceType: "user",
      sourceId: userId,
      vector: VectorUtils.floatArrayToBuffer(new Float32Array(values)),
      model,
      dimensions: values.length,
      version: "1",
      metadata: {},
      createdAt: Date.now(),
    });
  });
}

/**
 * Seeds a matchingAnalytics row the way the matching engine would after
 * creating a match - the same direct-insert pattern used in matching.test.ts.
 */
async function seedAnalyticsRow(
  test: TestServer,
  userId: Id<"users">,
  matchId: string,
  outcome: "accepted" | "declined" | "completed",
  options: { createdAt: number },
): Promise<void> {
  await test.run(async (ctx) => {
    await ctx.db.insert("matchingAnalytics", {
      userId,
      matchId,
      outcome,
      feedback: undefined,
      features: SEEDED_FEATURES,
      weights: SEEDED_WEIGHTS,
      createdAt: options.createdAt,
    });
  });
}
