/**
 * Pure WebRTC Signaling Implementation
 *
 * This module provides WebRTC signaling through Convex real-time infrastructure,
 * enabling peer-to-peer video/audio connections without external dependencies.
 * This is the free tier implementation.
 *
 * Requirements: 6.2, 6.3, 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex function patterns
 */

import { mutation, query, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "../../auth/guards";
import { createError } from "../../lib/errors";
import { metadataRecordV } from "../../lib/validators";
import {
  WebRTCSessionV,
  WebRTCApiResponseV,
  webrtcSessionStateV,
  sdpDataV,
  iceDataV,
  connectionQualityV,
  connectionStatsV,
} from "../../types/validators/webrtc";
import type {
  WebRTCSession,
  WebRTCSignal,
  WebRTCSessionState,
  ConnectionQuality,
  ConnectionMetrics,
  SDPData,
  ICEData,
} from "../../types/entities/webrtc";

/**
 * Creates a WebRTC session for a meeting
 */
export const createWebRTCSession = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
  },
  returns: WebRTCApiResponseV.createSession,
  handler: async (
    ctx,
    { meetingId, sessionId },
  ): Promise<{
    sessionId: string;
    success: boolean;
  }> => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation(
        "Cannot create WebRTC session for inactive meeting",
      );
    }

    // Check if session already exists
    const existingSession: WebRTCSession | null = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_and_session", (q) =>
        q.eq("meetingId", meetingId).eq("sessionId", sessionId),
      )
      .unique();

    if (existingSession) {
      return {
        sessionId: existingSession.sessionId,
        success: true,
      };
    }

    // Create new WebRTC session using centralized types
    const newSession: Omit<WebRTCSession, "_id"> = {
      meetingId,
      sessionId,
      userId: participant.userId,
      state: "connecting" as WebRTCSessionState,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await ctx.db.insert("webrtcSessions", newSession);

    return {
      sessionId,
      success: true,
    };
  },
});

/**
 * Exchanges SDP offer/answer for WebRTC negotiation
 */
export const exchangeSessionDescription = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    description: sdpDataV,
    targetUserId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, description, targetUserId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    // Store the SDP offer/answer
    const sdpAnswerSignal: Omit<WebRTCSignal, "_id"> = {
      meetingId,
      sessionId,
      fromUserId: participant.userId,
      toUserId: targetUserId,
      type: "sdp",
      data: {
        type: description.type,
        sdp: description.sdp,
      },
      timestamp: Date.now(),
      processed: false,
    };

    await ctx.db.insert("webrtcSignals", sdpAnswerSignal);
    return null;
  },
});

/**
 * Exchanges ICE candidates for WebRTC connection establishment
 */
export const exchangeICECandidate = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    candidate: iceDataV,
    targetUserId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, candidate, targetUserId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Store the ICE candidate
    const iceCandidateSignal: Omit<WebRTCSignal, "_id"> = {
      meetingId,
      sessionId,
      fromUserId: participant.userId,
      toUserId: targetUserId,
      type: "ice",
      data: {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
        usernameFragment: candidate.usernameFragment,
      } as ICEData,
      timestamp: Date.now(),
      processed: false,
    };

    await ctx.db.insert("webrtcSignals", iceCandidateSignal);
    return null;
  },
});

/**
 * Gets pending WebRTC signals for a user in a meeting
 */
export const getPendingSignals = query({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.optional(v.string()),
    lastSignalId: v.optional(v.id("webrtcSignals")),
  },
  returns: WebRTCApiResponseV.pendingSignals,
  handler: async (ctx, { meetingId, sessionId, lastSignalId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    let baseQuery = ctx.db
      .query("webrtcSignals")
      .withIndex("by_meeting_target_and_processed", (q) =>
        q
          .eq("meetingId", meetingId)
          .eq("toUserId", participant.userId)
          .eq("processed", false),
      );

    // Apply optional filters in-memory to avoid additional indexes explosion
    let signals: WebRTCSignal[] = await baseQuery.order("asc").take(200);
    if (sessionId) {
      signals = signals.filter((s) => s.sessionId === sessionId);
    }

    if (lastSignalId) {
      signals = signals.filter((s) => s._id > lastSignalId);
    }
    signals = signals.slice(0, 50); // hard cap to prevent overwhelming clients

    return signals.map((signal) => ({
      _id: signal._id,
      sessionId: signal.sessionId,
      fromUserId: signal.fromUserId,
      type: signal.type,
      data: signal.data,
      timestamp: signal.timestamp,
    }));
  },
});

/**
 * Marks WebRTC signals as processed
 */
export const markSignalsProcessed = mutation({
  args: {
    signalIds: v.array(v.id("webrtcSignals")),
  },
  returns: v.null(),
  handler: async (ctx, { signalIds }) => {
    const identity = await requireIdentity(ctx);

    for (const signalId of signalIds) {
      const signal: WebRTCSignal | null = await ctx.db.get(signalId);
      if (signal && signal.toUserId === identity.userId) {
        await ctx.db.patch(signalId, {
          processed: true,
        });
      }
    }

    return null;
  },
});

