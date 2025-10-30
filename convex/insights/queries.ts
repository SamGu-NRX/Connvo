/**
 * Insights Query Functions
 *
 * This module provides query functions for post-call insights with
 * privacy controls and per-user access restrictions.
 *
 * Requirements: 11.1, 11.3, 11.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import {
  AIInsightV,
  ConnectionRecommendationV,
} from "@convex/types/validators/prompt";
import type { AIInsight } from "@convex/types/entities/prompt";

/**
 * Gets insights for a user and meeting (internal use)
 */
export const getInsightsByUserAndMeeting = internalQuery({
  args: {
    userId: v.id("users"),
    meetingId: v.id("meetings"),
  },
  returns: v.union(AIInsightV.full, v.null()),
  handler: async (ctx, { userId, meetingId }): Promise<AIInsight | null> => {
    return await ctx.db
      .query("insights")
      .withIndex("by_user_meeting", (q) =>
        q.eq("userId", userId).eq("meetingId", meetingId),
      )
      .unique();
  },
});

/**
 * @summary Gets the authenticated user's personal insights for a specific meeting.
 * @description Retrieves AI-generated insights including summary, action items, recommendations, and resource links for the current user's participation in a meeting. Enforces privacy controls by verifying the user was a participant in the meeting before returning insights. Returns null if no insights have been generated yet. Each user only sees their own personalized insights, maintaining per-user data isolation.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9"
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
 *     "_id": "insights_ck9hx2g1v0001",
 *     "summary": "This 45-minute meeting involved 2 participants and covered topics including ai-ml, product-strategy, user-research. Key points were documented in the shared notes.",
 *     "actionItems": [
 *       "Follow up on the AI model training pipeline discussion",
 *       "Share the user research findings document",
 *       "Schedule next sprint planning session"
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
 *     "createdAt": 1714066800000,
 *     "meetingTitle": "Product Strategy Sync",
 *     "meetingDate": 1714066200000
 *   }
 * }
 * ```
 * @example response-not-found
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
 *   "errorMessage": "Access denied: Not a meeting participant",
 *   "errorData": {
 *     "code": "FORBIDDEN",
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "userId": "user_abc123"
 *   },
 *   "value": null
 * }
 * ```
 */
export const getMeetingInsights = query({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.union(
    v.object({
      _id: v.id("insights"),
      summary: v.string(),
      actionItems: v.array(v.string()),
      recommendations: v.array(
        v.object({
          type: v.string(),
          content: v.string(),
          confidence: v.number(),
        }),
      ),
      links: v.array(
        v.object({
          type: v.string(),
          url: v.string(),
          title: v.string(),
        }),
      ),
      createdAt: v.number(),
      meetingTitle: v.string(),
      meetingDate: v.number(),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    { meetingId },
  ): Promise<{
    _id: Id<"insights">;
    summary: string;
    actionItems: string[];
    recommendations: Array<{
      type: string;
      content: string;
      confidence: number;
    }>;
    links: Array<{
      type: string;
      url: string;
      title: string;
    }>;
    createdAt: number;
    meetingTitle: string;
    meetingDate: number;
  } | null> => {
    const identity = await requireIdentity(ctx);

    // Get the meeting to verify access and get basic info
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    // Check if user was a participant in the meeting
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();

    if (!participant) {
      throw createError.forbidden("Access denied: Not a meeting participant", {
        meetingId,
        userId: identity.userId,
      });
    }

    // Get user's personal insights for this meeting
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user_meeting", (q) =>
        q.eq("userId", identity.userId).eq("meetingId", meetingId),
      )
      .unique();

    if (!insights) {
      return null;
    }

    return {
      _id: insights._id,
      summary: insights.summary,
      actionItems: insights.actionItems,
      recommendations: insights.recommendations,
      links: insights.links,
      createdAt: insights.createdAt,
      meetingTitle: meeting.title,
      meetingDate: meeting.scheduledAt || meeting.createdAt,
    };
  },
});

/**
 * @summary Lists all insights for the authenticated user with pagination.
 * @description Retrieves a paginated list of all insights generated for the current user across all their meetings. Results are ordered by creation time (most recent first) and enriched with meeting metadata including title and date. Supports pagination via limit and offset parameters for efficient loading of large insight histories.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "limit": 10,
 *     "offset": 0
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
 *     {
 *       "_id": "insights_ck9hx2g1v0001",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "summary": "This 45-minute meeting involved 2 participants and covered topics including ai-ml, product-strategy.",
 *       "actionItems": [
 *         "Follow up on the AI model training pipeline discussion",
 *         "Share the user research findings document"
 *       ],
 *       "recommendations": [
 *         {
 *           "type": "learning",
 *           "content": "Consider exploring advanced topics in ai-ml to deepen your expertise",
 *           "confidence": 0.7
 *         }
 *       ],
 *       "createdAt": 1714066800000,
 *       "meetingTitle": "Product Strategy Sync",
 *       "meetingDate": 1714066200000
 *     },
 *     {
 *       "_id": "insights_ck9hx2g1v0002",
 *       "_creationTime": 1714063200000,
 *       "meetingId": "me_xyz789",
 *       "summary": "This 30-minute meeting involved 3 participants and covered topics including design-systems, frontend-architecture.",
 *       "actionItems": [
 *         "Review the component library documentation",
 *         "Schedule design review session"
 *       ],
 *       "recommendations": [
 *         {
 *           "type": "networking",
 *           "content": "Consider connecting with other participants to continue the conversation",
 *           "confidence": 0.8
 *         }
 *       ],
 *       "createdAt": 1714063200000,
 *       "meetingTitle": "Design System Review",
 *       "meetingDate": 1714062600000
 *     }
 *   ]
 * }
 * ```
 */
export const getUserInsights = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  returns: v.array(AIInsightV.listItem),
  handler: async (ctx, { limit = 20, offset = 0 }) => {
    const identity = await requireIdentity(ctx);

    // Get user's insights
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .order("desc")
      .take(limit + offset);

    // Skip offset and take limit
    const paginatedInsights = insights.slice(offset, offset + limit);

    // Enrich with meeting information
    const enrichedInsights = [];
    for (const insight of paginatedInsights) {
      const meeting = await ctx.db.get(insight.meetingId);
      if (meeting) {
        enrichedInsights.push({
          _id: insight._id,
          _creationTime: insight._creationTime,
          meetingId: insight.meetingId,
          summary: insight.summary,
          actionItems: insight.actionItems,
          recommendations: insight.recommendations,
          createdAt: insight.createdAt,
          meetingTitle: meeting.title,
          meetingDate: meeting.scheduledAt || meeting.createdAt,
        });
      }
    }

    return enrichedInsights;
  },
});

