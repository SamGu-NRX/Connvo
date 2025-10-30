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
 * @summary Creates a new AI-generated prompt (internal use)
 * @description Inserts a new prompt into the database with the specified meeting ID, type, content, tags, and relevance score. Sets the creation timestamp automatically. Used internally by prompt generation actions. Returns the newly created prompt ID.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "type": "precall",
 *     "content": "I noticed you both have experience with ai-ml. What drew you to this field initially?",
 *     "tags": ["shared-interests", "background"],
 *     "relevance": 0.9
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
 *   "value": "prompts_ck9hx2g1v0001"
 * }
 * ```
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
 * @summary Updates user feedback for a prompt
 * @description Records user interaction with a prompt by setting feedback status (used, dismissed, or upvoted). When feedback is "used", automatically sets the usedAt timestamp. Verifies user has access to the meeting before updating. Useful for tracking prompt effectiveness and user engagement.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "promptId": "prompts_ck9hx2g1v0001",
 *     "feedback": "used"
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
 * @example request-dismissed
 * ```json
 * {
 *   "args": {
 *     "promptId": "prompts_ck9hx2g1v0002",
 *     "feedback": "dismissed"
 *   }
 * }
 * ```
 *
 * @example request-upvoted
 * ```json
 * {
 *   "args": {
 *     "promptId": "prompts_ck9hx2g1v0003",
 *     "feedback": "upvoted"
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Prompt with ID prompts_ck9hx2g1v9999 not found",
 *   "errorData": {
 *     "code": "NOT_FOUND",
 *     "message": "Prompt with ID prompts_ck9hx2g1v9999 not found",
 *     "statusCode": 404,
 *     "metadata": {
 *       "id": "prompts_ck9hx2g1v9999"
 *     }
 *   },
 *   "value": null
 * }
 * ```
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
 * @summary Marks a prompt as used with timestamp (internal use)
 * @description Updates a prompt's feedback status to "used" and records the usage timestamp. Used internally by systems that track prompt usage without going through the public API. Does not perform authorization checks.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "promptId": "prompts_ck9hx2g1v0001",
 *     "usedAt": 1714066850000
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
 * @summary Batch creates multiple prompts efficiently (internal use)
 * @description Inserts multiple prompts in a single transaction for improved performance. All prompts receive the same creation timestamp for consistency. Used by prompt generation actions to create multiple prompts at once. Returns an array of newly created prompt IDs in the same order as the input.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "prompts": [
 *       {
 *         "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *         "type": "precall",
 *         "content": "I noticed you both have experience with ai-ml. What drew you to this field initially?",
 *         "tags": ["shared-interests", "background"],
 *         "relevance": 0.9
 *       },
 *       {
 *         "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *         "type": "precall",
 *         "content": "Given your mutual interest in ai-ml, what trends are you most excited about right now?",
 *         "tags": ["shared-interests", "trends"],
 *         "relevance": 0.8
 *       }
 *     ]
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
 *   "value": [
 *     "prompts_ck9hx2g1v0001",
 *     "prompts_ck9hx2g1v0002"
 *   ]
 * }
 * ```
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
 * @summary Deletes old prompts to prevent accumulation (internal use)
 * @description Removes prompts beyond the specified keep count for a meeting and type, ordered by creation time (keeping newest). Used to prevent unlimited prompt accumulation during long meetings. Returns the number of prompts deleted. Typically called after generating new in-call prompts.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "type": "incall",
 *     "keepCount": 10
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
 *   "value": 5
 * }
 * ```
 *
 * @example response-no-cleanup
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": 0
 * }
 * ```
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
