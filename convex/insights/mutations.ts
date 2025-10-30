/**
 * Insights Mutation Functions
 *
 * This module provides mutation functions for managing post-call insights
 * with privacy controls and per-user data isolation.
 *
 * Requirements: 11.1, 11.2, 11.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import { RecommendationV, LinkV } from "@convex/types/validators/prompt";
import type { AIInsight } from "@convex/types/entities/prompt";

/**
 * @summary Creates or updates insights for a user and meeting (internal use).
 * @description Stores AI-generated insights including summary, action items, recommendations, and resource links for a specific user-meeting pair. If insights already exist for this combination, they are updated with the new data rather than creating duplicates. This ensures each user has exactly one insight record per meeting. Called internally by the insight generation actions.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "user_abc123",
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "summary": "This 45-minute meeting involved 2 participants and covered topics including ai-ml, product-strategy.",
 *     "actionItems": [
 *       "Follow up on the AI model training pipeline discussion",
 *       "Share the user research findings document"
 *     ],
 *     "recommendations": [
 *       {
 *         "type": "learning",
 *         "content": "Consider exploring advanced topics in ai-ml to deepen your expertise",
 *         "confidence": 0.7
 *       },
 *       {
 *         "type": "networking",
 *         "content": "Consider connecting with other participants to continue the conversation",
 *         "confidence": 0.8
 *       }
 *     ],
 *     "links": [
 *       {
 *         "type": "resource",
 *         "url": "https://example.com/resources/ai-ml",
 *         "title": "Learn more about ai-ml"
 *       }
 *     ]
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": "insights_ck9hx2g1v0001"
 * }
 * ```
 * @example datamodel
 * ```json
 * {
 *   "insight": {
 *     "_id": "insights_ck9hx2g1v0001",
 *     "_creationTime": 1714066800000,
 *     "userId": "user_abc123",
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "summary": "This 45-minute meeting involved 2 participants and covered topics including ai-ml, product-strategy.",
 *     "actionItems": [
 *       "Follow up on the AI model training pipeline discussion",
 *       "Share the user research findings document"
 *     ],
 *     "recommendations": [
 *       {
 *         "type": "learning",
 *         "content": "Consider exploring advanced topics in ai-ml to deepen your expertise",
 *         "confidence": 0.7
 *       },
 *       {
 *         "type": "networking",
 *         "content": "Consider connecting with other participants to continue the conversation",
 *         "confidence": 0.8
 *       }
 *     ],
 *     "links": [
 *       {
 *         "type": "resource",
 *         "url": "https://example.com/resources/ai-ml",
 *         "title": "Learn more about ai-ml"
 *       }
 *     ],
 *     "createdAt": 1714066800000
 *   }
 * }
 * ```
 */
export const createInsights = internalMutation({
  args: {
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(RecommendationV),
    links: v.optional(v.array(LinkV)),
  },
  returns: v.id("insights"),
  handler: async (
    ctx,
    { userId, meetingId, summary, actionItems, recommendations, links = [] },
  ): Promise<Id<"insights">> => {
    const now = Date.now();

    // Check if insights already exist for this user and meeting
    const existing = await ctx.db
      .query("insights")
      .withIndex("by_user_meeting", (q) =>
        q.eq("userId", userId).eq("meetingId", meetingId),
      )
      .unique();

    if (existing) {
      // Update existing insights
      await ctx.db.patch(existing._id, {
        summary,
        actionItems,
        recommendations,
        links,
      });
      return existing._id;
    }

    // Create new insights
    return await ctx.db.insert("insights", {
      userId,
      meetingId,
      summary,
      actionItems,
      recommendations,
      links,
      createdAt: now,
    });
  },
});

/**
 * @summary Batch creates or updates insights for multiple users (internal use).
 * @description Efficiently creates or updates insights for multiple user-meeting pairs in a single transaction. For each insight, checks if one already exists for that user-meeting combination and updates it if found, otherwise creates a new record. This is useful for bulk insight generation operations while maintaining the constraint of one insight per user-meeting pair.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "insights": [
 *       {
 *         "userId": "user_abc123",
 *         "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *         "summary": "This 45-minute meeting involved 2 participants and covered topics including ai-ml.",
 *         "actionItems": [
 *           "Follow up on the AI model training pipeline discussion"
 *         ],
 *         "recommendations": [
 *           {
 *             "type": "learning",
 *             "content": "Consider exploring advanced topics in ai-ml",
 *             "confidence": 0.7
 *           }
 *         ],
 *         "links": [
 *           {
 *             "type": "resource",
 *             "url": "https://example.com/resources/ai-ml",
 *             "title": "Learn more about ai-ml"
 *           }
 *         ]
 *       },
 *       {
 *         "userId": "user_xyz789",
 *         "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *         "summary": "This 45-minute meeting involved 2 participants and covered topics including product-strategy.",
 *         "actionItems": [
 *           "Share the user research findings document"
 *         ],
 *         "recommendations": [
 *           {
 *             "type": "networking",
 *             "content": "Consider connecting with other participants",
 *             "confidence": 0.8
 *           }
 *         ],
 *         "links": []
 *       }
 *     ]
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": [
 *     "insights_ck9hx2g1v0001",
 *     "insights_ck9hx2g1v0002"
 *   ]
 * }
 * ```
 */
