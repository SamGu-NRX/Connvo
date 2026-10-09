/**
 * Contract tests for convex/matching/scoring.ts
 *
 * Pins the public surface of the scoring module:
 * - the public action requires an authenticated identity
 * - self-pairing and out-of-range/NaN custom weights are rejected with the
 *   exact validation messages produced by convex/matching/validators.ts
 * - missing users surface the legacy "User data not found for scoring" error
 * - absent embeddings re-normalize the weighted score over present features
 * - the internal action behaves identically without an identity
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { UserIdentity } from "convex/server";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CompatibilityFeatures } from "@convex/types/entities/matching";
import { VectorUtils } from "@convex/types/entities/embedding";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;
type AuthedTestServer = ReturnType<TestServer["withIdentity"]>;

/** All weight keys in the order the handlers validate them. */
const WEIGHT_KEYS: (keyof CompatibilityFeatures)[] = [
  "interestOverlap",
  "experienceGap",
  "industryMatch",
  "timezoneCompatibility",
  "vectorSimilarity",
  "orgConstraintMatch",
  "languageOverlap",
  "roleComplementarity",
];

/** Default weights mirrored from scoring.ts for the weighted-mean oracle. */
const DEFAULT_WEIGHTS: CompatibilityFeatures = {
  interestOverlap: 0.25,
  experienceGap: 0.15,
  industryMatch: 0.1,
  timezoneCompatibility: 0.1,
  vectorSimilarity: 0.2,
  orgConstraintMatch: 0.05,
  languageOverlap: 0.1,
  roleComplementarity: 0.05,
};

