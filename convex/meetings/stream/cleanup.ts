/**
 * Meeting Cleanup Actions
 *
 * This module handles cleanup tasks after meetings end.
 *
 * Requirements: 6.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

import { internalAction } from "@convex/_generated/server";
import { v } from "convex/values";
import { internal } from "@convex/_generated/api";
import {
  StreamApiResponseV,
} from "@convex/types/validators/stream";
import type { StreamCleanupResult } from "@convex/types/entities/stream";

/**
 * Cleans up meeting resources after conclusion
 */
export const cleanupMeetingResources = internalAction({
  args: { meetingId: v.id("meetings") },
  returns: StreamApiResponseV.cleanupResult,
  handler: async (
    ctx,
    { meetingId },
  ): Promise<StreamCleanupResult> => {
    const tasksCompleted: string[] = [];

    try {
      // Get meeting details
      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting) {
        return { success: false, tasksCompleted };
      }

      // Clean up Stream room if it exists
      if (meeting.streamRoomId) {
        try {
          await ctx.runAction(internal.meetings.stream.deleteStreamRoom, {
            meetingId,
            roomId: meeting.streamRoomId,
          });
          tasksCompleted.push("stream_room_cleanup");
        } catch (error) {
          console.warn("Failed to cleanup Stream room:", error);
        }
      }

      // Archive old transcript chunks (keep segments)
      // TODO: Implement transcript cleanup in task 6.3

      // Update meeting state for archival
      await ctx.runMutation(internal.meetings.lifecycle.updateStreamRoomId, {
        meetingId,
        streamRoomId: "", // Clear the room ID
      });
      tasksCompleted.push("meeting_state_cleanup");

      return {
        success: true,
        tasksCompleted,
      };
    } catch (error) {
      console.error("Cleanup error:", error);
      return {
        success: false,
        tasksCompleted,
      };
    }
  },
});
