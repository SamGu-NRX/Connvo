/**
 * Prompt Generation Scheduler
 *
 * This module provides scheduled functions for automatic lull detection
 * and contextual prompt generation during active meetings.
 *
 * Requirements: 10.1, 10.2, 10.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex scheduling patterns
 */

import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

/**
 * Periodically checks active meetings for lulls and generates prompts
 */
export const checkActiveMeetingsForLulls = internalAction({
  args: {},
  returns: v.object({
    meetingsChecked: v.number(),
    lullsDetected: v.number(),
    promptsGenerated: v.number(),
  }),
  handler: async (ctx) => {
    let meetingsChecked = 0;
    let lullsDetected = 0;
    let promptsGenerated = 0;

    try {
      // Get all active meetings
      const activeMeetings = await ctx.runQuery(
        internal.meetings.queries.getActiveMeetings,
        {
          limit: 100,
        },
      );

      meetingsChecked = activeMeetings.length;

      for (const meeting of activeMeetings) {
        try {
          // Check for lull and generate prompts if needed
          const result = await ctx.runAction(
            internal.prompts.actions.detectLullAndGeneratePrompts,
            {
              meetingId: meeting._id,
            },
          );

          if (result.lullDetected) {
            lullsDetected++;
            promptsGenerated += result.promptsGenerated;
          }
        } catch (error) {
          console.error(
            `Failed to check meeting ${meeting._id} for lulls:`,
            error,
          );
        }
      }

      return {
        meetingsChecked,
        lullsDetected,
        promptsGenerated,
      };
    } catch (error) {
      console.error("Failed to check active meetings for lulls:", error);
      return {
        meetingsChecked,
        lullsDetected,
        promptsGenerated,
      };
    }
  },
});

/**
 * Generates prompts based on topic shifts detected in transcripts
 */
export const generatePromptsForTopicShifts = internalAction({
  args: {
    meetingId: v.id("meetings"),
    newTopics: v.array(v.string()),
    previousTopics: v.array(v.string()),
  },
  returns: v.array(v.id("prompts")),
  handler: async (ctx, { meetingId, newTopics, previousTopics }) => {
    try {
      // Detect if there's been a significant topic shift
      const topicShift = detectTopicShift(newTopics, previousTopics);

      if (!topicShift) {
        return [];
      }

      // Get current meeting state for context
      const meetingState = await ctx.runQuery(
        internal.meetings.queries.getMeetingState,
        {
          meetingId,
        },
      );

      if (!meetingState || !meetingState.active) {
        return [];
      }

      // Generate contextual prompts for the topic shift
      const promptIds = await ctx.runAction(
        internal.prompts.actions.generateContextualPrompts,
        {
          meetingId,
          context: {
            lullDetected: false,
            topicShift: true,
            currentTopics: newTopics,
            speakingTimeRatios: meetingState.speakingStats?.byUserMs || {},
            lastActivity: Date.now(),
          },
        },
      );

      return promptIds;
    } catch (error) {
      console.error("Failed to generate prompts for topic shift:", error);
      return [];
    }
  },
});

/**
 * Cleans up old prompts from concluded meetings
 */
export const cleanupOldPrompts = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
  },
  returns: v.object({
    meetingsProcessed: v.number(),
    promptsDeleted: v.number(),
  }),
  handler: async (ctx, { olderThanMs = 7 * 24 * 60 * 60 * 1000 }) => {
    // Default: 7 days
    let meetingsProcessed = 0;
    let promptsDeleted = 0;

    try {
      const cutoffTime = Date.now() - olderThanMs;

      // Get concluded meetings older than cutoff
      const oldMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_state", (q) => q.eq("state", "concluded"))
        .filter((q) => q.lt(q.field("updatedAt"), cutoffTime))
        .take(50); // Process in batches

      for (const meeting of oldMeetings) {
        try {
          // Get all prompts for this meeting
          const prompts = await ctx.db
            .query("prompts")
            .withIndex("by_meeting_type", (q) => q.eq("meetingId", meeting._id))
            .collect();

          // Delete all prompts
          for (const prompt of prompts) {
            await ctx.db.delete(prompt._id);
            promptsDeleted++;
          }

          meetingsProcessed++;
        } catch (error) {
          console.error(
            `Failed to cleanup prompts for meeting ${meeting._id}:`,
            error,
          );
        }
      }

      return {
        meetingsProcessed,
        promptsDeleted,
      };
    } catch (error) {
      console.error("Failed to cleanup old prompts:", error);
      return {
        meetingsProcessed: 0,
        promptsDeleted: 0,
      };
    }
  },
});

/**
 * Detects if there's been a significant topic shift
 */
function detectTopicShift(
  newTopics: string[],
  previousTopics: string[],
): boolean {
  if (previousTopics.length === 0) {
    return false; // No previous topics to compare
  }

  if (newTopics.length === 0) {
    return false; // No new topics
  }

  // Calculate overlap between topic sets
  const newTopicSet = new Set(newTopics.map((t) => t.toLowerCase()));
  const previousTopicSet = new Set(previousTopics.map((t) => t.toLowerCase()));

  const intersection = new Set(
    [...newTopicSet].filter((t) => previousTopicSet.has(t)),
  );
  const union = new Set([...newTopicSet, ...previousTopicSet]);

  const overlapRatio = intersection.size / union.size;

  // Consider it a topic shift if less than 30% overlap
  return overlapRatio < 0.3;
}
