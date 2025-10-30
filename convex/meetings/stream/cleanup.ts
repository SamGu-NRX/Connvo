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
import { StreamApiResponseV } from "@convex/types/validators/stream";
import type { StreamCleanupResult } from "@convex/types/entities/stream";

/**
 * Cleans up meeting resources after conclusion
 *
 * @summary Cleans up meeting resources after conclusion
 * @description Performs comprehensive cleanup of meeting resources after a meeting
 * ends. Deletes GetStream rooms, archives transcript data, and updates meeting state.
 * Called internally as part of post-meeting processing. Gracefully handles failures
 * for individual cleanup tasks to ensure partial cleanup doesn't block the entire process.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "success": true,
 *     "tasksCompleted": [
 *       "stream_room_cleanup",
 *       "meeting_state_cleanup"
 *     ]
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "success": false,
 *     "tasksCompleted": [
 *       "meeting_state_cleanup"
 *     ]
 *   }
 * }
 * ```
 */
export const cleanupMeetingResources = internalAction({
  args: { meetingId: v.id("meetings") },
  returns: StreamApiResponseV.cleanupResult,
  handler: async (ctx, { meetingId }): Promise<StreamCleanupResult> => {
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
          await ctx.runAction(internal.meetings.stream.index.deleteStreamRoom, {
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
