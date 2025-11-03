/**
 * Matching Queue Management
 *
 * Implements real-time matching queue with availability windows, constraints,
 * and priority ordering for the intelligent matching system.
 *
 * Requirements: 12.1 - Advanced Real-Time Matching Queue
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "@convex/_generated/server";
import { requireIdentity } from "@convex/auth/guards";
import { ConvexError } from "convex/values";
import { Id } from "@convex/_generated/dataModel";
import {
  MatchingQueueV,
  constraintsV,
} from "@convex/types/validators/matching";
import type { QueueStatus } from "@convex/types/entities/matching";

/**
 * @summary Enter the matching queue with availability window and constraints
 * @description Adds the authenticated user to the matching queue with specified availability
 * window and matching constraints. Validates that the user is not already in the queue and
 * that the availability window is valid. Creates an audit log entry for queue entry.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "availableFrom": 1704067200000,
 *     "availableTo": 1704070800000,
 *     "constraints": {
 *       "interests": ["technology", "ai", "startups"],
 *       "roles": ["mentor", "founder"],
 *       "orgConstraints": "different_org"
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": "jd7abc123def456"
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "CONVEX_ERROR",
 *     "message": "User is already in the matching queue"
 *   }
 * }
 * ```
 */
export const enterMatchingQueue = mutation({
  args: {
    availableFrom: v.number(),
    availableTo: v.number(),
    constraints: constraintsV,
  },
  returns: v.id("matchingQueue"),
  handler: async (ctx, args) => {
    const { userId } = await requireIdentity(ctx);

    // Validate availability window
    const now = Date.now();
    if (args.availableFrom < now) {
      throw new ConvexError("Availability window cannot start in the past");
    }
    if (args.availableTo <= args.availableFrom) {
      throw new ConvexError("Availability end time must be after start time");
    }

    // Check if user is already in queue
    const existingEntry = await ctx.db
      .query("matchingQueue")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "waiting"))
      .first();

    if (existingEntry) {
      throw new ConvexError("User is already in the matching queue");
    }

    // Validate constraints
    if (args.constraints.interests.length === 0) {
      throw new ConvexError("At least one interest must be specified");
    }
    if (args.constraints.roles.length === 0) {
      throw new ConvexError("At least one role must be specified");
    }

    // Create queue entry
    const queueId = await ctx.db.insert("matchingQueue", {
      userId,
      availableFrom: args.availableFrom,
      availableTo: args.availableTo,
      constraints: args.constraints,
      status: "waiting",
      createdAt: now,
      updatedAt: now,
    });

    // Log audit event
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      resourceType: "matchingQueue",
      resourceId: queueId,
      action: "queue_entered",
      metadata: {
        availableFrom: args.availableFrom,
        availableTo: args.availableTo,
        constraintCount:
          args.constraints.interests.length + args.constraints.roles.length,
      },
      timestamp: now,
    });

    return queueId;
  },
});

/**
 * @summary Cancel user's queue entry
 * @description Cancels the authenticated user's active queue entry by updating its status
 * to 'cancelled'. Can optionally specify a queue ID, or will find the user's active entry.
 * Creates an audit log entry for the cancellation.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "queueId": "jd7abc123def456"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "CONVEX_ERROR",
 *     "message": "No active queue entry found"
 *   }
 * }
 * ```
 */
export const cancelQueueEntry = mutation({
  args: {
    queueId: v.optional(v.id("matchingQueue")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireIdentity(ctx);

    let queueEntry;
    if (args.queueId) {
      queueEntry = await ctx.db.get(args.queueId);
      if (!queueEntry || queueEntry.userId !== userId) {
        throw new ConvexError("Queue entry not found or access denied");
      }
    } else {
      // Find user's active queue entry
      queueEntry = await ctx.db
        .query("matchingQueue")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("status"), "waiting"))
        .first();

      if (!queueEntry) {
        throw new ConvexError("No active queue entry found");
      }
    }

    // Update status to cancelled
    await ctx.db.patch(queueEntry._id, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    // Log audit event
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      resourceType: "matchingQueue",
      resourceId: queueEntry._id,
      action: "queue_cancelled",
      metadata: {},
      timestamp: Date.now(),
    });

    return null;
  },
});

/**
 * @summary Get current queue status for a user
 * @description Retrieves the authenticated user's current queue status including position,
 * estimated wait time, and availability window. Returns null if the user is not in the queue.
 * Calculates queue position based on users ahead with similar constraints.
 *
 * @example request
 * ```json
 * {
 *   "args": {}
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "jd7abc123def456",
 *     "_creationTime": 1704067100000,
 *     "userId": "jd7user123",
 *     "availableFrom": 1704067200000,
 *     "availableTo": 1704070800000,
 *     "constraints": {
 *       "interests": ["technology", "ai"],
 *       "roles": ["mentor"]
 *     },
 *     "status": "waiting",
 *     "createdAt": 1704067100000,
 *     "updatedAt": 1704067100000,
 *     "estimatedWaitTime": 240000,
 *     "queuePosition": 3
 *   }
 * }
 * ```
 *
 * @example response-null
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 */
export const getQueueStatus = query({
  args: {},
  returns: v.union(v.null(), MatchingQueueV.status),
  handler: async (ctx, args): Promise<QueueStatus | null> => {
    const { userId } = await requireIdentity(ctx);

    const queueEntry = await ctx.db
      .query("matchingQueue")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .order("desc")
      .first();

    if (!queueEntry) {
      return null;
    }

    let estimatedWaitTime: number | undefined;
    let queuePosition: number | undefined;

    if (queueEntry.status === "waiting") {
      // Calculate queue position (users ahead in queue with similar constraints)
      const usersAhead = await ctx.db
        .query("matchingQueue")
        .withIndex("by_status", (q) => q.eq("status", "waiting"))
        .filter((q) => q.lt(q.field("createdAt"), queueEntry.createdAt))
        .collect();

      queuePosition = usersAhead.length + 1;

      // Estimate wait time based on historical data (simplified)
      // In production, this would use more sophisticated analytics
      estimatedWaitTime = Math.max(60000, queuePosition * 120000); // 1-2 minutes per position
    }

    return {
      ...queueEntry,
      estimatedWaitTime,
      queuePosition,
    };
  },
});