describe("Compatibility scoring", () => {
  let t: TestServer;
  let userA: UserContext;
  let userB: UserContext;

  beforeEach(async () => {
    t = createTestEnvironment();

    userA = await seedUser(t, {
      workosUserId: "scoring-user-1",
      email: "scoring1@example.com",
      displayName: "Scoring User 1",
      interests: ["technology", "ai", "startups"],
      profile: { field: "Technology", experience: "senior", languages: ["English"] },
    });

    userB = await seedUser(t, {
      workosUserId: "scoring-user-2",
      email: "scoring2@example.com",
      displayName: "Scoring User 2",
      interests: ["technology", "ai", "business"],
      profile: { field: "Technology", experience: "senior", languages: ["English"] },
    });
  });

  describe("authentication", () => {
    it("rejects unauthenticated callers of the public action", async () => {
      const data = await rejectionData(
        t.action(
          api.matching.scoring.calculateCompatibilityScore,
          scoringArgs(userA, userB),
        ),
      );
      expect(data).toMatchObject({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    });
  });

  describe("argument validation", () => {
    it("rejects scoring a user against themself", async () => {
      const data = await rejectionData(
        userA.auth.action(api.matching.scoring.calculateCompatibilityScore, {
          ...scoringArgs(userA, userB),
          user2Id: userA.id,
        }),
      );
      expect(data).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "user2Id: must differ from user1Id",
      });
    });

    it("rejects custom weights above 1 with the exact validation error", async () => {
      const data = await rejectionData(
        userA.auth.action(
          api.matching.scoring.calculateCompatibilityScore,
          scoringArgs(userA, userB, { interestOverlap: 1.2 }),
        ),
      );
      expect(data).toMatchObject({
        code: "VALIDATION_ERROR",
        message:
          "interestOverlap: must be a number between 0 and 1 (got 1.2)",
      });
    });

    it("rejects NaN custom weights with the exact validation error", async () => {
      const data = await rejectionData(
        userA.auth.action(
          api.matching.scoring.calculateCompatibilityScore,
          scoringArgs(userA, userB, { interestOverlap: Number.NaN }),
        ),
      );
      expect(data).toMatchObject({
        code: "VALIDATION_ERROR",
        message:
          "interestOverlap: must be a number between 0 and 1 (got NaN)",
      });
    });
  });

  describe("scoring results", () => {
    it("computes a positive score for two compatible users", async () => {
      const result = await userA.auth.action(
        api.matching.scoring.calculateCompatibilityScore,
        scoringArgs(userA, userB),
      );

      expect(result.score).toBeGreaterThan(0);
      expect(result.features.interestOverlap).toBeGreaterThan(0);
      expect(result.explanation.length).toBeGreaterThan(0);
      // Shared interests beyond the constraint overlap push this over 0.7.
      expect(result.explanation).toContain("Strong interest alignment");
    });

    it("reports high semantic similarity for identical embeddings", async () => {
      await seedEmbedding(t, userA.id, [0.2, 0.4, 0.6, 0.8]);
      await seedEmbedding(t, userB.id, [0.2, 0.4, 0.6, 0.8]);

      const result = await userA.auth.action(
        api.matching.scoring.calculateCompatibilityScore,
        scoringArgs(userA, userB),
      );

      expect(result.features.vectorSimilarity).toBeCloseTo(1, 10);
      expect(result.explanation).toContain("High semantic profile similarity");
    });

    it("scores without embeddings as the weighted mean over present features", async () => {
      const result = await userA.auth.action(
        api.matching.scoring.calculateCompatibilityScore,
        scoringArgs(userA, userB),
      );

      // vectorSimilarity is absent, so its weight must be excluded from both
      // the numerator and the denominator (re-normalization).
      expect(result.features.vectorSimilarity).toBeUndefined();

      let numerator = 0;
      let denominator = 0;
      for (const key of WEIGHT_KEYS) {
        const value = result.features[key];
        if (value === undefined) continue;
        numerator += value * (DEFAULT_WEIGHTS[key] as number);
        denominator += DEFAULT_WEIGHTS[key] as number;
      }
      expect(result.score).toBeCloseTo(numerator / denominator, 10);
    });

    it("excludes the absent vectorSimilarity weight when re-normalizing custom weights", async () => {
      // Only interestOverlap carries effective weight among present features;
      // the absent vectorSimilarity's 0.3 must not enter the denominator.
      const result = await userA.auth.action(
        api.matching.scoring.calculateCompatibilityScore,
        scoringArgs(userA, userB, {
          interestOverlap: 0.6,
          experienceGap: 0,
          industryMatch: 0,
          timezoneCompatibility: 0,
          vectorSimilarity: 0.3,
          orgConstraintMatch: 0,
          languageOverlap: 0,
          roleComplementarity: 0,
        }),
      );

      expect(result.features.vectorSimilarity).toBeUndefined();
      expect(result.score).toBeCloseTo(result.features.interestOverlap, 10);
    });
  });

  describe("error handling", () => {
    it("reports the legacy not-found error for a nonexistent user", async () => {
      const ghostId = await t.run(async (ctx) => {
        const now = Date.now();
        const id = await ctx.db.insert("users", {
          workosUserId: "ghost-user",
          email: "ghost@example.com",
          displayName: "Ghost User",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.delete(id);
        return id;
      });

      await expect(
        userA.auth.action(
          api.matching.scoring.calculateCompatibilityScore,
          scoringArgs(userA, userB, undefined, ghostId),
        ),
      ).rejects.toThrow("User data not found for scoring");
    });
  });

  describe("internal action parity", () => {
    it("runs without an identity and matches the public result", async () => {
      const internalResult = await t.action(
        internal.matching.scoring.calculateCompatibilityScoreInternal,
        scoringArgs(userA, userB),
      );

      const publicResult = await userA.auth.action(
        api.matching.scoring.calculateCompatibilityScore,
        scoringArgs(userA, userB),
      );

      expect(internalResult.score).toBeGreaterThan(0);
      expect(internalResult).toEqual(publicResult);
    });
  });
});

/**
 * Test fixtures -------------------------------------------------------------
 */

/**
 * Awaits a promise expected to reject and returns the rejection's error data.
 *
 * convex-test runs actions through a serialization boundary, so a structured
 * ConvexError payload arrives on `error.data` as a JSON string (the same
 * string as `error.message`). This parses it back so tests can pin the exact
 * code and message. String payloads (legacy errors) are returned as-is.
 */
async function rejectionData(
  promise: Promise<unknown>,
): Promise<Record<string, unknown> | string> {
  try {
    await promise;
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string") {
      try {
        return JSON.parse(data) as Record<string, unknown>;
      } catch {
        return data;
      }
    }
    if (data !== undefined && data !== null) {
      return data as Record<string, unknown>;
    }
    throw error;
  }
  throw new Error("Expected the promise to reject, but it resolved");
}

interface UserContext {
  id: Id<"users">;
  identity: Partial<UserIdentity>;
  auth: AuthedTestServer;
}

function scoringArgs(
  user1: UserContext,
  user2: UserContext,
  weightOverrides?: Partial<Record<keyof CompatibilityFeatures, number>>,
  user2IdOverride?: Id<"users">,
) {
  return {
    user1Id: user1.id,
    user2Id: user2IdOverride ?? user2.id,
    user1Constraints: {
      interests: ["technology", "ai"],
      roles: ["mentor"],
    },
    user2Constraints: {
      interests: ["technology", "ai"],
      roles: ["mentee"],
    },
    customWeights:
      weightOverrides === undefined
        ? undefined
        : fullWeights(weightOverrides),
  };
}

function fullWeights(
  overrides: Partial<Record<keyof CompatibilityFeatures, number>>,
): Record<keyof CompatibilityFeatures, number> {
  const weights = {
    interestOverlap: 0.25,
    experienceGap: 0.15,
    industryMatch: 0.1,
    timezoneCompatibility: 0.1,
    vectorSimilarity: 0.2,
    orgConstraintMatch: 0.05,
    languageOverlap: 0.1,
    roleComplementarity: 0.05,
  };
  return { ...weights, ...overrides };
}

async function seedUser(
  test: TestServer,
  options: {
    workosUserId: string;
    email: string;
    displayName: string;
    interests: string[];
    profile: { field: string; experience: string; languages: string[] };
  },
): Promise<UserContext> {
  const now = Date.now();
  const id = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      workosUserId: options.workosUserId,
      email: options.email,
      displayName: options.displayName,
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
      bio: "Scoring test profile",
      languages: options.profile.languages,
      experience: options.profile.experience,
      field: options.profile.field,
      createdAt: now,
      updatedAt: now,
    });

    for (const interestKey of options.interests) {
      await ctx.db.insert("userInterests", {
        userId: id,
        interestKey,
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
