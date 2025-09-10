/**
 * Meeting Mutations with Dynamic Permission Management
 *
 * This module demonstrates integration of meeting lifecycle events
 * with the dynamic permission management system.
 *
 * Requirements: 2.5, 6.1, 6.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess, assertOwnershipOrAdmin } from "../auth/guards";
import { createError } from "../lib/errors";
import { internal } from "../_generated/api";

/**
 * Creates a new meeting with initial participant setup
 */
export const createMeeting = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    participantEmails: v.optional(v.array(v.string())),
  },
  returns: v.id("meetings"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);

    // Validate input
    if (args.title.trim().length === 0) {
      throw createError.validation("Meeting title cannot be empty");
    }

    if (args.scheduledAt && args.scheduledAt < Date.now()) {
      throw createError.validation("Cannot schedule meeting in the past");
    }

    const now = Date.now();

    // Create meeting
    const meetingId = await ctx.db.insert("meetings", {
      organizerId: identity.userId as any,
      title: args.title.trim(),
      description: args.description?.trim(),
      scheduledAt: args.scheduledAt,
      duration: args.duration || 1800, // Default 30 minutes
      state: "scheduled",
      createdAt: now,
      updatedAt: now,
    });

    // Add organizer as host participant
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: identity.userId as any,
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

    // Log meeting creation
    await ctx.runMutation(internal.audit.logging.logDataAccessEvent, {
      userId: identity.userId as any,
      resourceType: "meeting",
      resourceId: meetingId,
      operationType: "write",
      metadata: {
        action: "meeting_created",
        title: args.title,
        scheduledAt: args.scheduledAt,
      },
    });

    return meetingId;
  },
});

/**
 * Adds a participant to a meeting with permission setup
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
    const identity = await requireIdentity(ctx);

    // Check if user is already a participant
    const existingParticipant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId)
      )
      .unique();

    if (existingParticipant) {
      throw createError.validation("User is already a participant in this meeting");
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

    // Log participant addition
    await ctx.runMutation(internal.audit.logging.logAuthorizationEvent, {
      userId: identity.userId as any,
      action: "participant_added",
      resourceType: "meeting",
      resourceId: meetingId,
      success: true,
      metadata: {
        addedUserId: userId,
        addedUserRole: role,
        addedUserEmail: targetUser.email,
      },
    });
  },
});

/**
 * Removes a participant and revokes their permissions
 */
export const removeParticipant = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId }) => {
    // Verify user has permission to remove participants (host only)
    await assertMeetingAccess(ctx, meetingId, "host");
    const identity = await requireIdentity(ctx);

    // Cannot remove self if you're the only host
    if (identity.userId === userId) {
      const hosts = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .filter((q) => q.eq(q.field("role"), "host"))
        .collect();

      if (hosts.length === 1) {
        throw createError.validation("Cannot remove the only host from the meeting");
      }
    }

    // Find and remove participant
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId)
      )
      .unique();

    if (!participant) {
      throw createError.notFound("Participant not found in meeting");
    }

    await ctx.db.delete(participant._id);

    // Revoke all permissions for this user on this meeting
    await ctx.runMutation(internal.auth.permissions.handleParticipantRemoval, {
      meetingId,
      userId,
      removedBy: identity.userId as any,
    });

    // Log participant removal
    await ctx.runMutation(internal.audit.logging.logAuthorizationEvent, {
      userId: identity.userId as any,
      action: "participant_removed",
      resourceType: "meeting",
      resourceId: meetingId,
      success: true,
      metadata: {
        removedUserId: userId,
        removedUserRole: participant.role,
      },
    });
  },
});

/**
 * Updates participant role with permission changes
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
        q.eq("meetingId", meetingId).eq("userId", userId)
      )
      .unique();

    if (!participant) {
      throw createError.notFound("Participant not found in meeting");
    }

    const oldRole = participant.role;

    // Cannot demote self if you're the only host
    if (identity.userId === userId && oldRole === "host" && newRole === "participant") {
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

    // Update permissions based on role change
    await ctx.runMutation(internal.auth.permissions.updateParticipantPermissions, {
      meetingId,
      userId,
      oldRole,
      newRole,
    });

    // Log role change
    await ctx.runMutation(internal.audit.logging.logAuthorizationEvent, {
      userId: identity.userId as any,
      action: "participant_role_changed",
      resourceType: "meeting",
      resourceId: meetingId,
      success: true,
      metadata: {
        targetUserId: userId,
        oldRole,
        newRole,
      },
    });
  },
});

/**
 * Starts a meeting and activates real-time features
 */
export const startMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to start meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");
    const identity = await requireIdentity(ctx);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state === "active") {
      throw createError.validation("Meeting is already active");
    }

    if (meeting.state === "concluded" || meeting.state === "cancelled") {
      throw createError.validation("Cannot start a concluded or cancelled meeting");
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

    // Log meeting start
    await ctx.runMutation(internal.audit.logging.logDataAccessEvent, {
      userId: identity.userId as any,
      resourceType: "meeting",
      resourceId: meetingId,
      operationType: "admin",
      metadata: {
        action: "meeting_started",
        startedAt: now,
      },
    });

    // TODO: In a complete implementation, this would also:
    // - Create Stream room via action
    // - Initialize transcription services
    // - Set up real-time monitoring
  },
});

/**
 * Ends a meeting and triggers cleanup
 */
export const endMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to end meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");
    const identity = await requireIdentity(ctx);

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

    // Update meeting state record
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        active: false,
        endedAt: now,
        updatedAt: now,
      });
    }

    // Revoke transcript access permissions (meeting no longer active)
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    for (const participant of participants) {
      await ctx.runMutation(internal.auth.permissions.revokeSubscriptionPermissions, {
        userId: participant.userId,
        resourceType: "transcripts",
        resourceId: meetingId,
        reason: "Meeting ended",
      });
    }

    // Log meeting end
    await ctx.runMutation(internal.audit.logging.logDataAccessEvent, {
      userId: identity.userId as any,
      resourceType: "meeting",
      resourceId: meetingId,
      operationType: "admin",
      metadata: {
        action: "meeting_ended",
        endedAt: now,
        duration: meetingState?.startedAt ? now - meetingState.startedAt : undefined,
      },
    });

    // TODO: In a complete implementation, this would also:
    // - Schedule transcript aggregation
    // - Trigger post-call insight generation
    // - Clean up Stream room
    // - Archive real-time data
  },
});

/**
 * Handles participant joining (presence update)
 */
export const joinMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

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

    // Log participant join
    await ctx.runMutation(internal.audit.logging.logDataAccessEvent, {
      userId: identity.userId as any,
      resourceType: "meeting",
      resourceId: meetingId,
      operationType: "read",
      metadata: {
        action: "participant_joined",
        joinedAt: now,
        role: participant.role,
      },
    });
  },
});

/**
 * Handles participant leaving (presence update)
 */
export const leaveMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    const now = Date.now();

    // Update participant presence
    await ctx.db.patch(participant._id, {
      presence: "left",
      leftAt: now,
    });

    // Revoke active subscriptions for this user
    await ctx.runMutation(internal.auth.permissions.revokeSubscriptionPermissions, {
      userId: identity.userId as any,
      resourceType: "meeting",
      resourceId: meetingId,
      reason: "Participant left meeting",
    });

    // Log participant leave
    await ctx.runMutation(internal.audit.logging.logDataAccessEvent, {
      userId: identity.userId as any,
      resourceType: "meeting",
      resourceId: meetingId,
      operationType: "read",
      metadata: {
        action: "participant_left",
        leftAt: now,
        role: participant.role,
      },
    });
  },
});
