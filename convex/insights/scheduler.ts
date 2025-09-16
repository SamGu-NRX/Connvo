/**
 * Insights Generation Scheduler
 *
 * This module provides scheduled functions for automatic post-call
 * insights generation and cleanup.
 *
 * Requirements: 11.1, 11.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex scheduling patterns
 */

import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Processes concluded meetings and generates insights
 */
export const processCompletedMeetings = internalAction({
  args: {},
  returns: v.object({
    meetingsProcessed: v.number(),
    insightsGenerated: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx) => {
    let meetingsProcessed = 0;
    let insightsGenerated = 0;
    let errors = 0;

    try {
      // Get recently concluded meetings that don't have insights yet
      const recentlyCompletedMeetings = await ctx.runQuery(
        internal.insights.scheduler.getRecentlyCompletedMeetingsWithoutInsights,
        {
          hoursAgo: 24, // Process meetings concluded in the last 24 hours
          limit: 20, // Process in batches
        },
      );

      for (const meeting of recentlyCompletedMeetings) {
        try {
          const result = await ctx.runAction(
            internal.insights.generation.generateInsights,
            {
              meetingId: meeting._id,
            },
          );

          meetingsProcessed++;
          insightsGenerated += result.participantInsights.length;
        } catch (error) {
          console.error(
            `Failed to generate insights for meeting ${meeting._id}:`,
            error,
          );
          errors++;
        }
      }

      return {
        meetingsProcessed,
        insightsGenerated,
        errors,
      };
    } catch (error) {
      console.error("Failed to process completed meetings:", error);
      return {
        meetingsProcessed,
        insightsGenerated,
        errors: errors + 1,
      };
    }
  },
});

/**
 * Gets recently completed meetings without insights (internal query)
 */
export const getRecentlyCompletedMeetingsWithoutInsights = internalMutation({
  args: {
    hoursAgo: v.number(),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("meetings"),
      title: v.string(),
      organizerId: v.id("users"),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { hoursAgo, limit }) => {
    const cutoffTime = Date.now() - hoursAgo * 60 * 60 * 1000;

    // Get concluded meetings from the specified time period
    const concludedMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_state", (q) => q.eq("state", "concluded"))
      .filter((q) => q.gt(q.field("updatedAt"), cutoffTime))
      .take(limit * 2); // Get more than needed to filter

    // Filter out meetings that already have insights
    const meetingsWithoutInsights = [];
    for (const meeting of concludedMeetings) {
      const existingInsights = await ctx.db
        .query("insights")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .take(1);

      if (existingInsights.length === 0) {
        meetingsWithoutInsights.push({
          _id: meeting._id,
          title: meeting.title,
          organizerId: meeting.organizerId,
          updatedAt: meeting.updatedAt,
        });

        if (meetingsWithoutInsights.length >= limit) {
          break;
        }
      }
    }

    return meetingsWithoutInsights;
  },
});

/**
 * Cleans up old insights based on retention policies
 */
export const cleanupOldInsights = internalAction({
  args: {
    retentionDays: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    batchesProcessed: v.number(),
  }),
  handler: async (ctx, { retentionDays = 365 }) => {
    // Default: 1 year retention
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    let totalDeleted = 0;
    let batchesProcessed = 0;
    const batchSize = 100;

    try {
      let hasMore = true;
      while (hasMore) {
        const result = await ctx.runMutation(
          internal.insights.mutations.cleanupOldInsights,
          {
            olderThanMs: retentionMs,
            batchSize,
          },
        );

        totalDeleted += result.deleted;
        batchesProcessed++;
        hasMore = result.remaining;

        // Prevent infinite loops
        if (batchesProcessed > 100) {
          console.warn("Insights cleanup: processed maximum batches, stopping");
          break;
        }
      }

      return {
        deleted: totalDeleted,
        batchesProcessed,
      };
    } catch (error) {
      console.error("Failed to cleanup old insights:", error);
      return {
        deleted: totalDeleted,
        batchesProcessed,
      };
    }
  },
});
