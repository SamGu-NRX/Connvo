/**
 * Insights Module Tests
 *
 * Verifies post-call insight generation, querying, and maintenance.
 * The tests operate directly on the Convex test harness to avoid relying on
 * legacy helper mutations that no longer exist after centralizing types.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;

describe("Insights Module", () => {
  let t: TestServer;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  describe("Post-call insight generation", () => {
    it("generates insights for each participant in a concluded meeting", async () => {
      const organizerId = await createTestUser(t, "workos-user-1", {
        displayName: "Organizer",
      });
      const participantId = await createTestUser(t, "workos-user-2", {
        displayName: "Participant",
      });

      const meetingId = await createConcludedMeeting(t, organizerId, [participantId]);
      await seedInsightsContext(t, meetingId);

      const result = await t.action(api.insights.generation.generateInsights, {
        meetingId,
      });

      expect(result.success).toBe(true);
      expect(result.insightsGenerated).toBe(2);
      expect(result.participantInsights).toHaveLength(2);

      const organizerInsight = await t.query(
        internal.insights.queries.getInsightsByUserAndMeeting,
        { userId: organizerId, meetingId },
      );
      expect(organizerInsight?.summary).toContain("meeting");
    });

    it("skips regeneration unless forced", async () => {
      const organizerId = await createTestUser(t, "workos-user-3");
      const meetingId = await createConcludedMeeting(t, organizerId, []);
      await seedInsightsContext(t, meetingId);

      const first = await t.action(api.insights.generation.generateInsights, {
        meetingId,
      });
      expect(first.insightsGenerated).toBeGreaterThan(0);

      const second = await t.action(api.insights.generation.generateInsights, {
        meetingId,
      });
      expect(second.insightsGenerated).toBe(0);
      expect(second.participantInsights).toEqual(first.participantInsights);

      const forced = await t.action(api.insights.generation.generateInsights, {
        meetingId,
        forceRegenerate: true,
      });
      expect(forced.insightsGenerated).toBeGreaterThan(0);
    });
  });

  describe("Insight queries and maintenance", () => {
    it("returns insights by user and meeting", async () => {
      const organizerId = await createTestUser(t, "workos-user-4", {
        displayName: "Lookup User",
      });
      const meetingId = await createConcludedMeeting(t, organizerId, []);
      await seedInsightsContext(t, meetingId);
      await t.action(api.insights.generation.generateInsights, { meetingId });

      const insight = await t.query(
        internal.insights.queries.getInsightsByUserAndMeeting,
        { userId: organizerId, meetingId },
      );

      expect(insight).not.toBeNull();
      if (!insight) throw new Error("Insight should exist");
      expect(insight.actionItems.length).toBeGreaterThan(0);
    });

    it("cleans up insights older than the retention window", async () => {
      const userId = await createTestUser(t, "workos-user-5");
      const meetingId = await createConcludedMeeting(t, userId, []);

      const now = Date.now();
      await insertInsight(t, {
        userId,
        meetingId,
        createdAt: now - 400 * 24 * 60 * 60 * 1000, // 400 days ago
      });
      const recentId = await insertInsight(t, {
        userId,
        meetingId,
        createdAt: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
      });

      const result = await t.mutation(internal.insights.mutations.cleanupOldInsights, {
        olderThanMs: 365 * 24 * 60 * 60 * 1000,
        batchSize: 50,
      });

      expect(result.deleted).toBe(1);
      expect(result.remaining).toBe(false);

      const remaining = await t.query(
        internal.insights.queries.getInsightsByUserAndMeeting,
        { userId, meetingId },
      );

      expect(remaining?._id).toEqual(recentId);
    });
  });
});

/**
 * Helper utilities ---------------------------------------------------------
 */

async function createTestUser(
  test: TestServer,
  workosUserId: string,
  overrides: Partial<{
    email: string;
    displayName: string;
    orgId: string;
    orgRole: string;
  }> = {},
): Promise<Id<"users">> {
  const now = Date.now();
  return await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      workosUserId,
      email: overrides.email ?? `${workosUserId}@example.com`,
      displayName: overrides.displayName,
      orgId: overrides.orgId,
      orgRole: overrides.orgRole,
      isActive: true,
      lastSeenAt: now,
      onboardingComplete: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function createConcludedMeeting(
  test: TestServer,
  organizerId: Id<"users">,
  participantIds: Id<"users">[],
  overrides: Partial<{
    title: string;
    description: string;
  }> = {},
): Promise<Id<"meetings">> {
  const now = Date.now();
  return await test.run(async (ctx) => {
    const meetingId = await ctx.db.insert("meetings", {
      organizerId,
      title: overrides.title ?? "Test Meeting",
      description: overrides.description ?? "Generated for insights testing",
      scheduledAt: now - 3600000,
      duration: 3600000,
      webrtcEnabled: true,
      state: "concluded",
      participantCount: participantIds.length + 1,
      createdAt: now - 7200000,
      updatedAt: now - 300000,
    });

    const participants = new Map<Id<"users">, "host" | "participant">();
    participants.set(organizerId, "host");
    for (const id of participantIds) {
      participants.set(id, "participant");
    }

    for (const [userId, role] of participants.entries()) {
      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId,
        role,
        joinedAt: now - 3600000,
        leftAt: now - 1800000,
        presence: "joined",
        createdAt: now - 3600000,
      });
    }

    return meetingId;
  });
}

async function seedInsightsContext(
  test: TestServer,
  meetingId: Id<"meetings">,
): Promise<void> {
  const now = Date.now();
  await test.run(async (ctx) => {
    await ctx.db.insert("transcriptSegments", {
      meetingId,
      startMs: 0,
      endMs: 60000,
      speakers: ["speaker1", "speaker2"],
      text: "We will follow up on the AI roadmap and share actionable next steps.",
      topics: ["AI", "roadmap"],
      sentiment: 0.6,
      createdAt: now,
    });

    await ctx.db.insert("meetingNotes", {
      meetingId,
      content: "- [ ] Prepare summary for stakeholders\nAction: Schedule follow up",
      version: 1,
      lastRebasedAt: now,
      updatedAt: now,
    });
  });
}

async function insertInsight(
  test: TestServer,
  params: {
    userId: Id<"users">;
    meetingId: Id<"meetings">;
    createdAt: number;
  },
): Promise<Id<"insights">> {
  return await test.run(async (ctx) => {
    return await ctx.db.insert("insights", {
      userId: params.userId,
      meetingId: params.meetingId,
      summary: "Historic insight",
      actionItems: ["Follow up"],
      recommendations: [
        {
          type: "connection",
          content: "Reach out to peers",
          confidence: 0.5,
        },
      ],
      links: [],
      createdAt: params.createdAt,
    });
  });
}
