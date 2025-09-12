/**
 * Stream Webhook Event Handlers
 *
 * This module processes Stream webhook events to maintain meeting state
 * synchronization and participant presence tracking.
 *
 * Requirements: 6.3, 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { logAudit } from "../lib/audit";

/**
 * Handles call session started event
 */
export const handleCallStarted = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    callId: v.string(),
    startedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, callId, startedAt }) => {
    // Update meeting state to reflect Stream session start
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        active: true,
        startedAt,
        updatedAt: Date.now(),
      });
    }

    // Log the event
    await logAudit(ctx, {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "stream_call_started",
      category: "meeting",
      success: true,
      metadata: {
        callId,
        startedAt,
      },
    });

    return null;
  },
});

/**
 * Handles call session ended event
 */
export const handleCallEnded = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    callId: v.string(),
    endedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, callId, endedAt }) => {
    // Update meeting state to reflect Stream session end
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        active: false,
        endedAt,
        updatedAt: Date.now(),
      });
    }

    // Update meeting status if it was active
    const meeting = await ctx.db.get(meetingId);
    if (meeting && meeting.state === "active") {
      await ctx.db.patch(meetingId, {
        state: "concluded",
        updatedAt: Date.now(),
      });
    }

    // Log the event
    await logAudit(ctx, {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "stream_call_ended",
      category: "meeting",
      success: true,
      metadata: {
        callId,
        endedAt,
        duration:
          meetingState?.startedAt != null
            ? endedAt - meetingState.startedAt
            : 0,
      },
    });

    return null;
  },
});

/**
 * Handles participant joined event
 */
export const handleParticipantJoined = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.string(), // This is the Stream user ID, need to map to our user
    joinedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, joinedAt }) => {
    // Find the participant by user ID (assuming Stream user ID matches our user ID)
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId as Id<"users">),
      )
      .unique();

    if (participant) {
      await ctx.db.patch(participant._id, {
        presence: "joined",
        joinedAt,
      });

      // Log the event
      await logAudit(ctx, {
        actorUserId: userId as Id<"users">,
        resourceType: "meeting",
        resourceId: meetingId,
        action: "participant_joined_stream",
        category: "meeting",
        success: true,
        metadata: {
          joinedAt,
          role: participant.role,
        },
      });
    }

    return null;
  },
});

/**
 * Handles participant left event
 */
export const handleParticipantLeft = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.string(),
    leftAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, leftAt }) => {
    // Find the participant by user ID
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId as Id<"users">),
      )
      .unique();

    if (participant) {
      await ctx.db.patch(participant._id, {
        presence: "left",
        leftAt,
      });

      // Log the event
      await logAudit(ctx, {
        actorUserId: userId as Id<"users">,
        resourceType: "meeting",
        resourceId: meetingId,
        action: "participant_left_stream",
        category: "meeting",
        success: true,
        metadata: {
          leftAt,
          role: participant.role,
        },
      });
    }

    return null;
  },
});

/**
 * Handles recording started event
 */
export const handleRecordingStarted = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    recordingId: v.optional(v.string()),
    startedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, recordingId, startedAt }) => {
    // Update meeting state to reflect recording status
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        recordingEnabled: true,
        updatedAt: Date.now(),
      });
    }

    // Log the event
    await logAudit(ctx, {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "recording_started",
      category: "meeting",
      success: true,
      metadata: {
        ...(recordingId ? { recordingId } : {}),
        startedAt,
      },
    });

    return null;
  },
});

/**
 * Handles recording stopped event
 */
export const handleRecordingStopped = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    recordingId: v.optional(v.string()),
    stoppedAt: v.number(),
    downloadUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, recordingId, stoppedAt, downloadUrl }) => {
    // Update meeting state to reflect recording status
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        recordingEnabled: false,
        updatedAt: Date.now(),
      });
    }

    // Compute a safe download URL without query/hash to avoid logging signed tokens
    const safeDownloadUrl = (() => {
      if (!downloadUrl) return undefined;
      try {
        const u = new URL(downloadUrl);
        u.search = "";
        u.hash = "";
        return `${u.origin}${u.pathname}`;
      } catch {
        return undefined;
      }
    })();

    // Log the event with sanitized download URL (no tokens) and without empty-string sentinels
    await logAudit(ctx, {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "recording_stopped",
      category: "meeting",
      success: true,
      metadata: {
        ...(recordingId ? { recordingId } : {}),
        stoppedAt,
        ...(safeDownloadUrl ? { downloadUrl: safeDownloadUrl } : {}),
      },
    });

    return null;
  },
});
