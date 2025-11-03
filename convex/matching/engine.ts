/**
 * Intelligent Matching Engine
 *
 * Implements scalable match processing with shard-based processing,
 * optimistic concurrency control, and comprehensive analytics.
 *
 * Requirements: 12.3, 12.5 - Scalable Match Processing with Analytics
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v, ConvexError } from "convex/values";
import type { Infer } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "@convex/_generated/server";
import { Id } from "@convex/_generated/dataModel";
import { internal } from "@convex/_generated/api";
import { MatchResultV, constraintsV } from "@convex/types/validators/matching";
import type { CompatibilityFeatures } from "@convex/types/entities/matching";

/**
 * @summary Run matching cycle with shard-based processing for scalability
 * @description Executes a complete matching cycle by processing queue entries in parallel shards.
 * First cleans up expired entries, then processes each shard to find compatible matches. Aggregates
 * results and logs performance metrics. Returns statistics about matches created and processing time.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "shardCount": 4,
 *     "minScore": 0.6,
 *     "maxMatches": 50
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "processedShards": 4,
 *     "totalMatches": 23,
 *     "averageScore": 0.78,
 *     "processingTimeMs": 1250
 *   }
 * }
 * ```
 */
export const runMatchingCycle = action({
  args: {
    shardCount: v.optional(v.number()),
    minScore: v.optional(v.number()),
    maxMatches: v.optional(v.number()),
  },
  returns: v.object({
    processedShards: v.number(),
    totalMatches: v.number(),
    averageScore: v.number(),
    processingTimeMs: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    processedShards: number;
    totalMatches: number;
    averageScore: number;
    processingTimeMs: number;
  }> => {
    const startTime = Date.now();
    const shardCount = args.shardCount ?? 4;
    const minScore = args.minScore ?? 0.6;
    const maxMatches = args.maxMatches ?? 50;

    // Clean up expired entries first
    await ctx.runMutation(internal.matching.queue.cleanupExpiredEntries, {});

    // Process each shard in parallel
    const shardPromises: Array<Promise<ShardProcessResult>> = [];
    for (let shard = 0; shard < shardCount; shard++) {
      shardPromises.push(
        ctx.runAction(internal.matching.engine.processMatchingShard, {
          shard,
          shardCount,
          minScore,
          maxMatchesPerShard: Math.ceil(maxMatches / shardCount),
        }),
      );
    }

    const shardResults: ShardProcessResult[] = await Promise.all(shardPromises);

    // Aggregate results
    const totalMatches = shardResults.reduce(
      (sum, result) => sum + result.matchCount,
      0,
    );
    const totalScore = shardResults.reduce(
      (sum, result) => sum + result.totalScore,
      0,
    );
    const averageScore = totalMatches > 0 ? totalScore / totalMatches : 0;

    const processingTimeMs = Date.now() - startTime;

    // Log matching cycle metrics
    const _logged: null = await ctx.runMutation(
      internal.matching.engine.logMatchingMetrics,
      {
        shardCount,
        totalMatches,
        averageScore,
        processingTimeMs,
        minScore,
      },
    );

    return {
      processedShards: shardCount,
      totalMatches,
      averageScore,
      processingTimeMs,
    };
  },
});

/**
 * @summary Process matching for a specific shard
 * @description Processes queue entries assigned to a specific shard by calculating compatibility
 * scores between users and creating matches for pairs that exceed the minimum score threshold.
 * Uses optimistic concurrency control to handle race conditions. Returns match count and total score.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "shard": 0,
 *     "shardCount": 4,
 *     "minScore": 0.6,
 *     "maxMatchesPerShard": 12
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "matchCount": 8,
 *     "totalScore": 6.24
 *   }
 * }
 * ```
 */
export const processMatchingShard = internalAction({
  args: {
    shard: v.number(),
    shardCount: v.number(),
    minScore: v.number(),
    maxMatchesPerShard: v.number(),
  },
  returns: v.object({
    matchCount: v.number(),
    totalScore: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get queue entries for this shard
    const queueEntries: ShardQueueEntry[] = await ctx.runQuery(
      internal.matching.engine.getShardQueueEntries,
      {
        shard: args.shard,
        shardCount: args.shardCount,
        limit: args.maxMatchesPerShard * 2, // Get more entries to find good matches
      },
    );

    if (queueEntries.length < 2) {
      return { matchCount: 0, totalScore: 0 };
    }

    let matchCount = 0;
    let totalScore = 0;
    const processedUsers = new Set<string>();

    // Try to match users in this shard
    for (
      let i = 0;
      i < queueEntries.length && matchCount < args.maxMatchesPerShard;
      i++
    ) {
      const user1Entry = queueEntries[i];

      if (processedUsers.has(user1Entry.userId)) continue;

      let bestMatch: any = null;
      let bestScore = args.minScore;

      // Find best match for this user
      for (let j = i + 1; j < queueEntries.length; j++) {
        const user2Entry = queueEntries[j];

        if (processedUsers.has(user2Entry.userId)) continue;

        // Check if users are available at overlapping times
        if (!hasTimeOverlap(user1Entry, user2Entry)) continue;

        // Calculate compatibility score
        const scoreResult = await ctx.runAction(
          internal.matching.scoring.calculateCompatibilityScoreInternal,
          {
            user1Id: user1Entry.userId,
            user2Id: user2Entry.userId,
            user1Constraints: user1Entry.constraints,
            user2Constraints: user2Entry.constraints,
          },
        );

        if (scoreResult.score > bestScore) {
          bestMatch = {
            user2Entry,
            scoreResult,
          };
          bestScore = scoreResult.score;
        }
      }

      // Create match if we found a good one
      if (bestMatch) {
        const matchId = generateMatchId(
          user1Entry.userId,
          bestMatch.user2Entry.userId,
        );

        // Use optimistic concurrency to create the match
        const matchCreated: boolean = await ctx.runMutation(
          internal.matching.engine.createMatch,
          {
            user1QueueId: user1Entry._id,
            user2QueueId: bestMatch.user2Entry._id,
            matchResult: {
              user1Id: user1Entry.userId,
              user2Id: bestMatch.user2Entry.userId,
              score: bestMatch.scoreResult.score,
              features: bestMatch.scoreResult.features,
              explanation: bestMatch.scoreResult.explanation,
              matchId,
            },
          },
        );

        if (matchCreated) {
          processedUsers.add(user1Entry.userId);
          processedUsers.add(bestMatch.user2Entry.userId);
          matchCount++;
          totalScore += bestMatch.scoreResult.score;
        }
      }
    }

    return { matchCount, totalScore };
  },
});

/**
 * @summary Get queue entries for a specific shard
 * @description Retrieves waiting queue entries assigned to a specific shard based on user ID hash.
 * Filters entries that are currently available or will be available within 1 hour. Sorts by
 * creation time (FIFO) and limits results. Used internally by shard-based matching processing.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "shard": 0,
 *     "shardCount": 4,
 *     "limit": 50
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
 *       "userId": "jd7user123",
 *       "availableFrom": 1704067200000,
 *       "availableTo": 1704070800000,
 *       "constraints": {
 *         "interests": ["technology", "ai"],
 *         "roles": ["mentor"]
 *       },
 *       "createdAt": 1704067100000
 *     }
 *   ]
 * }
 * ```
 */
export const getShardQueueEntries = internalQuery({
  args: {
    shard: v.number(),
    shardCount: v.number(),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("matchingQueue"),
      userId: v.id("users"),
      availableFrom: v.number(),
      availableTo: v.number(),
      constraints: constraintsV,
      createdAt: v.number(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"matchingQueue">;
      userId: Id<"users">;
      availableFrom: number;
      availableTo: number;
      constraints: Infer<typeof constraintsV>;
      createdAt: number;
    }>
  > => {
    const now = Date.now();

    // Get all waiting entries
    const allEntries = await ctx.db
      .query("matchingQueue")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .filter((q) =>
        q.and(
          q.lte(q.field("availableFrom"), now + 3600000), // Available within 1 hour
          q.gt(q.field("availableTo"), now), // Not expired
        ),
      )
      .collect();

    // Shard entries based on user ID hash
    const shardEntries = allEntries.filter((entry) => {
      const userIdHash = hashUserId(entry.userId);
      return userIdHash % args.shardCount === args.shard;
    });

    // Sort by creation time (FIFO) and limit
    return shardEntries
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, args.limit);
  },
});

/**
 * @summary Create a match with optimistic concurrency control
 * @description Creates a match between two users by atomically updating both queue entries to
 * 'matched' status. Uses optimistic concurrency control to handle race conditions where entries
 * may have been matched by another shard. Records match analytics and creates audit log entries.
 * Returns true if match was created successfully, false if race condition occurred.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "user1QueueId": "jd7abc123def456",
 *     "user2QueueId": "jd7xyz789ghi012",
 *     "matchResult": {
 *       "user1Id": "jd7user123",
 *       "user2Id": "jd7user456",
 *       "score": 0.82,
 *       "features": {
 *         "interestOverlap": 0.85,
 *         "experienceGap": 1.0,
 *         "industryMatch": 0.7,
 *         "timezoneCompatibility": 1.0,
 *         "vectorSimilarity": 0.88,
 *         "orgConstraintMatch": 1.0,
 *         "languageOverlap": 0.9,
 *         "roleComplementarity": 1.0
 *       },
 *       "explanation": ["Strong interest alignment", "Ideal experience gap for mentorship"],
 *       "matchId": "match_jd7user123_jd7user456_1704067200000"
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": true
 * }
 * ```
 *
 * @example response-race-condition
 * ```json
 * {
 *   "status": "success",
 *   "value": false
 * }
 * ```
 */
export const createMatch = internalMutation({
  args: {
    user1QueueId: v.id("matchingQueue"),
    user2QueueId: v.id("matchingQueue"),
    matchResult: MatchResultV.basic,
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    // Check if both queue entries are still available
    const [entry1, entry2] = await Promise.all([
      ctx.db.get(args.user1QueueId),
      ctx.db.get(args.user2QueueId),
    ]);

    if (
      !entry1 ||
      !entry2 ||
      entry1.status !== "waiting" ||
      entry2.status !== "waiting"
    ) {
      return false; // Race condition - entries no longer available
    }

    const now = Date.now();

    try {
      // Update both queue entries atomically
      await Promise.all([
        ctx.db.patch(args.user1QueueId, {
          status: "matched",
          matchedWith: args.matchResult.user2Id,
          updatedAt: now,
        }),
        ctx.db.patch(args.user2QueueId, {
          status: "matched",
          matchedWith: args.matchResult.user1Id,
          updatedAt: now,
        }),
      ]);

      // Record match analytics for both users
      await Promise.all([
        ctx.db.insert("matchingAnalytics", {
          userId: args.matchResult.user1Id,
          matchId: args.matchResult.matchId,
          outcome: "accepted", // Will be updated when users respond
          features: args.matchResult.features,
          weights: {}, // Will be populated with current weights
          createdAt: now,
        }),
        ctx.db.insert("matchingAnalytics", {
          userId: args.matchResult.user2Id,
          matchId: args.matchResult.matchId,
          outcome: "accepted", // Will be updated when users respond
          features: args.matchResult.features,
          weights: {}, // Will be populated with current weights
          createdAt: now,
        }),
      ]);

      // Log audit events
      await Promise.all([
        ctx.db.insert("auditLogs", {
          actorUserId: args.matchResult.user1Id,
          resourceType: "match",
          resourceId: args.matchResult.matchId,
          action: "match_created",
          metadata: {
            matchedWith: args.matchResult.user2Id,
            score: args.matchResult.score,
            featuresJson: JSON.stringify(args.matchResult.features),
          },
          timestamp: now,
        }),
        ctx.db.insert("auditLogs", {
          actorUserId: args.matchResult.user2Id,
          resourceType: "match",
          resourceId: args.matchResult.matchId,
          action: "match_created",
          metadata: {
            matchedWith: args.matchResult.user1Id,
            score: args.matchResult.score,
            featuresJson: JSON.stringify(args.matchResult.features),
          },
          timestamp: now,
        }),
      ]);

      return true;
    } catch (error) {
      // Handle race conditions gracefully
      console.error("Failed to create match:", error);
      return false;
    }
  },
});

/**
 * @summary Log matching cycle metrics
 * @description Records performance metrics for a matching cycle including processing time,
 * number of matches created, and average match score. Stores metrics in the performanceMetrics
 * table for monitoring and analytics. Used internally after each matching cycle completes.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "shardCount": 4,
 *     "totalMatches": 23,
 *     "averageScore": 0.78,
 *     "processingTimeMs": 1250,
 *     "minScore": 0.6
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
 */
export const logMatchingMetrics = internalMutation({
  args: {
    shardCount: v.number(),
    totalMatches: v.number(),
    averageScore: v.number(),
    processingTimeMs: v.number(),
    minScore: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Log performance metrics
    await Promise.all([
      ctx.db.insert("performanceMetrics", {
        name: "matching_cycle_duration",
        value: args.processingTimeMs,
        unit: "milliseconds",
        labels: {
          shardCount: args.shardCount.toString(),
          minScore: args.minScore.toString(),
        },
        timestamp: now,
        createdAt: now,
      }),
      ctx.db.insert("performanceMetrics", {
        name: "matches_created",
        value: args.totalMatches,
        unit: "count",
        labels: {
          shardCount: args.shardCount.toString(),
        },
        timestamp: now,
        createdAt: now,
      }),
      ctx.db.insert("performanceMetrics", {
        name: "average_match_score",
        value: args.averageScore,
        unit: "score",
        labels: {},
        timestamp: now,
        createdAt: now,
      }),
    ]);

    return null;
  },
});

/**
 * @summary Update match outcome based on user feedback
 * @description Updates the outcome and optional feedback for a match in the analytics record.
 * Used to track whether matches were accepted, declined, or completed. Creates an audit log
 * entry for the outcome update. Used internally by the feedback system.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "matchId": "match_jd7user123_jd7user456_1704067200000",
 *     "userId": "jd7user123",
 *     "outcome": "completed",
 *     "feedback": {
 *       "rating": 5,
 *       "comments": "Great conversation, very insightful!"
 *     }
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
 *     "message": "Match analytics record not found"
 *   }
 * }
 * ```
 */
export const updateMatchOutcome = internalMutation({
  args: {
    matchId: v.string(),
    userId: v.id("users"),
    outcome: v.union(
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("completed"),
    ),
    feedback: v.optional(
      v.object({
        rating: v.number(),
        comments: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find the analytics record for this user and match
    const analyticsRecord = await ctx.db
      .query("matchingAnalytics")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .unique();

    if (!analyticsRecord) {
      throw new ConvexError("Match analytics record not found");
    }

    // Update the outcome and feedback
    await ctx.db.patch(analyticsRecord._id, {
      outcome: args.outcome,
      feedback: args.feedback,
    });

    // Log audit event
    await ctx.db.insert("auditLogs", {
      actorUserId: args.userId,
      resourceType: "match",
      resourceId: args.matchId,
      action: "outcome_updated",
      metadata: {
        outcome: args.outcome,
        feedbackJson: JSON.stringify(args.feedback ?? null),
      },
      timestamp: Date.now(),
    });

    return null;
  },
});

/**
 * Local helper types to break deep type inference
 */
type ShardProcessResult = { matchCount: number; totalScore: number };
type ShardQueueEntry = {
  _id: Id<"matchingQueue">;
  userId: Id<"users">;
  availableFrom: number;
  availableTo: number;
  constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
  };
  createdAt: number;
};

function hasTimeOverlap(
  entry1: ShardQueueEntry,
  entry2: ShardQueueEntry,
): boolean {
  return (
    entry1.availableFrom < entry2.availableTo &&
    entry2.availableFrom < entry1.availableTo
  );
}

function hashUserId(userId: Id<"users">): number {
  // Simple hash function for sharding
  let hash = 0;
  const str = userId.toString();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function generateMatchId(user1Id: Id<"users">, user2Id: Id<"users">): string {
  // Create deterministic match ID
  const ids = [user1Id.toString(), user2Id.toString()].sort();
  const timestamp = Date.now();
  return `match_${ids[0]}_${ids[1]}_${timestamp}`;
}
