/**
 * Insights Query Functions
 *
 * This module provides query functions for post-call insights with
 * privacy controls and per-user access restrictions.
 *
 * Requirements: 11.1, 11.3, 11.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import {
  AIInsightV,
  ConnectionRecommendationV,
} from "@convex/types/validators/prompt";
import type { AIInsight } from "@convex/types/entities/prompt";

/**
 * Gets insights for a user and meeting (internal use)
 */
export const getInsightsByUserAndMeeting = internalQuery({
  args: {
    userId: v.id("users"),
    meetingId: v.id("meetings"),
  },
  returns: v.union(AIInsightV.full, v.null()),
  handler: async (ctx, { userId, meetingId }): Promise<AIInsight | null> => {
    return await ctx.db
      .query("insights")
      .withIndex("by_user_meeting", (q) =>
        q.eq("userId", userId).eq("meetingId", meetingId),
      )
      .unique();
  },
});

/**
 * Gets user's insights for a specific meeting with privacy controls
 */
export const getMeetingInsights = query({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.union(
    v.object({
      _id: v.id("insights"),
      summary: v.string(),
      actionItems: v.array(v.string()),
      recommendations: v.array(
        v.object({
          type: v.string(),
          content: v.string(),
          confidence: v.number(),
        }),
      ),
      links: v.array(
        v.object({
          type: v.string(),
          url: v.string(),
          title: v.string(),
        }),
      ),
      createdAt: v.number(),
      meetingTitle: v.string(),
      meetingDate: v.number(),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    { meetingId },
  ): Promise<{
    _id: Id<"insights">;
    summary: string;
    actionItems: string[];
    recommendations: Array<{
      type: string;
      content: string;
      confidence: number;
    }>;
    links: Array<{
      type: string;
      url: string;
      title: string;
    }>;
    createdAt: number;
    meetingTitle: string;
    meetingDate: number;
  } | null> => {
    const identity = await requireIdentity(ctx);

    // Get the meeting to verify access and get basic info
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    // Check if user was a participant in the meeting
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();

    if (!participant) {
      throw createError.forbidden("Access denied: Not a meeting participant", {
        meetingId,
        userId: identity.userId,
      });
    }

    // Get user's personal insights for this meeting
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user_meeting", (q) =>
        q.eq("userId", identity.userId).eq("meetingId", meetingId),
      )
      .unique();

    if (!insights) {
      return null;
    }

    return {
      _id: insights._id,
      summary: insights.summary,
      actionItems: insights.actionItems,
      recommendations: insights.recommendations,
      links: insights.links,
      createdAt: insights.createdAt,
      meetingTitle: meeting.title,
      meetingDate: meeting.scheduledAt || meeting.createdAt,
    };
  },
});

/**
 * Lists all insights for the current user
 */
export const getUserInsights = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  returns: v.array(AIInsightV.listItem),
  handler: async (ctx, { limit = 20, offset = 0 }) => {
    const identity = await requireIdentity(ctx);

    // Get user's insights
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .order("desc")
      .take(limit + offset);

    // Skip offset and take limit
    const paginatedInsights = insights.slice(offset, offset + limit);

    // Enrich with meeting information
    const enrichedInsights = [];
    for (const insight of paginatedInsights) {
      const meeting = await ctx.db.get(insight.meetingId);
      if (meeting) {
        enrichedInsights.push({
          _id: insight._id,
          _creationTime: insight._creationTime,
          meetingId: insight.meetingId,
          summary: insight.summary,
          actionItems: insight.actionItems,
          recommendations: insight.recommendations,
          createdAt: insight.createdAt,
          meetingTitle: meeting.title,
          meetingDate: meeting.scheduledAt || meeting.createdAt,
        });
      }
    }

    return enrichedInsights;
  },
});

/**
 * Gets insights by ID with ownership verification
 */
export const getInsightById = query({
  args: {
    insightId: v.id("insights"),
  },
  returns: v.union(AIInsightV.withMeeting, v.null()),
  handler: async (ctx, { insightId }) => {
    const identity = await requireIdentity(ctx);

    const insight = await ctx.db.get(insightId);
    if (!insight) {
      return null;
    }

    // Verify ownership
    await assertOwnershipOrAdmin(ctx, insight.userId);

    // Get meeting information
    const meeting = await ctx.db.get(insight.meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", insight.meetingId);
    }

    return {
      _id: insight._id,
      _creationTime: insight._creationTime,
      meetingId: insight.meetingId,
      summary: insight.summary,
      actionItems: insight.actionItems,
      recommendations: insight.recommendations,
      links: insight.links,
      createdAt: insight.createdAt,
      meetingTitle: meeting.title,
      meetingDate: meeting.scheduledAt || meeting.createdAt,
    };
  },
});

/**
 * Gets connection recommendations from insights
 */
export const getConnectionRecommendations = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(ConnectionRecommendationV),
  handler: async (ctx, { limit = 10 }) => {
    const identity = await requireIdentity(ctx);

    // Get user's insights
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .order("desc")
      .take(50); // Look at recent insights

    const recommendations = [];

    for (const insight of insights) {
      // Filter for connection-type recommendations
      const connectionRecs = insight.recommendations.filter(
        (rec) => rec.type === "connection" || rec.type === "follow-up",
      );

      if (connectionRecs.length > 0) {
        const meeting = await ctx.db.get(insight.meetingId);
        if (meeting) {
          for (const rec of connectionRecs) {
            recommendations.push({
              type: rec.type,
              content: rec.content,
              confidence: rec.confidence,
              meetingId: insight.meetingId,
              meetingTitle: meeting.title,
              createdAt: insight.createdAt,
            });
          }
        }
      }

      if (recommendations.length >= limit) {
        break;
      }
    }

    // Sort by confidence and creation time
    return recommendations
      .sort((a, b) => {
        if (a.confidence !== b.confidence) {
          return b.confidence - a.confidence;
        }
        return b.createdAt - a.createdAt;
      })
      .slice(0, limit);
  },
});