export const batchCreateInsights = internalMutation({
  args: {
    insights: v.array(
      v.object({
        userId: v.id("users"),
        meetingId: v.id("meetings"),
        summary: v.string(),
        actionItems: v.array(v.string()),
        recommendations: v.array(RecommendationV),
        links: v.optional(v.array(LinkV)),
      }),
    ),
  },
  returns: v.array(v.id("insights")),
  handler: async (ctx, { insights }) => {
    const now = Date.now();
    const insightIds: Id<"insights">[] = [];

    for (const insight of insights) {
      // Check if insights already exist for this user and meeting
      const existing = await ctx.db
        .query("insights")
        .withIndex("by_user_meeting", (q) =>
          q.eq("userId", insight.userId).eq("meetingId", insight.meetingId),
        )
        .unique();

      if (existing) {
        // Update existing insights
        await ctx.db.patch(existing._id, {
          summary: insight.summary,
          actionItems: insight.actionItems,
          recommendations: insight.recommendations,
          links: insight.links || [],
        });
        insightIds.push(existing._id);
      } else {
        // Create new insights
        const insightId = await ctx.db.insert("insights", {
          userId: insight.userId,
          meetingId: insight.meetingId,
          summary: insight.summary,
          actionItems: insight.actionItems,
          recommendations: insight.recommendations,
          links: insight.links || [],
          createdAt: now,
        });
        insightIds.push(insightId);
      }
    }

    return insightIds;
  },
});

/**
 * @summary Updates insights with user feedback on usefulness and quality.
 * @description Allows users to provide feedback on their insights including marking as read, rating usefulness, providing a 1-5 star rating, and adding notes. Enforces ownership verification to ensure users can only provide feedback on their own insights. Feedback is stored in the recommendations metadata for future AI model improvements. This helps the system learn which types of insights are most valuable to users.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "insightId": "insights_ck9hx2g1v0001",
 *     "feedback": {
 *       "read": true,
 *       "useful": true,
 *       "rating": 4,
 *       "notes": "The action items were very helpful, but some recommendations were too generic"
 *     }
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Access denied: Not the owner of this resource",
 *   "errorData": {
 *     "code": "FORBIDDEN",
 *     "resourceId": "insights_ck9hx2g1v0001",
 *     "userId": "user_abc123"
 *   },
 *   "value": null
 * }
 * ```
 */
export const updateInsightsFeedback = mutation({
  args: {
    insightId: v.id("insights"),
    feedback: v.object({
      read: v.optional(v.boolean()),
      useful: v.optional(v.boolean()),
      rating: v.optional(v.number()), // 1-5 scale
      notes: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { insightId, feedback }) => {
    const identity = await requireIdentity(ctx);

    const insight = await ctx.db.get(insightId);
    if (!insight) {
      throw createError.notFound("Insight", insightId);
    }

    // Verify ownership
    await assertOwnershipOrAdmin(ctx, insight.userId);

    // For now, we'll store feedback in metadata
    // In a full implementation, we might have a separate feedback table
    const updatedRecommendations = insight.recommendations.map((rec) => ({
      ...rec,
      // Add feedback metadata (this is a simplified approach)
      metadata: {
        ...((rec as any).metadata || {}),
        userFeedback: feedback,
        updatedAt: Date.now(),
      },
    }));

    await ctx.db.patch(insightId, {
      recommendations: updatedRecommendations,
    });

    return null;
  },
});

/**
 * @summary Deletes a user's insight record.
 * @description Allows users to permanently delete their own insights. Enforces ownership verification to ensure users can only delete their own insights. This is useful when users want to remove outdated or irrelevant insights from their history. The deletion is permanent and cannot be undone.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "insightId": "insights_ck9hx2g1v0001"
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Access denied: Not the owner of this resource",
 *   "errorData": {
 *     "code": "FORBIDDEN",
 *     "resourceId": "insights_ck9hx2g1v0001",
 *     "userId": "user_abc123"
 *   },
 *   "value": null
 * }
 * ```
 */
export const deleteInsights = mutation({
  args: {
    insightId: v.id("insights"),
  },
  returns: v.null(),
  handler: async (ctx, { insightId }) => {
    const identity = await requireIdentity(ctx);

    const insight = await ctx.db.get(insightId);
    if (!insight) {
      throw createError.notFound("Insight", insightId);
    }

    // Verify ownership
    await assertOwnershipOrAdmin(ctx, insight.userId);

    await ctx.db.delete(insightId);
    return null;
  },
});

/**
 * @summary Cleans up old insights in batches (internal use).
 * @description Deletes insights older than the specified age in configurable batch sizes to manage database size and comply with data retention policies. Processes insights in batches to avoid transaction timeouts. Returns the number of insights deleted and whether more remain to be cleaned up, allowing for incremental cleanup via scheduled jobs.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "olderThanMs": 7776000000,
 *     "batchSize": 50
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "deleted": 50,
 *     "remaining": true
 *   }
 * }
 * ```
 * @example response-complete
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "deleted": 23,
 *     "remaining": false
 *   }
 * }
 * ```
 */
export const cleanupOldInsights = internalMutation({
  args: {
    olderThanMs: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    remaining: v.boolean(),
  }),
  handler: async (ctx, { olderThanMs, batchSize = 100 }) => {
    const cutoffTime = Date.now() - olderThanMs;

    // Get old insights
    const oldInsights = await ctx.db
      .query("insights")
      .filter((q) => q.lt(q.field("createdAt"), cutoffTime))
      .take(batchSize);

    // Delete them
    for (const insight of oldInsights) {
      await ctx.db.delete(insight._id);
    }

    // Check if there are more to delete
    const remaining = await ctx.db
      .query("insights")
      .filter((q) => q.lt(q.field("createdAt"), cutoffTime))
      .take(1);

    return {
      deleted: oldInsights.length,
      remaining: remaining.length > 0,
    };
  },
});
