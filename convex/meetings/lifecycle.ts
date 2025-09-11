/**
 * Enhanced Meeting Lifecycle Management
 *
 * This module implements comprehensive meeting lifecycle functions with
 * Stream integration, participant management, and real-time state tracking.
 *
 * Requirements: 6.1, 6.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex function patterns
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  requireIdentity,
  assertMeetingAccess,
  assertOwnershipOrAdmin,
} from "../auth/guards";
import { createError } from "../lib/errors";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

/**
 * Creates a new meeting with comprehensive setup
 */
export const createMeeting = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    participantEmails: v.optional(v.array(v.string())),
  },
  returns: v.object({
    meetingId: v.id("meetings"),
    streamRoomId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);

    // Validate input
    if (args.title.trim().length === 0) {
      throw createError.validation("Meeting title cannot be empty");
    }

    if (args.scheduledAt && args.scheduledAt < Date.now()) {
      throw createError.validation("Cannot schedule meeting in the past");
    }

    // Get or create user record
    let user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) =>
        q.eq("workosUserId", identity.workosUserId),
      )
      .unique();

    if (!user) {
      // Create user if doesn't exist
      const userId = await ctx.db.insert("users", {
        workosUserId: identity.workosUserId,
        email: identity.email || "",
        orgId: identity.orgId,
        orgRole: identity.orgRole,
        displayName: identity.name,
        isActive: true,
        lastSeenAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      user = await ctx.db.get(userId);
      if (!user) throw createError.notFound("User");
    }

    const now = Date.now();

    // Create meeting
    const meetingId = await ctx.db.insert("meetings", {
      organizerId: user._id,
      title: args.title.trim(),
      description: args.description?.trim(),
      scheduledAt: args.scheduledAt,
      duration: args.duration || 1800000, // Default 30 minutes in ms
      state: "scheduled",
      participantCount: 1, // Organizer
      createdAt: now,
      updatedAt: now,
    });

    // Add organizer as host participant
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: user._id,
      role: "host",
      presence: "invited",
      createdAt: now,
    });

    // Create initial meeting state
    await ctx.db.insert("meetingState", {
      meetingId,
      active: false,
      topics: [],
      recordingEnabled: false,
      updatedAt: now,
    });

    // Create initial empty notes
    await ctx.db.insert("meetingNotes", {
      meetingId,
      content: "",
      version: 0,
      lastRebasedAt: now,
      updatedAt: now,
    });

    // Schedule Stream room creation if meeting is immediate or soon
    let streamRoomId: string | undefined;
    if (!args.scheduledAt || args.scheduledAt <= Date.now() + 300000) {
      // Within 5 minutes
      try {
        const roomResult = await ctx.scheduler.runAfter(
          0,
          internal.meetings.stream.createStreamRoom,
          { meetingId },
        );
        // Note: We can't get the return value from scheduled actions
        // The room ID will be updated via the action
      } catch (error) {
        console.warn("Failed to schedule Stream room creation:", error);
      }
    }

    return {
      meetingId,
      streamRoomId,
    };
  },
});

/**
 * Adds a participant to a meeting with proper validation
 */
export const addParticipant = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: v.union(v.literal("host"), v.literal("participant")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, role }) => {
    // Verify user has permission to add participants (host only)
    await assertMeetingAccess(ctx, meetingId, "host");

    // Check if user is already a participant
    const existingParticipant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId),
      )
      .unique();

    if (existingParticipant) {
      throw createError.validation(
        "User is already a participant in this meeting",
      );
    }

    // Verify target user exists
    const targetUser = await ctx.db.get(userId);
    if (!targetUser) {
      throw createError.notFound("User", userId);
    }

    // Add participant
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId,
      role,
      presence: "invited",
      createdAt: Date.now(),
    });

    // Update participant count
    const meeting = await ctx.db.get(meetingId);
    if (meeting) {
      await ctx.db.patch(meetingId, {
        participantCount: (meeting.participantCount || 0) + 1,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Removes a participant from a meeting
 */
export const removeParticipant = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId }) => {
    // Verify user has permission to remove participants (host only)
    const currentParticipant = await assertMeetingAccess(
      ctx,
      meetingId,
      "host",
    );
    const identity = await requireIdentity(ctx);

    // Cannot remove self if you're the only host
    if (identity.userId === userId) {
      const hosts = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .filter((q) => q.eq(q.field("role"), "host"))
        .collect();

      if (hosts.length === 1) {
        throw createError.validation(
          "Cannot remove the only host from the meeting",
        );
      }
    }

    // Find and remove participant
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId),
      )
      .unique();

    if (!participant) {
      throw createError.notFound("Participant not found in meeting");
    }

    await ctx.db.delete(participant._id);

    // Update participant count
    const meeting = await ctx.db.get(meetingId);
    if (meeting) {
      await ctx.db.patch(meetingId, {
        participantCount: Math.max(0, (meeting.participantCount || 1) - 1),
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Updates participant role with validation
 */
export const updateParticipantRole = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    newRole: v.union(v.literal("host"), v.literal("participant")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, newRole }) => {
    // Verify user has permission to change roles (host only)
    await assertMeetingAccess(ctx, meetingId, "host");
    const identity = await requireIdentity(ctx);

    // Find participant
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId),
      )
      .unique();

    if (!participant) {
      throw createError.notFound("Participant not found in meeting");
    }

    const oldRole = participant.role;

    // Cannot demote self if you're the only host
    if (
      identity.userId === userId &&
      oldRole === "host" &&
      newRole === "participant"
    ) {
      const hosts = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .filter((q) => q.eq(q.field("role"), "host"))
        .collect();

      if (hosts.length === 1) {
        throw createError.validation("Cannot demote the only host");
      }
    }

    // Update role
    await ctx.db.patch(participant._id, {
      role: newRole,
    });

    return null;
  },
});

