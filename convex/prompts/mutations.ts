/**
 * Prompts Mutation Functions
 *
 * This module provides mutation functions for managing AI-generated prompts
 * with proper authorization and feedback tracking.
 *
 * Requirements: 9.5, 10.4, 10.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import type { AIPrompt } from "@convex/types/entities/prompt";

/**
 * Creates a new prompt (internal use)
 */
export const createPrompt = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    type: v.union(v.literal("precall"), v.literal("incall")),
    content: v.string(),
    tags: v.array(v.string()),
    relevance: v.number(),
  },
  returns: v.id("prompts"),
  handler: async (
    ctx,
    { meetingId, type, content, tags, relevance },
  ): Promise<Id<"prompts">> => {
    const now = Date.now();

    return await ctx.db.insert("prompts", {
      meetingId,
      type,
      content,
      tags,
      relevance,
      createdAt: now,
    });
  },
});

/**
 * Updates prompt feedback when user interacts with it
 */
export const updatePromptFeedback = mutation({
  args: {
    promptId: v.id("prompts"),
    feedback: v.union(
      v.literal("used"),
      v.literal("dismissed"),
      v.literal("upvoted"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { promptId, feedback }) => {
    const identity = await requireIdentity(ctx);

    // Get the prompt to verify meeting access
    const prompt = await ctx.db.get(promptId);
    if (!prompt) {
      throw createError.notFound("Prompt", promptId);
    }

    // Verify user has access to the meeting
    await assertMeetingAccess(ctx, prompt.meetingId);

    const now = Date.now();
    const updates: Partial<{
      feedback: "used" | "dismissed" | "upvoted";
      usedAt: number;
    }> = { feedback };

    // Set usedAt timestamp if feedback is "used"
    if (feedback === "used") {
      updates.usedAt = now;
    }

    await ctx.db.patch(promptId, updates);

    return null;
  },
});

/**
 * Marks a prompt as used (internal use)
 */
export const markPromptAsUsed = internalMutation({
  args: {
    promptId: v.id("prompts"),
    usedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { promptId, usedAt }) => {
    await ctx.db.patch(promptId, {
      feedback: "used",
      usedAt,
    });
    return null;
  },
});

/**
 * Batch creates multiple prompts (internal use)
 */
export const batchCreatePrompts = internalMutation({
  args: {
    prompts: v.array(
      v.object({
        meetingId: v.id("meetings"),
        type: v.union(v.literal("precall"), v.literal("incall")),
        content: v.string(),
        tags: v.array(v.string()),
        relevance: v.number(),
      }),
    ),
  },
  returns: v.array(v.id("prompts")),
  handler: async (ctx, { prompts }) => {
    const now = Date.now();
    const promptIds: Id<"prompts">[] = [];

    for (const prompt of prompts) {
      const promptId = await ctx.db.insert("prompts", {
        ...prompt,
        createdAt: now,
      });
      promptIds.push(promptId);
    }

    return promptIds;
  },
});

/**
 * Deletes old prompts for a meeting (cleanup, internal use)
 */
export const cleanupOldPrompts = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    type: v.union(v.literal("precall"), v.literal("incall")),
    keepCount: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, { meetingId, type, keepCount }) => {
    // Get all prompts for this meeting and type, ordered by creation time (newest first)
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_meeting_type", (q) =>
        q.eq("meetingId", meetingId).eq("type", type),
      )
      .order("desc")
      .collect();

    // Delete prompts beyond the keep count
    const promptsToDelete = prompts.slice(keepCount);
    let deletedCount = 0;

    for (const prompt of promptsToDelete) {
      await ctx.db.delete(prompt._id);
      deletedCount++;
    }

    return deletedCount;
  },
});
