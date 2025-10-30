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
 * @summary Gets prompts for a meeting filtered by type (internal use)
 * @description Retrieves prompts for a specific meeting and type (precall or incall) with deterministic ordering. Used internally by other functions to fetch prompts without authorization checks. Returns up to the specified limit of prompts ordered by creation time.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "type": "precall",
 *     "limit": 10
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
 *     {
 *       "_id": "prompts_ck9hx2g1v0001",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "type": "precall",
 *       "content": "I noticed you both have experience with ai-ml. What drew you to this field initially?",
 *       "tags": ["shared-interests", "background"],
 *       "relevance": 0.9,
 *       "createdAt": 1714066800000
 *     }
 *   ]
 * }
 * ```
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
 * @summary Gets pre-call conversation prompts for a meeting
 * @description Retrieves AI-generated pre-call prompts for a meeting, sorted by relevance score (highest first). Verifies user has access to the meeting before returning prompts. Includes prompt content, tags, relevance scores, usage status, and user feedback. Useful for displaying conversation starters before a meeting begins.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "limit": 10
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
 *     {
 *       "_id": "prompts_ck9hx2g1v0001",
 *       "content": "I noticed you both have experience with ai-ml. What drew you to this field initially?",
 *       "tags": ["shared-interests", "background"],
 *       "relevance": 0.9,
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "_id": "prompts_ck9hx2g1v0002",
 *       "content": "You come from different backgrounds (Technology, Product). What perspectives do you think each industry brings to problem-solving?",
 *       "tags": ["cross-industry", "perspectives"],
 *       "relevance": 0.85,
 *       "usedAt": 1714066850000,
 *       "feedback": "used",
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "_id": "prompts_ck9hx2g1v0003",
 *       "content": "Given your mutual interest in ai-ml, what trends are you most excited about right now?",
 *       "tags": ["shared-interests", "trends"],
 *       "relevance": 0.8,
 *       "feedback": "upvoted",
 *       "createdAt": 1714066800000
 *     }
 *   ]
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "User does not have access to meeting me_82f8c0a8bce1a2d5f4e7b6c9",
 *   "errorData": {
 *     "code": "FORBIDDEN",
 *     "message": "User does not have access to meeting me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "statusCode": 403,
 *     "metadata": {
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9"
 *     }
 *   },
 *   "value": null
 * }
 * ```
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
 * @summary Gets in-call conversation prompts for an active meeting
 * @description Retrieves AI-generated in-call prompts for a meeting, sorted by relevance score (highest first). These prompts are dynamically generated during the meeting based on conversation lulls, speaking balance, and topic shifts. Verifies user has access to the meeting before returning prompts. Returns fewer prompts than pre-call (default 5) to avoid overwhelming participants.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "limit": 5
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
 *     {
 *       "_id": "prompts_ck9hx3g1v0007",
 *       "content": "Let's try a different angle. What's one thing you've learned recently that surprised you?",
 *       "tags": ["lull", "severe", "learning"],
 *       "relevance": 0.9,
 *       "createdAt": 1714066805000
 *     },
 *     {
 *       "_id": "prompts_ck9hx3g1v0008",
 *       "content": "I'd love to hear everyone's perspective on this. What do you think?",
 *       "tags": ["balance", "inclusion"],
 *       "relevance": 0.85,
 *       "usedAt": 1714066820000,
 *       "feedback": "used",
 *       "createdAt": 1714066805000
 *     }
 *   ]
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "User does not have access to meeting me_82f8c0a8bce1a2d5f4e7b6c9",
 *   "errorData": {
 *     "code": "FORBIDDEN",
 *     "message": "User does not have access to meeting me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "statusCode": 403,
 *     "metadata": {
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9"
 *     }
 *   },
 *   "value": null
 * }
 * ```
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
 * @summary Gets a single prompt by ID (internal use)
 * @description Retrieves a prompt by its unique identifier without authorization checks. Used internally by other functions that need to access prompt data. Returns null if the prompt does not exist.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "promptId": "prompts_ck9hx2g1v0001"
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
 *   "value": {
 *     "_id": "prompts_ck9hx2g1v0001",
 *     "_creationTime": 1714066800000,
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "type": "precall",
 *     "content": "I noticed you both have experience with ai-ml. What drew you to this field initially?",
 *     "tags": ["shared-interests", "background"],
 *     "relevance": 0.9,
 *     "createdAt": 1714066800000
 *   }
 * }
 * ```
 *
 * @example response-not-found
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 */
export const getPromptById = internalQuery({
  args: { promptId: v.id("prompts") },
  returns: v.union(AIPromptV.full, v.null()),
  handler: async (ctx, { promptId }): Promise<AIPrompt | null> => {
    return await ctx.db.get(promptId);
  },
});

/**
 * @summary Subscribes to real-time in-call prompts for a meeting
 * @description Provides a reactive subscription to in-call prompts that automatically updates when new prompts are generated during the meeting. Returns the most recent prompts (up to 10) along with a timestamp for tracking updates. Ideal for real-time UI updates in meeting interfaces. Verifies user has access to the meeting.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9"
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
 *   "value": {
 *     "prompts": [
 *       {
 *         "_id": "prompts_ck9hx3g1v0010",
 *         "content": "What's your take on what we just discussed?",
 *         "tags": ["lull", "moderate", "reflection"],
 *         "relevance": 0.8,
 *         "createdAt": 1714066830000
 *       },
 *       {
 *         "_id": "prompts_ck9hx3g1v0009",
 *         "content": "Since you both work with ai-ml, what trends are you seeing in that space?",
 *         "tags": ["interests", "trends"],
 *         "relevance": 0.8,
 *         "usedAt": 1714066825000,
 *         "feedback": "used",
 *         "createdAt": 1714066805000
 *       }
 *     ],
 *     "lastUpdated": 1714066835000
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "User does not have access to meeting me_82f8c0a8bce1a2d5f4e7b6c9",
 *   "errorData": {
 *     "code": "FORBIDDEN",
 *     "message": "User does not have access to meeting me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "statusCode": 403,
 *     "metadata": {
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9"
 *     }
 *   },
 *   "value": null
 * }
 * ```
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