/**
 * @summary Get active queue entries for matching processing
 * @description Retrieves waiting queue entries that are currently available or will be available
 * within the specified time window. Used internally by the matching engine to find candidates
 * for matching. Orders entries by creation time (FIFO) and limits results.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "limit": 50,
 *     "timeWindow": 3600000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": [
 *     {
 *       "_id": "jd7abc123def456",
 *       "_creationTime": 1704067100000,
 *       "userId": "jd7user123",
 *       "availableFrom": 1704067200000,
 *       "availableTo": 1704070800000,
 *       "constraints": {
 *         "interests": ["technology", "ai"],
 *         "roles": ["mentor"]
 *       },
 *       "status": "waiting",
 *       "createdAt": 1704067100000,
 *       "updatedAt": 1704067100000
 *     }
 *   ]
 * }
 * ```
 */
export const getActiveQueueEntries = query({
  args: {
    limit: v.optional(v.number()),
    timeWindow: v.optional(v.number()),
  },
  returns: v.array(MatchingQueueV.full),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"matchingQueue">;
      _creationTime: number;
      userId: Id<"users">;
      availableFrom: number;
      availableTo: number;
      constraints: {
        interests: string[];
        roles: string[];
        orgConstraints?: string;
      };
      status: "waiting" | "matched" | "expired" | "cancelled";
      matchedWith?: Id<"users">;
      createdAt: number;
      updatedAt: number;
    }>
  > => {
    const now = Date.now();
    const timeWindow = args.timeWindow ?? 3600000; // 1 hour default
    const limit = args.limit ?? 100;

    // Get waiting entries that are currently available or will be soon
    const entries = await ctx.db
      .query("matchingQueue")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .filter((q) =>
        q.and(
          q.lte(q.field("availableFrom"), now + timeWindow),
          q.gt(q.field("availableTo"), now),
        ),
      )
      .order("asc") // Prioritize older entries
      .take(limit);

    return entries;
  },
});

/**
 * @summary Update queue entry status
 * @description Updates the status of a queue entry and optionally records the matched user.
 * Used internally by the matching engine to mark entries as matched, expired, or cancelled.
 * Creates an audit log entry for the status change.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "queueId": "jd7abc123def456",
 *     "status": "matched",
 *     "matchedWith": "jd7user456"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "CONVEX_ERROR",
 *     "message": "Queue entry not found"
 *   }
 * }
 * ```
 */
export const updateQueueStatus = mutation({
  args: {
    queueId: v.id("matchingQueue"),
    status: v.union(
      v.literal("waiting"),
      v.literal("matched"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    matchedWith: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const queueEntry = await ctx.db.get(args.queueId);
    if (!queueEntry) {
      throw new ConvexError("Queue entry not found");
    }

    await ctx.db.patch(args.queueId, {
      status: args.status,
      matchedWith: args.matchedWith,
      updatedAt: Date.now(),
    });

    // Log status change
    await ctx.db.insert("auditLogs", {
      actorUserId: queueEntry.userId,
      resourceType: "matchingQueue",
      resourceId: args.queueId,
      action: "status_updated",
      metadata: {
        oldStatus: queueEntry.status,
        newStatus: args.status,
        matchedWith: args.matchedWith ? String(args.matchedWith) : "",
      },
      timestamp: Date.now(),
    });

    return null;
  },
});

/**
 * @summary Clean up expired queue entries
 * @description Finds all waiting queue entries whose availability window has passed and updates
 * their status to 'expired'. Creates audit log entries for each expired entry. Used internally
 * by the matching engine to maintain queue hygiene.
 *
 * @example request
 * ```json
 * {
 *   "args": {}
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "expiredCount": 12
 *   }
 * }
 * ```
 */
export const cleanupExpiredEntries = internalMutation({
  args: {},
  returns: v.object({
    expiredCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find expired entries
    const expiredEntries = await ctx.db
      .query("matchingQueue")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .filter((q) => q.lt(q.field("availableTo"), now))
      .collect();

    // Update them to expired status
    for (const entry of expiredEntries) {
      await ctx.db.patch(entry._id, {
        status: "expired",
        updatedAt: now,
      });

      // Log expiration
      await ctx.db.insert("auditLogs", {
        actorUserId: entry.userId,
        resourceType: "matchingQueue",
        resourceId: entry._id,
        action: "queue_expired",
        metadata: {
          availableTo: entry.availableTo,
          expiredAt: now,
        },
        timestamp: now,
      });
    }

    return {
      expiredCount: expiredEntries.length,
    };
  },
});
