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
    await ctx.db.insert("auditLogs", {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "stream_call_started",
      metadata: {
        callId,
        startedAt,
      },
      timestamp: Date.now(),
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
    await ctx.db.insert("auditLogs", {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "stream_call_ended",
      metadata: {
        callId,
        endedAt,
        duration: meetingState?.startedAt
          ? endedAt - meetingState.startedAt
          : undefined,
      },
      timestamp: Date.now(),
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
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .filter((q) => q.eq(q.field("userId"), userId as Id<"users">))
      .unique();

    if (participant) {
      await ctx.db.patch(participant._id, {
        presence: "joined",
        joinedAt,
      });

      // Log the event
      await ctx.db.insert("auditLogs", {
        actorUserId: userId as Id<"users">,
        resourceType: "meeting",
        resourceId: meetingId,
        action: "participant_joined_stream",
        metadata: {
          joinedAt,
          role: participant.role,
        },
        timestamp: Date.now(),
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
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .filter((q) => q.eq(q.field("userId"), userId as Id<"users">))
      .unique();

    if (participant) {
      await ctx.db.patch(participant._id, {
        presence: "left",
        leftAt,
      });

      // Log the event
      await ctx.db.insert("auditLogs", {
        actorUserId: userId as Id<"users">,
        resourceType: "meeting",
        resourceId: meetingId,
        action: "participant_left_stream",
        metadata: {
          leftAt,
          role: participant.role,
        },
        timestamp: Date.now(),
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
    await ctx.db.insert("auditLogs", {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "recording_started",
      metadata: {
        recordingId,
        startedAt,
      },
      timestamp: Date.now(),
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

    // Log the event with download URL for future access
    await ctx.db.insert("auditLogs", {
      resourceType: "meeting",
      resourceId: meetingId,
      action: "recording_stopped",
      metadata: {
        recordingId,
        stoppedAt,
        downloadUrl,
      },
      timestamp: Date.now(),
    });

    return null;
  },
});