/**
 * @summary Gets a specific insight by ID with ownership verification.
 * @description Retrieves detailed insight information including all recommendations, action items, and links. Enforces ownership verification to ensure users can only access their own insights. Returns null if the insight doesn't exist. Enriched with meeting metadata including title and date for context.
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
 *   "value": {
 *     "_id": "insights_ck9hx2g1v0001",
 *     "_creationTime": 1714066800000,
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *     "summary": "This 45-minute meeting involved 2 participants and covered topics including ai-ml, product-strategy, user-research. Key points were documented in the shared notes.",
 *     "actionItems": [
 *       "Follow up on the AI model training pipeline discussion",
 *       "Share the user research findings document",
 *       "Schedule next sprint planning session"
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
 *     "createdAt": 1714066800000,
 *     "meetingTitle": "Product Strategy Sync",
 *     "meetingDate": 1714066200000
 *   }
 * }
 * ```
 * @example response-not-found
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
export const getInsightById = query({
  args: {
    insightId: v.id("insights"),
  },
  returns: v.union(AIInsightV.withMeeting, v.null()),
  handler: async (ctx, { insightId }) => {
    const identity = await requireIdentity(ctx);

    const insight = await ctx.db.get(insightId);
    if (!insight) {
      return null;
    }

    // Verify ownership
    await assertOwnershipOrAdmin(ctx, insight.userId);

    // Get meeting information
    const meeting = await ctx.db.get(insight.meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", insight.meetingId);
    }

    return {
      _id: insight._id,
      _creationTime: insight._creationTime,
      meetingId: insight.meetingId,
      summary: insight.summary,
      actionItems: insight.actionItems,
      recommendations: insight.recommendations,
      links: insight.links,
      createdAt: insight.createdAt,
      meetingTitle: meeting.title,
      meetingDate: meeting.scheduledAt || meeting.createdAt,
    };
  },
});

/**
 * @summary Gets connection and follow-up recommendations from user's insights.
 * @description Extracts connection-type and follow-up recommendations from the user's recent insights across all meetings. Results are sorted by confidence score and creation time, providing the most relevant networking opportunities. Enriched with meeting context to help users understand where each recommendation originated. Useful for building a networking action list.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "limit": 5
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
 *     {
 *       "type": "connection",
 *       "content": "Consider connecting with other participants to continue the conversation",
 *       "confidence": 0.8,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "meetingTitle": "Product Strategy Sync",
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "type": "follow-up",
 *       "content": "Schedule a follow-up meeting to track progress on action items",
 *       "confidence": 0.75,
 *       "meetingId": "me_xyz789",
 *       "meetingTitle": "Design System Review",
 *       "createdAt": 1714063200000
 *     },
 *     {
 *       "type": "connection",
 *       "content": "Reach out to discuss shared interests in ai-ml and product-strategy",
 *       "confidence": 0.7,
 *       "meetingId": "me_abc456",
 *       "meetingTitle": "Tech Innovation Discussion",
 *       "createdAt": 1714059600000
 *     }
 *   ]
 * }
 * ```
 */
export const getConnectionRecommendations = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(ConnectionRecommendationV),
  handler: async (ctx, { limit = 10 }) => {
    const identity = await requireIdentity(ctx);

    // Get user's insights
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .order("desc")
      .take(50); // Look at recent insights

    const recommendations = [];

    for (const insight of insights) {
      // Filter for connection-type recommendations
      const connectionRecs = insight.recommendations.filter(
        (rec) => rec.type === "connection" || rec.type === "follow-up",
      );

      if (connectionRecs.length > 0) {
        const meeting = await ctx.db.get(insight.meetingId);
        if (meeting) {
          for (const rec of connectionRecs) {
            recommendations.push({
              type: rec.type,
              content: rec.content,
              confidence: rec.confidence,
              meetingId: insight.meetingId,
              meetingTitle: meeting.title,
              createdAt: insight.createdAt,
            });
          }
        }
      }

      if (recommendations.length >= limit) {
        break;
      }
    }

    // Sort by confidence and creation time
    return recommendations
      .sort((a, b) => {
        if (a.confidence !== b.confidence) {
          return b.confidence - a.confidence;
        }
        return b.createdAt - a.createdAt;
      })
      .slice(0, limit);
  },
});
