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

import { mutation, query, internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { metadataRecordV } from "@convex/lib/validators";
import {
  WebRTCSessionV,
  WebRTCApiResponseV,
  webrtcSessionStateV,
  sdpDataV,
  iceDataV,
  connectionQualityV,
  connectionStatsV,
} from "@convex/types/validators/webrtc";
import type {
  WebRTCSession,
  WebRTCSignal,
  WebRTCSessionState,
  ConnectionQuality,
  ConnectionMetrics,
  SDPData,
  ICEData,
} from "@convex/types/entities/webrtc";

/** Per-source read bound before the merged result is capped for the client. */
const SIGNAL_SOURCE_BATCH = 200;
/** Hard cap on signals returned per call. */
const SIGNAL_HARD_CAP = 50;

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
    const newSession: Omit<WebRTCSession, "_id" | "_creationTime"> = {
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
    const sdpAnswerSignal: Omit<WebRTCSignal, "_id" | "_creationTime"> = {
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
    const iceCandidateSignal: Omit<WebRTCSignal, "_id" | "_creationTime"> = {
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

    // Direct signals addressed to the caller. With a session filter, read
    // from the session-scoped composite index so the batch only contains
    // that session's signals — an older take-then-filter over the meeting
    // level index could skip a session's signals entirely when unrelated
    // signals filled the batch.
    const directSignals: WebRTCSignal[] = sessionId
      ? await ctx.db
          .query("webrtcSignals")
          .withIndex("by_meeting_session_target_and_processed", (q) =>
            q
              .eq("meetingId", meetingId)
              .eq("sessionId", sessionId)
              .eq("toUserId", participant.userId)
              .eq("processed", false),
          )
          .take(SIGNAL_SOURCE_BATCH)
      : await ctx.db
          .query("webrtcSignals")
          .withIndex("by_meeting_target_and_processed", (q) =>
            q
              .eq("meetingId", meetingId)
              .eq("toUserId", participant.userId)
              .eq("processed", false),
          )
          .take(SIGNAL_SOURCE_BATCH);

    // Broadcast signals (no toUserId) are excluded from the ranges above
    // by the toUserId equality; fetch them on the same indexes with an
    // undefined equality so every participant receives them.
    const broadcastSignals: WebRTCSignal[] = sessionId
      ? await ctx.db
          .query("webrtcSignals")
          .withIndex("by_meeting_session_target_and_processed", (q) =>
            q
              .eq("meetingId", meetingId)
              .eq("sessionId", sessionId)
              .eq("toUserId", undefined)
              .eq("processed", false),
          )
          .take(SIGNAL_SOURCE_BATCH)
      : await ctx.db
          .query("webrtcSignals")
          .withIndex("by_meeting_target_and_processed", (q) =>
            q
              .eq("meetingId", meetingId)
              .eq("toUserId", undefined)
              .eq("processed", false),
          )
          .take(SIGNAL_SOURCE_BATCH);

    // A broadcast the caller already acked is delivered-for-caller only —
    // the ack must not hide it from other participants.
    const ackedBroadcast = new Set<WebRTCSignal["_id"]>();
    for (const signal of broadcastSignals) {
      const ack = await ctx.db
        .query("webrtcSignalAcks")
        .withIndex("by_signal_and_user", (q) =>
          q.eq("signalId", signal._id).eq("userId", participant.userId),
        )
        .unique();
      if (ack) {
        ackedBroadcast.add(signal._id);
      }
    }

    // Merge both sources into a single _id-ordered stream so the client
    // cursor (lastSignalId) paginates deterministically over the merged
    // result instead of comparing opaque ids across mixed index orders.
    const deliverable = [
      ...directSignals,
      ...broadcastSignals.filter((s) => !ackedBroadcast.has(s._id)),
    ]
      .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
      .filter((s) => !lastSignalId || s._id > lastSignalId)
      .slice(0, SIGNAL_HARD_CAP); // hard cap to prevent overwhelming clients

    return deliverable.map((signal) => ({
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
 * Marks WebRTC signals as processed.
 *
 * Ownership rules:
 *  - a direct signal is ackable only by its recipient (toUserId);
 *  - a broadcast signal is ackable by any participant of its meeting, via a
 *    per-caller ack row so the broadcast survives for everyone else;
 *  - anything else is rejected instead of silently ignored.
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
      if (!signal) {
        throw createError.notFound("WebRTC signal", signalId);
      }

      if (signal.toUserId === identity.userId) {
        // Direct signal addressed to the caller.
        await ctx.db.patch(signalId, {
          processed: true,
        });
        continue;
      }

      if (signal.toUserId === undefined) {
        // Broadcast: every meeting participant may ack, but the ack is
        // recorded per caller — flipping `processed` would delete the
        // broadcast for all other participants.
        await assertMeetingAccess(ctx, signal.meetingId);

        const existingAck = await ctx.db
          .query("webrtcSignalAcks")
          .withIndex("by_signal_and_user", (q) =>
            q.eq("signalId", signalId).eq("userId", identity.userId),
          )
          .unique();
        if (!existingAck) {
          await ctx.db.insert("webrtcSignalAcks", {
            meetingId: signal.meetingId,
            signalId,
            userId: identity.userId,
            ackedAt: Date.now(),
          });
        }
        continue;
      }

      // Addressed to a different user: not the caller's signal to ack.
      throw createError.forbidden(
        "Cannot acknowledge a signal addressed to another user",
        { signalId },
      );
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
    const metrics: Omit<ConnectionMetrics, "_id" | "_creationTime"> = {
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

    // Broadcast signals (no toUserId) are never flipped to processed=true —
    // they are acked per-caller in webrtcSignalAcks — so they would
    // accumulate forever under the processed-only sweep above. Age them
    // out by timestamp together with their per-caller ack rows.
    const oldUnprocessedSignals: WebRTCSignal[] = await ctx.db
      .query("webrtcSignals")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
      .collect();
    const oldBroadcastSignals = oldUnprocessedSignals.filter(
      (s) => s.toUserId === undefined,
    );
    for (const signal of oldBroadcastSignals) {
      const acks = await ctx.db
        .query("webrtcSignalAcks")
        .withIndex("by_signal_and_user", (q) => q.eq("signalId", signal._id))
        .collect();
      for (const ack of acks) {
        await ctx.db.delete(ack._id);
      }
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
