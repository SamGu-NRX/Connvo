/**
 * Intelligent Matching System Tests
 *
 * Comprehensive tests for the matching queue, scoring engine, and analytics.
 *
 * Requirements: 18.1, 18.2 - Unit and integration testing
 * Compliance: steering/convex_rules.mdc - Proper test structure
 */

import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";

type ConvexTestingHelper<T> = ReturnType<typeof convexTest>;

describe("Intelligent Matching System", () => {
  let t: ConvexTestingHelper<typeof schema>;

  beforeEach(async () => {
    t = convexTest();

    // Set up test users
    await t.mutation(internal.users.mutations.createTestUser, {
      workosUserId: "test_user_1",
      email: "user1@test.com",
      displayName: "Test User 1",
    });

    await t.mutation(internal.users.mutations.createTestUser, {
      workosUserId: "test_user_2",
      email: "user2@test.com",
      displayName: "Test User 2",
    });

    // Set up test profiles and interests
    await setupTestProfiles(t);
  });

  describe("Queue Management", () => {
    it("should allow users to enter the matching queue", async () => {
      const userId = await getUserId(t, "test_user_1");
      const now = Date.now();

      const queueId = await t.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now + 60000, // 1 minute from now
        availableTo: now + 3600000, // 1 hour from now
        constraints: {
          interests: ["technology", "ai"],
          roles: ["mentor", "technical"],
          orgConstraints: "any",
        },
      });

      expect(queueId).toBeDefined();

      // Verify queue entry was created
      const queueStatus = await t.query(api.matching.queue.getQueueStatus, {});
      expect(queueStatus).toBeTruthy();
      expect(queueStatus?.status).toBe("waiting");
    });

    it("should prevent duplicate queue entries", async () => {
      const userId = await getUserId(t, "test_user_1");
      const now = Date.now();

      const constraints = {
        interests: ["technology"],
        roles: ["mentor"],
      };

      // First entry should succeed
      await t.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now + 60000,
        availableTo: now + 3600000,
        constraints,
      });

      // Second entry should fail
      await expect(
        t.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now + 120000,
          availableTo: now + 7200000,
          constraints,
        }),
      ).rejects.toThrow("already in the matching queue");
    });

    it("should validate availability windows", async () => {
      const now = Date.now();

      // Past start time should fail
      await expect(
        t.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now - 60000,
          availableTo: now + 3600000,
          constraints: {
            interests: ["technology"],
            roles: ["mentor"],
          },
        }),
      ).rejects.toThrow("cannot start in the past");

      // End before start should fail
      await expect(
        t.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now + 3600000,
          availableTo: now + 60000,
          constraints: {
            interests: ["technology"],
            roles: ["mentor"],
          },
        }),
      ).rejects.toThrow("must be after start time");
    });

    it("should allow users to cancel queue entries", async () => {
      const now = Date.now();

      const queueId = await t.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now + 60000,
        availableTo: now + 3600000,
        constraints: {
          interests: ["technology"],
          roles: ["mentor"],
        },
      });

      await t.mutation(api.matching.queue.cancelQueueEntry, {
        queueId,
      });

      const queueStatus = await t.query(api.matching.queue.getQueueStatus, {});
      expect(queueStatus?.status).toBe("cancelled");
    });

    it("should clean up expired entries", async () => {
      const now = Date.now();

      // Create an entry that's already expired
      await t.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now - 7200000, // 2 hours ago
        availableTo: now - 3600000, // 1 hour ago (expired)
        constraints: {
          interests: ["technology"],
          roles: ["mentor"],
        },
      });

      const result = await t.mutation(
        internal.matching.queue.cleanupExpiredEntries,
        {},
      );
      expect(result.expiredCount).toBe(1);
    });
  });

  describe("Compatibility Scoring", () => {
    it("should calculate interest overlap correctly", async () => {
      const user1Id = await getUserId(t, "test_user_1");
      const user2Id = await getUserId(t, "test_user_2");

      // Set up users with overlapping interests
      await setupUserInterests(t, user1Id, ["technology", "ai", "startups"]);
      await setupUserInterests(t, user2Id, ["technology", "ml", "business"]);

      const result = await t.action(
        api.matching.scoring.calculateCompatibilityScore,
        {
          user1Id,
          user2Id,
          user1Constraints: {
            interests: ["technology", "ai"],
            roles: ["mentor"],
          },
          user2Constraints: {
            interests: ["technology", "ml"],
            roles: ["mentee"],
          },
        },
      );

      expect(result.score).toBeGreaterThan(0);
      expect(result.features.interestOverlap).toBeGreaterThan(0);
      expect(result.explanation).toContain("interest");
    });

    it("should handle missing user data gracefully", async () => {
      const user1Id = await getUserId(t, "test_user_1");
      const nonExistentUserId = "invalid_user_id" as any;

      await expect(
        t.action(api.matching.scoring.calculateCompatibilityScore, {
          user1Id,
          user2Id: nonExistentUserId,
          user1Constraints: {
            interests: ["technology"],
            roles: ["mentor"],
          },
          user2Constraints: {
            interests: ["technology"],
            roles: ["mentee"],
          },
        }),
      ).rejects.toThrow("User data not found");
    });

    it("should calculate role complementarity", async () => {
      const user1Id = await getUserId(t, "test_user_1");
      const user2Id = await getUserId(t, "test_user_2");

      const result = await t.action(
        api.matching.scoring.calculateCompatibilityScore,
        {
          user1Id,
          user2Id,
          user1Constraints: {
            interests: ["technology"],
            roles: ["mentor"],
          },
          user2Constraints: {
            interests: ["technology"],
            roles: ["mentee"],
          },
        },
      );

      expect(result.features.roleComplementarity).toBe(1.0); // Perfect complementarity
    });
  });

  describe("Matching Engine", () => {
    it("should create matches between compatible users", async () => {
      const user1Id = await getUserId(t, "test_user_1");
      const user2Id = await getUserId(t, "test_user_2");
      const now = Date.now();

      // Set up compatible users in queue
      await setupUserInterests(t, user1Id, ["technology", "ai"]);
      await setupUserInterests(t, user2Id, ["technology", "ml"]);

      const queue1Id = await t.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now,
        availableTo: now + 3600000,
        constraints: {
          interests: ["technology"],
          roles: ["mentor"],
        },
      });

      // Switch to user 2
      await t.withIdentity({ subject: "test_user_2" }, async (ctx) => {
        await ctx.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now,
          availableTo: now + 3600000,
          constraints: {
            interests: ["technology"],
            roles: ["mentee"],
          },
        });
      });

      // Run matching cycle
      const result = await t.action(api.matching.engine.runMatchingCycle, {
        shardCount: 1,
        minScore: 0.5,
        maxMatches: 10,
      });

      expect(result.totalMatches).toBeGreaterThan(0);

      // Verify users were matched
      const queueStatus = await t.query(api.matching.queue.getQueueStatus, {});
      expect(queueStatus?.status).toBe("matched");
      expect(queueStatus?.matchedWith).toBe(user2Id);
    });

    it("should respect minimum score threshold", async () => {
      const user1Id = await getUserId(t, "test_user_1");
      const user2Id = await getUserId(t, "test_user_2");
      const now = Date.now();

      // Set up incompatible users
      await setupUserInterests(t, user1Id, ["technology"]);
      await setupUserInterests(t, user2Id, ["art", "design"]);

      await t.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: now,
        availableTo: now + 3600000,
        constraints: {
          interests: ["technology"],
          roles: ["mentor"],
        },
      });

      await t.withIdentity({ subject: "test_user_2" }, async (ctx) => {
        await ctx.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now,
          availableTo: now + 3600000,
          constraints: {
            interests: ["art"],
            roles: ["mentee"],
          },
        });
      });

      // Run matching with high threshold
      const result = await t.action(api.matching.engine.runMatchingCycle, {
        shardCount: 1,
        minScore: 0.9, // Very high threshold
        maxMatches: 10,
      });

      expect(result.totalMatches).toBe(0); // No matches due to low compatibility
    });
  });

  describe("Analytics and Feedback", () => {
    it("should track match outcomes", async () => {
      const matchId = "test_match_123";

      // Submit feedback
      await t.mutation(api.matching.analytics.submitMatchFeedback, {
        matchId,
        outcome: "completed",
        feedback: {
          rating: 5,
          comments: "Great match!",
        },
      });

      // Verify feedback was recorded
      const history = await t.query(api.matching.analytics.getMatchHistory, {
        limit: 10,
      });

      expect(history.length).toBeGreaterThan(0);
      expect(history[0].outcome).toBe("completed");
      expect(history[0].feedback?.rating).toBe(5);
    });

    it("should calculate matching statistics", async () => {
      // Create some test analytics data
      await createTestAnalyticsData(t);

      const stats = await t.query(api.matching.analytics.getMatchingStats, {});

      expect(stats.totalMatches).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
      expect(stats.topFeatures).toBeDefined();
    });

    it("should validate rating bounds", async () => {
      await expect(
        t.mutation(api.matching.analytics.submitMatchFeedback, {
          matchId: "test_match",
          outcome: "completed",
          feedback: {
            rating: 6, // Invalid rating
          },
        }),
      ).rejects.toThrow("Rating must be between 1 and 5");
    });
  });

  // Helper functions
  async function getUserId(
    t: ConvexTestingHelper<typeof schema>,
    workosUserId: string,
  ) {
    const user = await t.query(internal.users.queries.getUserByWorkosId, {
      workosUserId,
    });
    return user?._id;
  }

  async function setupTestProfiles(t: ConvexTestingHelper<typeof schema>) {
    const user1Id = await getUserId(t, "test_user_1");
    const user2Id = await getUserId(t, "test_user_2");

    if (user1Id) {
      await t.mutation(internal.profiles.mutations.createProfile, {
        userId: user1Id,
        displayName: "Test User 1",
        bio: "Software engineer interested in AI",
        experience: "senior",
        languages: ["English", "Spanish"],
        field: "technology",
      });
    }

    if (user2Id) {
      await t.mutation(internal.profiles.mutations.createProfile, {
        userId: user2Id,
        displayName: "Test User 2",
        bio: "Product manager learning about ML",
        experience: "mid",
        languages: ["English", "French"],
        field: "business",
      });
    }
  }

  async function setupUserInterests(
    t: ConvexTestingHelper<typeof schema>,
    userId: string,
    interests: string[],
  ) {
    for (const interest of interests) {
      await t.mutation(internal.interests.mutations.addUserInterest, {
        userId,
        interestKey: interest,
      });
    }
  }

  async function createTestAnalyticsData(
    t: ConvexTestingHelper<typeof schema>,
  ) {
    const userId = await getUserId(t, "test_user_1");
    if (!userId) return;

    // Create some test analytics records
    await t.mutation(internal.matching.analytics.createTestAnalytics, {
      userId,
      matchId: "test_match_1",
      outcome: "completed",
      features: {
        interestOverlap: 0.8,
        experienceGap: 0.7,
        industryMatch: 0.6,
        timezoneCompatibility: 1.0,
        orgConstraintMatch: 1.0,
        languageOverlap: 0.5,
        roleComplementarity: 1.0,
      },
      feedback: {
        rating: 5,
        comments: "Excellent match",
      },
    });
  }
});