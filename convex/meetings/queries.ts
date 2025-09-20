/**
 * Meeting Query Functions
 *
 * This module provides query functions for meeting data access with
 * proper authorization and performance optimization for WebRTC signaling.
 *
 * Requirements: 5.1, 5.2, 5.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import {
  MeetingV,
  MeetingParticipantV,
  MeetingRuntimeStateV,
} from "@convex/types/validators/meeting";
import type {
  Meeting,
  MeetingParticipant,
  MeetingWithUserRole,
  MeetingParticipantWithUser,
  MeetingListItem,
  MeetingRuntimeStateWithMetrics,
} from "@convex/types/entities/meeting";
import type { UserSummary } from "@convex/types/entities/user";

/**
 * Gets meeting by ID (internal use)
 */
export const getMeetingById = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.union(MeetingV.full, v.null()),
  handler: async (ctx, { meetingId }): Promise<Meeting | null> => {
    return await ctx.db.get(meetingId);
  },
});

/**
 * Gets meeting participant by meeting and user (internal use)
 */
export const getMeetingParticipant = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    workosUserId: v.string(),
  },
  returns: v.union(MeetingParticipantV.full, v.null()),
  handler: async (
    ctx,
    { meetingId, workosUserId },
  ): Promise<MeetingParticipant | null> => {
    // First find the user by WorkOS ID
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();

    if (!user) {
      return null;
    }

    // Then find the participant
    return await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", user._id),
      )
      .unique();
  },
});

/**
 * Lists meeting participants by meeting id (internal use)
 */
export const getMeetingParticipants = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.array(MeetingParticipantV.full),
  handler: async (ctx, { meetingId }): Promise<MeetingParticipant[]> => {
    return await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
  },
});

/**
 * Gets meeting details for authenticated user with WebRTC info
 */
export const getMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.union(MeetingV.withUserRole, v.null()),
  handler: async (ctx, { meetingId }): Promise<MeetingWithUserRole | null> => {
    // Verify user has access to this meeting
    const participant = await assertMeetingAccess(ctx, meetingId);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      return null;
    }

    // Count active WebRTC sessions
    const states: Array<"connecting" | "connected" | "disconnected"> = [
      "connecting",
      "connected",
      "disconnected",
    ];
    const activeResults = await Promise.all(
      states.map((state) =>
        ctx.db
          .query("webrtcSessions")
          .withIndex("by_meeting_and_state", (q) =>
            q.eq("meetingId", meetingId).eq("state", state),
          )
          .collect(),
      ),
    );
    const activeSessions = activeResults.flat();

    return {
      ...meeting,
      userRole: participant.role,
      userPresence: participant.presence,
      activeWebRTCSessions: activeSessions.length,
    };
  },
});

/**
 * Lists meetings for authenticated user
 */
export const listUserMeetings = query({
  args: {
    state: v.optional(
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
      participantCount: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
      userRole: v.union(
        v.literal("host"),
        v.literal("participant"),
        v.literal("observer"),
      ),
      userPresence: v.union(
        v.literal("invited"),
        v.literal("joined"),
        v.literal("left"),
      ),
    }),
  ),
  handler: async (ctx, { state, limit = 50 }) => {
    const identity = await requireIdentity(ctx);

    // Find user record
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) =>
        q.eq("workosUserId", identity.workosUserId),
      )
      .unique();

    if (!user) {
      return [];
    }

    // Get user's meeting participations
    const participations = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Get meetings with optional state filter
    const meetings = [];
    for (const participation of participations) {
      const meeting = await ctx.db.get(participation.meetingId);
      if (meeting && (!state || meeting.state === state)) {
        meetings.push({
          ...meeting,
          userRole: participation.role,
          userPresence: participation.presence,
        });
      }
    }

    // Sort by creation time (newest first) and limit
    return meetings.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
});

/**
 * Gets meeting participants with WebRTC session info
 */
export const listMeetingParticipants = query({
  args: { meetingId: v.id("meetings") },
  returns: v.array(MeetingParticipantV.withUser),
  handler: async (
    ctx,
    { meetingId },
  ): Promise<MeetingParticipantWithUser[]> => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    // Get participants
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    // Enrich with user details and WebRTC status
    const enrichedParticipants: MeetingParticipantWithUser[] = [];
    for (const participant of participants) {
      const user = await ctx.db.get(participant.userId);
      if (user) {
        // Check WebRTC sessions for this participant
        // Query by composite index to avoid in-memory filtering
        const webrtcSessions = await ctx.db
          .query("webrtcSessions")
          .withIndex("by_user_and_meeting", (q) =>
            q.eq("userId", participant.userId).eq("meetingId", meetingId),
          )
          .collect();

        const connectedSessions = webrtcSessions.filter(
          (s) => s.state === "connected",
        );

        enrichedParticipants.push({
          ...participant,
          user: {
            _id: user._id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
          webrtcConnected: connectedSessions.length > 0,
          webrtcSessionCount: webrtcSessions.length,
        });
      }
    }

    return enrichedParticipants;
  },
});

/**
 * Gets meeting state with WebRTC connection info
 */
export const getMeetingState = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.union(MeetingRuntimeStateV.withMetrics, v.null()),
  handler: async (
    ctx,
    { meetingId },
  ): Promise<MeetingRuntimeStateWithMetrics | null> => {
    // Verify access when the caller is associated with a user; allow system calls.
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      await assertMeetingAccess(ctx, meetingId);
    }

    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingState) {
      return null;
    }

    // Get WebRTC session metrics
    const allSessions = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    const connectedSessions = allSessions.filter(
      (s) => s.state === "connected",
    );

    // Get participant count
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    // Calculate average speaking time
    const averageSpeakingTime = meetingState.speakingStats
      ? meetingState.speakingStats.totalMs / Math.max(participants.length, 1)
      : 0;

    return {
      ...meetingState,
      totalWebRTCSessions: allSessions.length,
      connectedWebRTCSessions: connectedSessions.length,
      participantCount: participants.length,
      averageSpeakingTime,
    };
  },
});

/**
 * Gets active meetings with WebRTC metrics (for monitoring/admin)
 */
export const getActiveMeetings = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("meetings"),
      organizerId: v.id("users"),
      title: v.string(),
      participantCount: v.optional(v.number()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      webrtcSessionCount: v.number(),
    }),
  ),
  handler: async (ctx, { limit = 100 }) => {
    // System-invoked query; enforce limit bounds but skip identity requirement.
    const normalizedLimit = Math.min(Math.max(limit, 1), 200);

    const activeMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_state", (q) => q.eq("state", "active"))
      .take(normalizedLimit);

    // Enrich with meeting state and WebRTC data
    const enrichedMeetings = [];
    for (const meeting of activeMeetings) {
      const meetingState = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();

      const webrtcSessions = await ctx.db
        .query("webrtcSessions")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();

      enrichedMeetings.push({
        _id: meeting._id,
        organizerId: meeting.organizerId,
        title: meeting.title,
        participantCount: meeting.participantCount,
        createdAt: meeting.createdAt,
        startedAt: meetingState?.startedAt,
        webrtcSessionCount: webrtcSessions.length,
      });
    }

    return enrichedMeetings;
  },
});
