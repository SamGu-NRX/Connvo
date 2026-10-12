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

import { internalMutation } from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { v } from "convex/values";
import { metadataRecordV } from "@convex/lib/validators";
import { createError } from "@convex/lib/errors";
import {
  WebRTCApiResponseV,
  webrtcSessionStateV,
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

// The public signaling API (sessions, signals, presence) lives in
// ./mesh.ts. The functions that used to be here addressed signals to users
// rather than sessions, accepted signals with no target that nobody could
// ever read, and had no heartbeat; nothing called them. What remains here is
// internal.

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
    // The authenticated caller; only the session's owner may change it.
    userId: v.id("users"),
    state: webrtcSessionStateV,
    metadata: v.optional(metadataRecordV),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, userId, state, metadata }) => {
    const session: WebRTCSession | null = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_and_session", (q) =>
        q.eq("meetingId", meetingId).eq("sessionId", sessionId),
      )
      .unique();

    if (session && session.userId !== userId) {
      throw createError.forbidden("Access denied: not your call session", {
        meetingId,
        sessionId,
      });
    }
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

/** Rows of each kind one cleanup run deletes before scheduling the next. */
export const CLEANUP_BATCH = 500;

/**
 * Cleanup old WebRTC signals and closed or failed sessions, CLEANUP_BATCH of
 * each kind per run. A full batch schedules another run, so any backlog is
 * worked through without one transaction reading all of it.
 */
export const cleanupOldWebRTCData = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
  },
  returns: WebRTCApiResponseV.cleanup,
  handler: async (ctx, { olderThanMs = 24 * 60 * 60 * 1000 }) => {
    // Default 24 hours
    const cutoff = Date.now() - olderThanMs;

    // Clean up old signals, read or not: an unread signal past the cutoff
    // is addressed to a session that is long gone.
    const oldSignals: WebRTCSignal[] = await ctx.db
      .query("webrtcSignals")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
      .take(CLEANUP_BATCH);

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
        .take(CLEANUP_BATCH),
      ctx.db
        .query("webrtcSessions")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", "failed").lt("updatedAt", cutoff),
        )
        .take(CLEANUP_BATCH),
    ]);
    const oldSessions: WebRTCSession[] = [...closedSessions, ...failedSessions];

    for (const session of oldSessions) {
      await ctx.db.delete(session._id);
    }

    if (
      oldSignals.length === CLEANUP_BATCH ||
      closedSessions.length === CLEANUP_BATCH ||
      failedSessions.length === CLEANUP_BATCH
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.meetings.webrtc.signaling.cleanupOldWebRTCData,
        { olderThanMs },
      );
    }

    return {
      signalsDeleted: oldSignals.length,
      sessionsDeleted: oldSessions.length,
    };
  },
});
