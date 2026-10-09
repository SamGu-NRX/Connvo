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
 * Adds the authenticated user to the matching queue
 *
 * Validates that the availability window starts no earlier than the current server time and
 * that the end time is strictly after the start time, then rejects the request if the user
 * already has a queue entry with status "waiting" (deduplication, not rate limiting — at most
 * one waiting entry per user). Requires at least one interest and one role in the constraints.
 * On success it inserts a `matchingQueue` document with status "waiting", writes a
 * `queue_entered` audit log, and returns the new entry's id. Throws `ConvexError` on validation
 * failure and an unauthorized error from `requireIdentity` when the caller has no identity.
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
 * Removes the authenticated user's queue entry from the matching queue by cancelling it
 *
 * With `queueId`, loads that entry and throws "Queue entry not found or access denied" unless it
 * exists and belongs to the caller; the entry's status is not checked, so an explicit `queueId`
 * can also cancel entries that are already matched, expired, or cancelled. Without `queueId`,
 * it patches the caller's waiting entry (at most one exists per user) and throws "No active
 * queue entry found" when there is none. Writes a `queue_cancelled` audit log and returns null.
 * Requires authentication via `requireIdentity`.
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
 * Gets the authenticated user's most recent queue entry with computed wait metadata
 *
 * Returns the caller's newest queue entry whose status is not "cancelled", or null when there is
 * none — "matched" and "expired" entries are returned too, not just waiting ones. For waiting
 * entries it computes `queuePosition` (1-based FIFO position: the count of waiting entries with
 * an earlier `createdAt`, across the whole queue with no constraint filtering, plus one) and
 * `estimatedWaitTime` (two minutes per position via `Math.max(60000, queuePosition * 120000)` —
 * the one-minute floor is unreachable because position is always at least 1). Non-waiting
 * entries come back without those fields, and `potentialMatches` is declared by the return
 * validator but never computed. Requires authentication via `requireIdentity`.
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
      // FIFO position: count of ALL waiting entries created earlier (no constraint filter)
      const usersAhead = await ctx.db
        .query("matchingQueue")
        .withIndex("by_status", (q) => q.eq("status", "waiting"))
        .filter((q) => q.lt(q.field("createdAt"), queueEntry.createdAt))
        .collect();

      queuePosition = usersAhead.length + 1;

      // Placeholder heuristic, not historical analytics: 2 minutes of expected wait per
      // position. The Math.max(60000, ...) floor is unreachable because position >= 1.
      estimatedWaitTime = Math.max(60000, queuePosition * 120000);
    }

    return {
      ...queueEntry,
      estimatedWaitTime,
      queuePosition,
    };
  },
});

/**
 * Lists waiting queue entries whose availability window overlaps the scan window
 *
 * Public query with no authentication or authorization check: any caller receives up to `limit`
 * (default 100) waiting entries — user ids, constraints, and availability windows included —
 * ordered oldest first (FIFO), where `availableFrom` is at most `timeWindow` (default 3600000
 * ms) in the future and `availableTo` is still ahead of now. Contrary to the intent recorded
 * here previously, nothing calls it: the matching engine reads the queue through its own
 * internal getShardQueueEntries query, so this surface is dead code that publicly exposes queue
 * data.
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
 * Updates a queue entry's status and optional match counterpart
 *
 * Public mutation with no authentication or authorization check: any caller can load any queue
 * entry by id, patch its `status` with no transition validation (any state can become any
 * state, including back to "waiting"), and overwrite `matchedWith`. It then stamps `updatedAt`,
 * writes a `status_updated` audit log recording `oldStatus`, `newStatus`, and `matchedWith`
 * (empty string when omitted), and returns null. Throws "Queue entry not found" when the id
 * does not resolve. Nothing in the repository calls it — the engine patches entries in its own
 * createMatch mutation — so it is dead public surface as well.
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
 * Finds waiting queue entries past their availability window and marks them expired
 *
 * Internal mutation reserved for cron and engine callers: it collects every entry with status
 * "waiting" whose `availableTo` is before the current time — no batch limit, so the sequential
 * patch-plus-audit-log loop grows with the number of stale entries — patches each to "expired"
 * with `updatedAt` set to now, writes one `queue_expired` audit log per entry, and returns
 * `{ expiredCount }`. Invoked hourly by the runQueueMaintenance cron in
 * convex/matching/scheduler.ts and at the start of every runMatchingCycle in
 * convex/matching/engine.ts.
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
