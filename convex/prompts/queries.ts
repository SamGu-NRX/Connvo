/**
 * Prompts Query Functions
 *
 * This module provides query functions for AI-generated prompts with
 * proper authorization and performance optimization.
 *
 * Requirements: 9.1, 9.3, 9.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { Id } from "@convex/_generated/dataModel";
import { AIPromptV } from "@convex/types/validators/prompt";
import type { AIPrompt } from "@convex/types/entities/prompt";

/**
 * Gets prompts for a meeting by type (internal use)
 */
export const getPromptsByMeetingAndType = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    type: v.union(v.literal("precall"), v.literal("incall")),
    limit: v.optional(v.number()),
  },
  returns: v.array(AIPromptV.full),
  handler: async (ctx, { meetingId, type, limit = 10 }) => {
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_meeting_type", (q) =>
        q.eq("meetingId", meetingId).eq("type", type),
      )
      .order("asc") // Ensure deterministic order
      .take(limit);

    return prompts;
  },
});

/**
 * Gets pre-call prompts for a meeting with authorization
 */
export const getPreCallPrompts = query({
  args: {
    meetingId: v.id("meetings"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("prompts"),
      content: v.string(),
      tags: v.array(v.string()),
      relevance: v.number(),
      usedAt: v.optional(v.number()),
      feedback: v.optional(
        v.union(
          v.literal("used"),
          v.literal("dismissed"),
          v.literal("upvoted"),
        ),
      ),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId, limit = 10 }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_meeting_type", (q) =>
        q.eq("meetingId", meetingId).eq("type", "precall"),
      )
      .order("desc")
      .take(limit);

    // Return prompts sorted by relevance (highest first)
    return prompts
      .sort((a, b) => b.relevance - a.relevance)
      .map((prompt) => ({
        _id: prompt._id,
        content: prompt.content,
        tags: prompt.tags,
        relevance: prompt.relevance,
        usedAt: prompt.usedAt,
        feedback: prompt.feedback,
        createdAt: prompt.createdAt,
      }));
  },
});

/**
 * Gets in-call prompts for a meeting with authorization
 */
export const getInCallPrompts = query({
  args: {
    meetingId: v.id("meetings"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("prompts"),
      content: v.string(),
      tags: v.array(v.string()),
      relevance: v.number(),
      usedAt: v.optional(v.number()),
      feedback: v.optional(
        v.union(
          v.literal("used"),
          v.literal("dismissed"),
          v.literal("upvoted"),
        ),
      ),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId, limit = 5 }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_meeting_type", (q) =>
        q.eq("meetingId", meetingId).eq("type", "incall"),
      )
      .order("desc")
      .take(limit);

    // Return prompts sorted by relevance (highest first)
    return prompts
      .sort((a, b) => b.relevance - a.relevance)
      .map((prompt) => ({
        _id: prompt._id,
        content: prompt.content,
        tags: prompt.tags,
        relevance: prompt.relevance,
        usedAt: prompt.usedAt,
        feedback: prompt.feedback,
        createdAt: prompt.createdAt,
      }));
  },
});

/**
 * Gets prompt by ID with authorization (internal use)
 */
export const getPromptById = internalQuery({
  args: { promptId: v.id("prompts") },
  returns: v.union(AIPromptV.full, v.null()),
  handler: async (ctx, { promptId }): Promise<AIPrompt | null> => {
    return await ctx.db.get(promptId);
  },
});

/**
 * Subscribes to real-time in-call prompts for a meeting
 */
export const subscribeToInCallPrompts = query({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.object({
    prompts: v.array(
      v.object({
        _id: v.id("prompts"),
        content: v.string(),
        tags: v.array(v.string()),
        relevance: v.number(),
        usedAt: v.optional(v.number()),
        feedback: v.optional(
          v.union(
            v.literal("used"),
            v.literal("dismissed"),
            v.literal("upvoted"),
          ),
        ),
        createdAt: v.number(),
      }),
    ),
    lastUpdated: v.number(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_meeting_type", (q) =>
        q.eq("meetingId", meetingId).eq("type", "incall"),
      )
      .order("desc")
      .take(10);

    // Return prompts sorted by creation time (newest first)
    return {
      prompts: prompts.map((prompt) => ({
        _id: prompt._id,
        content: prompt.content,
        tags: prompt.tags,
        relevance: prompt.relevance,
        usedAt: prompt.usedAt,
        feedback: prompt.feedback,
        createdAt: prompt.createdAt,
      })),
      lastUpdated: Date.now(),
    };
  },
});
