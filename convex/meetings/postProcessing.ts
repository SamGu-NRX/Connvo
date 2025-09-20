/**
 * Meeting Post-Processing Actions
 *
 * This module handles post-meeting processing including transcript aggregation,
 * insight generation, and cleanup tasks.
 *
 * Requirements: 6.4, 7.5, 11.1
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

// TODO: Review whether or not the preset delay is robust for different enviroments (bandwidths)
// -- doesn't seem like the most scalable nor efficient approach? what about just `await` actions

import { internalAction } from "@convex/_generated/server";
import { v } from "convex/values";
import { internal } from "@convex/_generated/api";

/**
 * Handles comprehensive post-meeting processing
 */
export const handleMeetingEnd = internalAction({
  args: {
    meetingId: v.id("meetings"),
    endedAt: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
    tasksScheduled: v.array(v.string()),
  }),
  handler: async (ctx, { meetingId, endedAt }) => {
    const tasksScheduled: string[] = [];

    try {
      // 1. Schedule transcript aggregation
      await ctx.scheduler.runAfter(
        5000, // 5 seconds delay to allow final transcript chunks
        internal.transcripts.aggregation.aggregateTranscriptSegments,
        { meetingId },
      );
      tasksScheduled.push("transcript_aggregation");

      // 2. Schedule insight generation for each participant
      const participants = await ctx.runQuery(
        internal.meetings.queries.getMeetingParticipants,
        { meetingId },
      );

      for (const participant of participants) {
        await ctx.scheduler.runAfter(
          30000, // 30 seconds delay to allow transcript processing
          internal.insights.generation.generateParticipantInsights,
          { meetingId, userId: participant.userId },
        );
      }
      tasksScheduled.push("participant_insights");

      // 3. Schedule meeting analytics update
      await ctx.scheduler.runAfter(
        60000, // 1 minute delay
        internal.analytics.meetings.updateMeetingAnalytics,
        { meetingId, endedAt },
      );
      tasksScheduled.push("meeting_analytics");

      // 4. Schedule cleanup tasks
      await ctx.scheduler.runAfter(
        300000, // 5 minutes delay
        internal.meetings.stream.cleanup.cleanupMeetingResources,
        { meetingId },
      );
      tasksScheduled.push("resource_cleanup");

      return {
        success: true,
        tasksScheduled,
      };
    } catch (error) {
      console.error("Post-meeting processing error:", error);
      return {
        success: false,
        tasksScheduled,
      };
    }
  },
});