/**
 * Starts a meeting and activates real-time features
 */
export const startMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    streamRoomId: v.optional(v.string()),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to start meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state === "active") {
      throw createError.validation("Meeting is already active");
    }

    if (meeting.state === "concluded" || meeting.state === "cancelled") {
      throw createError.validation(
        "Cannot start a concluded or cancelled meeting",
      );
    }

    const now = Date.now();

    // Update meeting state
    await ctx.db.patch(meetingId, {
      state: "active",
      updatedAt: now,
    });

    // Update meeting state record
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        active: true,
        startedAt: now,
        updatedAt: now,
      });
    }

    // Ensure Stream room exists
    let streamRoomId = meeting.streamRoomId;
    if (!streamRoomId) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.meetings.stream.createStreamRoom,
          { meetingId },
        );
      } catch (error) {
        console.warn("Failed to create Stream room:", error);
      }
    }

    return {
      success: true,
      streamRoomId,
    };
  },
});

/**
 * Ends a meeting and triggers cleanup
 */
export const endMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    duration: v.optional(v.number()),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to end meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation("Can only end active meetings");
    }

    const now = Date.now();

    // Update meeting state
    await ctx.db.patch(meetingId, {
      state: "concluded",
      updatedAt: now,
    });

    // Update meeting state record and calculate duration
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    let duration: number | undefined;
    if (meetingState) {
      duration = meetingState.startedAt
        ? now - meetingState.startedAt
        : undefined;
      await ctx.db.patch(meetingState._id, {
        active: false,
        endedAt: now,
        updatedAt: now,
      });
    }

    // Schedule post-meeting processing
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.meetings.postProcessing.handleMeetingEnd,
        { meetingId, endedAt: now },
      );
    } catch (error) {
      console.warn("Failed to schedule post-meeting processing:", error);
    }

    return {
      success: true,
      duration,
    };
  },
});

/**
 * Handles participant joining (presence update)
 */
export const joinMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    streamToken: v.optional(v.string()),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation("Cannot join inactive meeting");
    }

    const now = Date.now();

    // Update participant presence
    await ctx.db.patch(participant._id, {
      presence: "joined",
      joinedAt: now,
    });

    // Generate Stream token for this participant
    let streamToken: string | undefined;
    try {
      const tokenResult = await ctx.scheduler.runAfter(
        0,
        internal.meetings.stream.generateParticipantToken,
        { meetingId, userId: participant.userId },
      );
      // Note: We can't get the return value from scheduled actions
      // The token would need to be retrieved separately
    } catch (error) {
      console.warn("Failed to generate Stream token:", error);
    }

    return {
      success: true,
      streamToken,
    };
  },
});

/**
 * Handles participant leaving (presence update)
 */
export const leaveMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    const now = Date.now();

    // Update participant presence
    await ctx.db.patch(participant._id, {
      presence: "left",
      leftAt: now,
    });

    return {
      success: true,
    };
  },
});

/**
 * Cancels a scheduled meeting
 */
export const cancelMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to cancel meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state === "active") {
      throw createError.validation(
        "Cannot cancel active meeting - end it instead",
      );
    }

    if (meeting.state === "concluded" || meeting.state === "cancelled") {
      throw createError.validation("Meeting is already concluded or cancelled");
    }

    // Update meeting state
    await ctx.db.patch(meetingId, {
      state: "cancelled",
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Internal mutation to update meeting with Stream room ID
 */
export const updateStreamRoomId = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    streamRoomId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, streamRoomId }) => {
    await ctx.db.patch(meetingId, {
      streamRoomId,
      updatedAt: Date.now(),
    });
    return null;
  },
});
