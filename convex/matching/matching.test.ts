/**
 * Matching System Tests
 *
 * Focuses on queue management, compatibility scoring, and analytics using the
 * centralized type system. Legacy helper mutations no longer exist, so the
 * tests seed data directly through the Convex test harness.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { UserIdentity } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { QueueStatus } from "@convex/types/entities/matching";
import { createTestEnvironment } from "../../test/convex/helpers";

const HOURS = 60 * 60 * 1000;

type TestServer = ReturnType<typeof createTestEnvironment>;
type AuthedTestServer = ReturnType<TestServer["withIdentity"]>;

describe("Matching System", () => {
  let t: TestServer;
  let userA: UserContext;
  let userB: UserContext;

  beforeEach(async () => {
    t = createTestEnvironment();

    userA = await createUserContext(t, {
      workosUserId: "test-user-1",
      email: "user1@example.com",
      displayName: "Test User 1",
      interests: ["technology", "ai", "startups"],
    });

    userB = await createUserContext(t, {
      workosUserId: "test-user-2",
      email: "user2@example.com",
      displayName: "Test User 2",
      interests: ["technology", "ml", "business"],
    });
  });

  describe("Queue management", () => {
    it("allows users to enter and cancel the queue", async () => {
      const now = Date.now();
      const queueId = await userA.auth.mutation(
        api.matching.queue.enterMatchingQueue,
        {
          availableFrom: now + 60_000,
          availableTo: now + HOURS,
          constraints: {
            interests: ["technology", "ai"],
            roles: ["mentor"],
            orgConstraints: "any",
          },
        },
      );

      expect(queueId).toBeDefined();

      const status = await userA.auth.query(api.matching.queue.getQueueStatus, {});
      expect(status?.status).toBe("waiting");

      await expect(
        userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now + 120_000,
          availableTo: now + HOURS * 2,
          constraints: {
            interests: ["technology"],
            roles: ["mentor"],
          },
        }),
      ).rejects.toThrow("already in the matching queue");

      await userA.auth.mutation(api.matching.queue.cancelQueueEntry, { queueId });
      const cancelled = await userA.auth.query(api.matching.queue.getQueueStatus, {});
      expect(cancelled).toBeNull();
    });
  });

  describe("Compatibility scoring", () => {
    it("computes a positive score for overlapping interests", async () => {
      const result = await t.action(api.matching.scoring.calculateCompatibilityScore, {
        user1Id: userA.id,
        user2Id: userB.id,
        user1Constraints: {
          interests: ["technology", "ai"],
          roles: ["mentor"],
        },
        user2Constraints: {
          interests: ["technology", "ml"],
          roles: ["mentee"],
        },
      });

      expect(result.score).toBeGreaterThan(0);
      expect(result.features.interestOverlap).toBeGreaterThan(0);
      expect(result.explanation.length).toBeGreaterThan(0);
    });
  });

  describe("Match processing", () => {
    it("matches compatible users in the queue", async () => {
      const now = Date.now();
      await userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now + 30_000,
        availableTo: now + HOURS,
        constraints: {
          interests: ["technology", "ai"],
          roles: ["mentor"],
        },
      });

      await userB.auth.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now + 30_000,
        availableTo: now + HOURS,
        constraints: {
          interests: ["technology", "ml"],
          roles: ["mentee"],
        },
      });

      const result = await t.action(api.matching.engine.runMatchingCycle, {
        shardCount: 1,
        minScore: 0.2,
        maxMatches: 10,
      });

      expect(result.totalMatches).toBeGreaterThan(0);

      const status = (await userA.auth.query(
        api.matching.queue.getQueueStatus,
        {},
      )) as QueueStatus | null;

      expect(status?.status).toBe("matched");
      expect(status?.matchedWith).toEqual(userB.id);
    });
  });

  describe("Analytics", () => {
    it("validates rating bounds when submitting feedback", async () => {
      await t.run(async (ctx) => {
        await ctx.db.insert("matchingAnalytics", {
          userId: userA.id,
          matchId: "match-1",
          outcome: "accepted",
          feedback: undefined,
          features: {
            interestOverlap: 0.6,
            experienceGap: 0.4,
            industryMatch: 0.5,
            timezoneCompatibility: 0.5,
            vectorSimilarity: 0.2,
            orgConstraintMatch: 0.7,
            languageOverlap: 0.6,
            roleComplementarity: 0.8,
          },
          weights: {
            interestOverlap: 0.25,
            experienceGap: 0.15,
            industryMatch: 0.1,
            timezoneCompatibility: 0.1,
            vectorSimilarity: 0.2,
            orgConstraintMatch: 0.05,
            languageOverlap: 0.1,
            roleComplementarity: 0.05,
          },
          createdAt: Date.now() - 1,
        });
      });

      await expect(
        userA.auth.mutation(api.matching.analytics.submitMatchFeedback, {
          matchId: "match-1",
          outcome: "completed",
          feedback: { rating: 6 },
        }),
      ).rejects.toThrow("Rating must be between 1 and 5");

      await userA.auth.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId: "match-1",
        outcome: "completed",
        feedback: { rating: 4, comments: "Great match" },
      });

      const history = await userA.auth.query(api.matching.analytics.getMatchHistory, {
        limit: 5,
      });

      expect(history.length).toBeGreaterThan(0);
      expect(history[0].feedback?.rating).toBe(4);
    });
  });
});

/**
 * Helper utilities ---------------------------------------------------------
 */

interface UserContext {
  id: Id<"users">;
  identity: Partial<UserIdentity>;
  auth: AuthedTestServer;
}

async function createUserContext(
  test: TestServer,
  options: {
    workosUserId: string;
    email: string;
    displayName: string;
    interests: string[];
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
      bio: "Test profile",
      goals: "Connect with peers",
      languages: ["English"],
      experience: "senior",
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
