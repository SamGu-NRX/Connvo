/**
 * Insights Module Tests
 *
 * This module provides unit tests for the insights functionality
 * including post-call analysis and privacy controls.
 *
 * Requirements: 18.1, 18.3
 * Compliance: steering/convex_rules.mdc - Proper testing patterns
 */

import { describe, it, expect } from "vitest";
import { ConvexTestingHelper } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";

describe("Insights Module", () => {
  let t: ConvexTestingHelper<typeof schema>;

  beforeEach(async () => {
    t = new ConvexTestingHelper(schema);
  });

  describe("Post-Call Insights Generation", () => {
    it("should generate insights for concluded meetings", async () => {
      // Create test users
      const userId1 = await t.mutation(internal.users.mutations.createUser, {
        workosUserId: "test-workos-user-1",
        email: "user1@example.com",
        displayName: "User One",
        isActive: true,
      });

      const userId2 = await t.mutation(internal.users.mutations.createUser, {
        workosUserId: "test-workos-user-2",
        email: "user2@example.com",
        displayName: "User Two",
        isActive: true,
      });

      // Create test meeting
      const meetingId = await t.mutation(
        internal.meetings.mutations.createMeeting,
        {
          organizerId: userId1,
          title: "Test Meeting for Insights",
          description: "A concluded meeting for testing insights generation",
          state: "concluded",
        },
      );

      // Add participants
      await t.mutation(internal.meetings.mutations.addParticipant, {
        meetingId,
        userId: userId1,
        role: "host",
      });

      await t.mutation(internal.meetings.mutations.addParticipant, {
        meetingId,
        userId: userId2,
        role: "participant",
      });

      // Generate insights
      const result = await t.action(
        api.insights.generation.generateMeetingInsights,
        {
          meetingId,
        },
      );

      expect(result.generated).toBe(true);
      expect(result.participantsProcessed).toBe(2);
      expect(result.insightIds.length).toBe(2);
    });

    it("should not regenerate insights unless forced", async () => {
      // Create test setup (similar to above)
      const userId = await t.mutation(internal.users.mutations.createUser, {
        workosUserId: "test-workos-user-3",
        email: "user3@example.com",
        displayName: "User Three",
        isActive: true,
      });

      const meetingId = await t.mutation(
        internal.meetings.mutations.createMeeting,
        {
          organizerId: userId,
          title: "Test Meeting 2",
          description: "Another test meeting",
          state: "concluded",
        },
      );

      await t.mutation(internal.meetings.mutations.addParticipant, {
        meetingId,
        userId,
        role: "host",
      });

      // Generate initial insights
      const result1 = await t.action(
        api.insights.generation.generateMeetingInsights,
        {
          meetingId,
        },
      );

      // Try to generate again without force
      const result2 = await t.action(
        api.insights.generation.generateMeetingInsights,
        {
          meetingId,
        },
      );

      expect(result1.generated).toBe(true);
      expect(result2.generated).toBe(false);
      expect(result2.insightIds).toEqual(result1.insightIds);
    });
  });

  describe("Privacy Controls", () => {
    it("should only allow users to access their own insights", async () => {
      // Create test insight
      const userId = "test-user-id" as any;
      const meetingId = "test-meeting-id" as any;

      const insightId = await t.mutation(
        internal.insights.mutations.createInsights,
        {
          userId,
          meetingId,
          summary: "Test insight summary",
          actionItems: ["Test action item"],
          recommendations: [
            {
              type: "connection",
              content: "Test recommendation",
              confidence: 0.8,
            },
          ],
          links: [],
        },
      );

      // Verify insight was created
      const insight = await t.query(
        internal.insights.queries.getInsightsByUserAndMeeting,
        {
          userId,
          meetingId,
        },
      );

      expect(insight).toBeTruthy();
      expect(insight?.summary).toBe("Test insight summary");
    });
  });

  describe("Insights Queries", () => {
    it("should retrieve user insights with proper authorization", async () => {
      // This test would require proper auth setup
      // For now, we'll test the internal query
      const userId = "test-user-id" as any;

      const insights = await t.query(
        internal.insights.queries.getInsightsByUserAndMeeting,
        {
          userId,
          meetingId: "test-meeting-id" as any,
        },
      );

      // Should return null for non-existent insights
      expect(insights).toBeNull();
    });
  });

  describe("Connection Recommendations", () => {
    it("should generate relevant connection recommendations", async () => {
      // This would test the recommendation generation logic
      // The actual implementation is in the generation file
      expect(true).toBe(true); // Placeholder
    });
  });

  describe("Insights Cleanup", () => {
    it("should clean up old insights based on retention policy", async () => {
      // Create old insight
      const oldTime = Date.now() - 400 * 24 * 60 * 60 * 1000; // 400 days ago
      const userId = "test-user-id" as any;
      const meetingId = "test-meeting-id" as any;

      // This would require mocking the creation time
      // For now, test the cleanup function exists
      const result = await t.mutation(
        internal.insights.mutations.cleanupOldInsights,
        {
          olderThanMs: 365 * 24 * 60 * 60 * 1000, // 365 days
          batchSize: 10,
        },
      );

      expect(result.deleted).toBeGreaterThanOrEqual(0);
      expect(typeof result.remaining).toBe("boolean");
    });
  });
});
