/**
 * Insights Mutation Functions
 *
 * This module provides mutation functions for managing post-call insights
 * with privacy controls and per-user data isolation.
 *
 * Requirements: 11.1, 11.2, 11.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import { RecommendationV, LinkV } from "@convex/types/validators/prompt";
import type { AIInsight } from "@convex/types/entities/prompt";

/**
 * Creates insights for a user and meeting (internal use)
 */
export const createInsights = internalMutation({
  args: {
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(RecommendationV),
    links: v.optional(v.array(LinkV)),
  },
  returns: v.id("insights"),
  handler: async (
    ctx,
    { userId, meetingId, summary, actionItems, recommendations, links = [] },
  ): Promise<Id<"insights">> => {
    const now = Date.now();

    // Check if insights already exist for this user and meeting
    const existing = await ctx.db
      .query("insights")
      .withIndex("by_user_meeting", (q) =>
        q.eq("userId", userId).eq("meetingId", meetingId),
      )
      .unique();

    if (existing) {
      // Update existing insights
      await ctx.db.patch(existing._id, {
        summary,
        actionItems,
        recommendations,
        links,
      });
      return existing._id;
    }

    // Create new insights
    return await ctx.db.insert("insights", {
      userId,
      meetingId,
      summary,
      actionItems,
      recommendations,
      links,
      createdAt: now,
    });
  },
});

/**
 * Batch creates insights for multiple users (internal use)
 */
export const batchCreateInsights = internalMutation({
  args: {
    insights: v.array(
      v.object({
        userId: v.id("users"),
        meetingId: v.id("meetings"),
        summary: v.string(),
        actionItems: v.array(v.string()),
        recommendations: v.array(RecommendationV),
        links: v.optional(v.array(LinkV)),
      }),
    ),
  },
  returns: v.array(v.id("insights")),
  handler: async (ctx, { insights }) => {
    const now = Date.now();
    const insightIds: Id<"insights">[] = [];

    for (const insight of insights) {
      // Check if insights already exist for this user and meeting
      const existing = await ctx.db
        .query("insights")
        .withIndex("by_user_meeting", (q) =>
          q.eq("userId", insight.userId).eq("meetingId", insight.meetingId),
        )
        .unique();

      if (existing) {
        // Update existing insights
        await ctx.db.patch(existing._id, {
          summary: insight.summary,
          actionItems: insight.actionItems,
          recommendations: insight.recommendations,
          links: insight.links || [],
        });
        insightIds.push(existing._id);
      } else {
        // Create new insights
        const insightId = await ctx.db.insert("insights", {
          userId: insight.userId,
          meetingId: insight.meetingId,
          summary: insight.summary,
          actionItems: insight.actionItems,
          recommendations: insight.recommendations,
          links: insight.links || [],
          createdAt: now,
        });
        insightIds.push(insightId);
      }
    }

    return insightIds;
  },
});

/**
 * Updates insights with user feedback (marks as read, rates usefulness, etc.)
 */
export const updateInsightsFeedback = mutation({
  args: {
    insightId: v.id("insights"),
    feedback: v.object({
      read: v.optional(v.boolean()),
      useful: v.optional(v.boolean()),
      rating: v.optional(v.number()), // 1-5 scale
      notes: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { insightId, feedback }) => {
    const identity = await requireIdentity(ctx);

    const insight = await ctx.db.get(insightId);
    if (!insight) {
      throw createError.notFound("Insight", insightId);
    }

    // Verify ownership
    await assertOwnershipOrAdmin(ctx, insight.userId);

    // For now, we'll store feedback in metadata
    // In a full implementation, we might have a separate feedback table
    const updatedRecommendations = insight.recommendations.map((rec) => ({
      ...rec,
      // Add feedback metadata (this is a simplified approach)
      metadata: {
        ...((rec as any).metadata || {}),
        userFeedback: feedback,
        updatedAt: Date.now(),
      },
    }));

    await ctx.db.patch(insightId, {
      recommendations: updatedRecommendations,
    });

    return null;
  },
});

/**
 * Deletes insights (user can delete their own insights)
 */
export const deleteInsights = mutation({
  args: {
    insightId: v.id("insights"),
  },
  returns: v.null(),
  handler: async (ctx, { insightId }) => {
    const identity = await requireIdentity(ctx);

    const insight = await ctx.db.get(insightId);
    if (!insight) {
      throw createError.notFound("Insight", insightId);
    }

    // Verify ownership
    await assertOwnershipOrAdmin(ctx, insight.userId);

    await ctx.db.delete(insightId);
    return null;
  },
});

/**
 * Cleans up old insights (internal use)
 */
export const cleanupOldInsights = internalMutation({
  args: {
    olderThanMs: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    remaining: v.boolean(),
  }),
  handler: async (ctx, { olderThanMs, batchSize = 100 }) => {
    const cutoffTime = Date.now() - olderThanMs;

    // Get old insights
    const oldInsights = await ctx.db
      .query("insights")
      .filter((q) => q.lt(q.field("createdAt"), cutoffTime))
      .take(batchSize);

    // Delete them
    for (const insight of oldInsights) {
      await ctx.db.delete(insight._id);
    }

    // Check if there are more to delete
    const remaining = await ctx.db
      .query("insights")
      .filter((q) => q.lt(q.field("createdAt"), cutoffTime))
      .take(1);

    return {
      deleted: oldInsights.length,
      remaining: remaining.length > 0,
    };
  },
});