/**
 * Updates WebRTC session state
 */
export const updateSessionState = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    state: webrtcSessionStateV,
    metadata: v.optional(metadataRecordV),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, state, metadata }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Use composite index by_user_and_meeting and check sessionId in memory
    const candidateSessions: WebRTCSession[] = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_user_and_meeting", (q) =>
        q.eq("userId", participant.userId).eq("meetingId", meetingId),
      )
      .collect();
    const session =
      candidateSessions.find((s) => s.sessionId === sessionId) || null;

    if (!session) {
      throw createError.notFound("WebRTC session not found");
    }

    await ctx.db.patch(session._id, {
      state: state as WebRTCSessionState,
      metadata,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Gets active WebRTC sessions for a meeting
 */
export const getActiveSessions = query({
  args: { meetingId: v.id("meetings") },
  returns: v.array(WebRTCSessionV.withUser),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Use composite index by_meeting_and_state and union acceptable states
    const states: Array<WebRTCSessionState> = [
      "connecting",
      "connected",
      "disconnected",
    ];
    const results = await Promise.all(
      states.map((state) =>
        ctx.db
          .query("webrtcSessions")
          .withIndex("by_meeting_and_state", (q) =>
            q.eq("meetingId", meetingId).eq("state", state),
          )
          .collect(),
      ),
    );
    const sessions: WebRTCSession[] = results.flat();

    // Enrich with user details
    const enrichedSessions = [];
    for (const session of sessions) {
      const user = await ctx.db.get(session.userId);
      if (user) {
        enrichedSessions.push({
          ...session,
          user: {
            _id: user._id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
          connectionQuality: undefined, // TODO: make sure this is correct: Will be populated by metrics if available
          lastMetricsAt: undefined,
        });
      }
    }

    return enrichedSessions;
  },
});

/**
 * Closes a WebRTC session
 */
export const closeSession = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    const candidateSessions: WebRTCSession[] = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_user_and_meeting", (q) =>
        q.eq("userId", participant.userId).eq("meetingId", meetingId),
      )
      .collect();
    const session =
      candidateSessions.find((s) => s.sessionId === sessionId) || null;

    if (session) {
      await ctx.db.patch(session._id, {
        state: "closed" as WebRTCSessionState,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Stores connection quality metrics
 */
export const storeConnectionMetrics = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    quality: connectionQualityV,
    stats: connectionStatsV,
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const metrics: Omit<ConnectionMetrics, "_id"> = {
      meetingId: args.meetingId,
      sessionId: args.sessionId,
      userId: args.userId,
      quality: args.quality as ConnectionQuality,
      stats: args.stats,
      timestamp: args.timestamp,
      createdAt: Date.now(),
    };

    await ctx.db.insert("connectionMetrics", metrics);
    return null;
  },
});

/**
 * Internal mutation to update session state
 */
export const updateSessionStateInternal = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    state: webrtcSessionStateV,
    metadata: v.optional(metadataRecordV),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, state, metadata }) => {
    const session: WebRTCSession | null = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_and_session", (q) =>
        q.eq("meetingId", meetingId).eq("sessionId", sessionId),
      )
      .unique();

    if (session) {
      await ctx.db.patch(session._id, {
        state: state as WebRTCSessionState,
        metadata,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Cleanup old WebRTC signals and sessions
 */
export const cleanupOldWebRTCData = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
  },
  returns: WebRTCApiResponseV.cleanup,
  handler: async (ctx, { olderThanMs = 24 * 60 * 60 * 1000 }) => {
    // Default 24 hours
    const cutoff = Date.now() - olderThanMs;

    // Clean up old processed signals
    const oldSignals: WebRTCSignal[] = await ctx.db
      .query("webrtcSignals")
      .withIndex("by_processed_and_timestamp", (q) =>
        q.eq("processed", true).lt("timestamp", cutoff),
      )
      .collect();

    for (const signal of oldSignals) {
      await ctx.db.delete(signal._id);
    }

    // Clean up old closed/failed sessions
    const [closedSessions, failedSessions] = await Promise.all([
      ctx.db
        .query("webrtcSessions")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", "closed").lt("updatedAt", cutoff),
        )
        .collect(),
      ctx.db
        .query("webrtcSessions")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", "failed").lt("updatedAt", cutoff),
        )
        .collect(),
    ]);
    const oldSessions: WebRTCSession[] = [...closedSessions, ...failedSessions];

    for (const session of oldSessions) {
      await ctx.db.delete(session._id);
    }

    return {
      signalsDeleted: oldSignals.length,
      sessionsDeleted: oldSessions.length,
    };
  },
});
