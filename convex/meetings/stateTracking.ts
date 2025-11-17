/**
 * Meeting State Tracking Functions
 *
 * This module provides functions for tracking meeting state including
 * speaking time, lull detection, and topic analysis for contextual prompts.
 *
 * Requirements: 10.1, 10.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { internal } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { MeetingRuntimeStateV } from "@convex/types/validators/meeting";
import type { SpeakingStats, LullState } from "@convex/types/entities/meeting";

/**
 * @summary Updates speaking analytics for an in-progress meeting
 * @description Mutation that aggregates per-user speaking duration and resets lull
 * detection timers whenever new audio activity is reported. The mutation creates
 * the backing `meetingState` document on first invocation so subsequent calls
 * share the same counters. Requires the caller to have access to the meeting.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_84c0example",
 *     "userId": "user_alice_example",
 *     "speakingDurationMs": 3150
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
 *   "value": null
 * }
 * ```
 *
 * @example response-not-found
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Failed to initialize meeting state",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 */
export const updateSpeakingStats = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    speakingDurationMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, speakingDurationMs }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    // Get current meeting state
    let meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingState) {
      // Create initial meeting state and reload created document for proper typing
      const createdId = await ctx.db.insert("meetingState", {
        meetingId,
        active: true,
        speakingStats: {
          totalMs: 0,
          byUserMs: {},
        },
        lullState: {
          detected: false,
          lastActivity: Date.now(),
          duration: 0,
        },
        topics: [],
        recordingEnabled: false,
        updatedAt: Date.now(),
      });
      meetingState = await ctx.db.get(createdId);
      if (!meetingState) {
        throw createError.internal("Failed to initialize meeting state");
      }
    }

    const now = Date.now();
    const currentStats = meetingState.speakingStats || {
      totalMs: 0,
      byUserMs: {},
    };
    const userIdStr = userId.toString();

    // Update speaking statistics
    const updatedStats: SpeakingStats = {
      totalMs: currentStats.totalMs + speakingDurationMs,
      byUserMs: {
        ...currentStats.byUserMs,
        [userIdStr]:
          (currentStats.byUserMs[userIdStr] || 0) + speakingDurationMs,
      },
    };

    // Update lull state (reset since there's activity)
    const updatedLullState: LullState = {
      detected: false,
      lastActivity: now,
      duration: 0,
    };

    await ctx.db.patch(meetingState._id, {
      speakingStats: updatedStats,
      lullState: updatedLullState,
      updatedAt: now,
    });

    return null;
  },
});

/**
 * Updates lull detection state
 */
export const updateLullState = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    lullDetected: v.boolean(),
    lastActivity: v.number(),
    duration: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, lullDetected, lastActivity, duration }) => {
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingState) {
      throw createError.notFound("Meeting state", meetingId);
    }

    const lullState: LullState = {
      detected: lullDetected,
      lastActivity,
      duration,
    };

    await ctx.db.patch(meetingState._id, {
      lullState,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * @summary Tracks the active discussion topics for contextual features
 * @description Mutation that updates the list of topics currently being discussed
 * in a meeting. Used by prompt generation and insights pipelines to provide
 * contextual suggestions. Validates the caller has access to the meeting and
 * persists the new topic list on the shared `meetingState` document.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_84c0example",
 *     "topics": ["roadmap", "staffing", "launch-readiness"]
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
 *   "value": null
 * }
 * ```
 *
 * @example response-not-found
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Meeting state meeting_84c0example not found",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 */
export const updateCurrentTopics = mutation({
  args: {
    meetingId: v.id("meetings"),
    topics: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, topics }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingState) {
      throw createError.notFound("Meeting state", meetingId);
    }

    await ctx.db.patch(meetingState._id, {
      topics,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Detects and handles lulls in conversation
 */
export const detectLull = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    currentTime: v.number(),
    lullThresholdMs: v.optional(v.number()),
  },
  returns: v.object({
    lullDetected: v.boolean(),
    duration: v.number(),
    shouldGeneratePrompts: v.boolean(),
  }),
  handler: async (ctx, { meetingId, currentTime, lullThresholdMs = 30000 }) => {
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingState || !meetingState.active) {
      return {
        lullDetected: false,
        duration: 0,
        shouldGeneratePrompts: false,
      };
    }

    const lastActivity = meetingState.lullState?.lastActivity || currentTime;
    const duration = currentTime - lastActivity;
    const lullDetected = duration > lullThresholdMs;

    // Update lull state
    const lullState: LullState = {
      detected: lullDetected,
      lastActivity,
      duration,
    };

    await ctx.db.patch(meetingState._id, {
      lullState,
      updatedAt: currentTime,
    });

    // Only generate prompts if this is a new lull (not already detected)
    const shouldGeneratePrompts =
      lullDetected && !meetingState.lullState?.detected;

    return {
      lullDetected,
      duration,
      shouldGeneratePrompts,
    };
  },
});

/**
 * @summary Records non-speaking activity and clears lull detection flags
 * @description Mutation invoked when clients observe activity such as chat
 * messages, screen sharing, or reactions. Resets the lull timer so prompt
 * generation is not triggered incorrectly. Access is restricted to meeting
 * participants, and the mutation gracefully no-ops if the meeting state has
 * not been initialized yet.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_84c0example",
 *     "activityType": "reaction",
 *     "userId": "user_bob_example"
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
 *   "value": null
 * }
 * ```
 *
 * @example response-unauthorized
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Not authorized to access meeting meeting_84c0example",
 *   "errorData": {
 *     "code": "AUTH_FORBIDDEN"
 *   },
 *   "value": null
 * }
 * ```
 */
export const recordActivity = mutation({
  args: {
    meetingId: v.id("meetings"),
    activityType: v.union(
      v.literal("speaking"),
      v.literal("message"),
      v.literal("screen_share"),
      v.literal("reaction"),
    ),
    userId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, activityType, userId }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const now = Date.now();

    // Update meeting state to reset lull detection
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      const lullState: LullState = {
        detected: false,
        lastActivity: now,
        duration: 0,
      };

      await ctx.db.patch(meetingState._id, {
        lullState,
        updatedAt: now,
      });
    }

    return null;
  },
});

/**
 * Gets speaking time ratios for participants
 */
export const getSpeakingTimeRatios = internalMutation({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.record(v.string(), v.number()),
  handler: async (ctx, { meetingId }) => {
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingState?.speakingStats) {
      return {};
    }

    const { totalMs, byUserMs } = meetingState.speakingStats;

    if (totalMs === 0) {
      return {};
    }

    // Convert to ratios (0.0 to 1.0)
    const ratios: Record<string, number> = {};
    for (const [userId, speakingTime] of Object.entries(byUserMs)) {
      ratios[userId] = speakingTime / totalMs;
    }

    return ratios;
  },
});
