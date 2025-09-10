/**
 * Meeting Queries with Authentication Guards
 *
 * This module demonstrates meeting-specific access control
 * using the assertMeetingAccess guard function.
 *
 * Requirements: 2.3, 2.4, 4.1
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { query } from "../_generated/server";
import { v } from "convex/values";
import {
  requireIdentity,
  assertMeetingAccess,
  hasMeetingAccess,
} from "../auth/guards";

/**
 * Get meeting details with participant validation
 * Requires meeting participation
 */
export const getMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.union(
    v.object({
      _id: v.id("meetings"),
      organizerId: v.id("users"),
      title: v.string(),
      description: v.optional(v.string()),
      scheduledAt: v.optional(v.number()),
      duration: v.optional(v.number()),
      streamRoomId: v.optional(v.string()),
      state: v.union(
        v.literal("scheduled"),
        v.literal("active"),
        v.literal("concluded"),
        v.literal("cancelled"),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { meetingId }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const meeting = await ctx.db.get(meetingId);
    return meeting;
  },
});

/**
 * Get meeting participants with role information
 * Requires meeting participation
 */
export const getMeetingParticipants = query({
  args: { meetingId: v.id("meetings") },
  returns: v.array(
    v.object({
      _id: v.id("meetingParticipants"),
      meetingId: v.id("meetings"),
      userId: v.id("users"),
      role: v.union(v.literal("host"), v.literal("participant")),
      presence: v.union(
        v.literal("invited"),
        v.literal("joined"),
        v.literal("left"),
      ),
      joinedAt: v.optional(v.number()),
      leftAt: v.optional(v.number()),
      user: v.object({
        displayName: v.optional(v.string()),
        email: v.string(),
        avatarUrl: v.optional(v.string()),
      }),
    }),
  ),
  handler: async (ctx, { meetingId }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    // Get all participants
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    // Enrich with user data
    const enrichedParticipants = await Promise.all(
      participants.map(async (participant) => {
        const user = await ctx.db.get(participant.userId);
        return {
          ...participant,
          user: {
            displayName: user?.displayName,
            email: user?.email || "",
            avatarUrl: user?.avatarUrl,
          },
        };
      }),
    );

    return enrichedParticipants;
  },
});

/**
 * Get meeting state information
 * Requires meeting participation
 */
export const getMeetingState = query({
  args: { meetingId: v.id("meetings") },
  returns: v.union(
    v.object({
      _id: v.id("meetingState"),
      meetingId: v.id("meetings"),
      active: v.boolean(),
      startedAt: v.optional(v.number()),
      endedAt: v.optional(v.number()),
      speakingStats: v.optional(v.any()),
      lullState: v.optional(
        v.object({
          detected: v.boolean(),
          lastActivity: v.number(),
          duration: v.number(),
        }),
      ),
      topics: v.array(v.string()),
      recordingEnabled: v.boolean(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { meetingId }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    return meetingState;
  },
});

/**
 * List user's meetings with access control
 * Returns only meetings the user participates in
 */
export const getUserMeetings = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("active"),
        v.literal("concluded"),
        v.literal("cancelled"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      meeting: v.object({
        _id: v.id("meetings"),
        organizerId: v.id("users"),
        title: v.string(),
        description: v.optional(v.string()),
        scheduledAt: v.optional(v.number()),
        duration: v.optional(v.number()),
        state: v.union(
          v.literal("scheduled"),
          v.literal("active"),
          v.literal("concluded"),
          v.literal("cancelled"),
        ),
        createdAt: v.number(),
      }),
      participation: v.object({
        role: v.union(v.literal("host"), v.literal("participant")),
        presence: v.union(
          v.literal("invited"),
          v.literal("joined"),
          v.literal("left"),
        ),
        joinedAt: v.optional(v.number()),
      }),
      participantCount: v.number(),
    }),
  ),
  handler: async (ctx, { status, limit = 50 }) => {
    const identity = await requireIdentity(ctx);

    // Get user's meeting participations
    const participations = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId as any))
      .take(limit);

    // Get meeting details and filter by status if specified
    const meetings = await Promise.all(
      participations.map(async (participation) => {
        const meeting = await ctx.db.get(participation.meetingId);
        if (!meeting || (status && meeting.state !== status)) {
          return null;
        }

        // Count total participants
        const allParticipants = await ctx.db
          .query("meetingParticipants")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
          .collect();

        return {
          meeting,
          participation: {
            role: participation.role,
            presence: participation.presence,
            joinedAt: participation.joinedAt,
          },
          participantCount: allParticipants.length,
        };
      }),
    );

    // Filter out null results and sort by creation time
    return meetings
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => b.meeting.createdAt - a.meeting.createdAt);
  },
});

/**
 * Check if user can perform specific actions on a meeting
 * Utility query for UI state management
 */
export const getMeetingPermissions = query({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    canView: v.boolean(),
    canEdit: v.boolean(),
    canStart: v.boolean(),
    canEnd: v.boolean(),
    canInvite: v.boolean(),
    role: v.union(
      v.literal("host"),
      v.literal("participant"),
      v.literal("none"),
    ),
  }),
  handler: async (ctx, { meetingId }) => {
    const identity = await requireIdentity(ctx);

    // Check if user has any access to the meeting
    const hasAccess = await hasMeetingAccess(ctx, meetingId);
    if (!hasAccess) {
      return {
        canView: false,
        canEdit: false,
        canStart: false,
        canEnd: false,
        canInvite: false,
        role: "none" as const,
      };
    }

    // Get user's role in the meeting
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId as any),
      )
      .unique();

    const isHost = participant?.role === "host";

    const role: "host" | "participant" | "none" = participant?.role === "host"
      ? "host"
      : participant?.role === "participant"
      ? "participant"
      : "none";

    return {
      canView: true,
      canEdit: isHost,
      canStart: isHost,
      canEnd: isHost,
      canInvite: isHost,
      role,
    };
  },
});
