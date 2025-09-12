/**
 * Meeting State Tracking Functions
 *
 * This module provides functions for tracking meeting state including
 * speaking time, lull detection, and topic analysis for contextual prompts.
 *
 * Requirements: 10.1, 10.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "../auth/guards";
import { createError } from "../lib/errors";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

/**
 * Updates speaking statistics for a meeting
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
    const updatedStats = {
      totalMs: currentStats.totalMs + speakingDurationMs,
      byUserMs: {
        ...currentStats.byUserMs,
        [userIdStr]:
          (currentStats.byUserMs[userIdStr] || 0) + speakingDurationMs,
      },
    };

    // Update lull state (reset since there's activity)
    const updatedLullState = {
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

    await ctx.db.patch(meetingState._id, {
      lullState: {
        detected: lullDetected,
        lastActivity,
        duration,
      },
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Updates current topics being discussed
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
    await ctx.db.patch(meetingState._id, {
      lullState: {
        detected: lullDetected,
        lastActivity,
        duration,
      },
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
 * Records activity to reset lull detection
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
      await ctx.db.patch(meetingState._id, {
        lullState: {
          detected: false,
          lastActivity: now,
          duration: 0,
        },
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
