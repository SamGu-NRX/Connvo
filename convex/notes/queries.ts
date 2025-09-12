/**
 * Real-Time Collaborative Notes Queries
 *
 * This module provides reactive queries for live notes synchronization with
 * cursor-based pagination and conflict resolution support.
 *
 * Requirements: 8.1, 8.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";
import { operationValidator } from "./operations";

/**
 * Subscribes to real-time meeting notes with version tracking
 */
export const subscribeMeetingNotes = query({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    content: v.string(),
    version: v.number(),
    lastUpdated: v.number(),
    lastRebasedAt: v.number(),
    exists: v.boolean(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!notes) {
      return {
        content: "",
        version: 0,
        lastUpdated: 0,
        lastRebasedAt: 0,
        exists: false,
      };
    }

    return {
      content: notes.content,
      version: notes.version,
      lastUpdated: notes.updatedAt,
      lastRebasedAt: notes.lastRebasedAt,
      exists: true,
    };
  },
});

/**
 * Gets note opers stream for synchronization
 */
export const subscribeNoteOperations = query({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    operations: v.array(
      v.object({
        _id: v.id("noteOps"),
        sequence: v.number(),
        authorId: v.id("users"),
        operation: operationValidator,
        timestamp: v.number(),
        applied: v.boolean(),
      }),
    ),
    nextCursor: v.number(),
    hasMore: v.boolean(),
    totalOperations: v.number(),
  }),
  handler: async (ctx, { meetingId, fromSequence = 0, limit = 100 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Get operations from the specified sequence
    const operations = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId).gt("sequence", fromSequence),
      )
      .order("asc")
      .take(Math.min(limit, 200)); // Cap at 200 for performance

    // Get total count for pagination info
    const totalOps = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .collect();

    const nextCursor =
      operations.length > 0
        ? operations[operations.length - 1].sequence
        : fromSequence;

    const hasMore = operations.length === limit;

    return {
      operations: operations.map((op) => ({
        _id: op._id,
        sequence: op.sequence,
        authorId: op.authorId,
        operation: {
          type: op.operation.type,
          position: op.operation.position,
          content: op.operation.content,
          length: op.operation.length,
        },
        timestamp: op.timestamp,
        applied: op.applied,
      })),
      nextCursor,
      hasMore,
      totalOperations: totalOps.length,
    };
  },
});

/**
 * Gets recent note operations for conflict detection
 */
export const getRecentNoteOperations = query({
  args: {
    meetingId: v.id("meetings"),
    sinceTimestamp: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("noteOps"),
      sequence: v.number(),
      authorId: v.id("users"),
      operation: operationValidator,
      timestamp: v.number(),
      applied: v.boolean(),
    }),
  ),
  handler: async (ctx, { meetingId, sinceTimestamp, limit = 50 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const operations = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_timestamp", (q) =>
        q.eq("meetingId", meetingId).gte("timestamp", sinceTimestamp),
      )
      .order("asc")
      .take(Math.min(limit, 100));

    return operations.map((op) => ({
      _id: op._id,
      sequence: op.sequence,
      authorId: op.authorId,
      operation: {
        type: op.operation.type,
        position: op.operation.position,
        content: op.operation.content,
        length: op.operation.length,
      },
      timestamp: op.timestamp,
      applied: op.applied,
    }));
  },
});

/**
 * Gets note operations by author for debugging and analytics
 */
export const getNoteOperationsByAuthor = query({
  args: {
    meetingId: v.id("meetings"),
    authorId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("noteOps"),
      sequence: v.number(),
      operation: operationValidator,
      timestamp: v.number(),
      applied: v.boolean(),
    }),
  ),
  handler: async (ctx, { meetingId, authorId, limit = 100 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const operations = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .filter((q) => q.eq(q.field("authorId"), authorId))
      .order("desc")
      .take(Math.min(limit, 200));

    return operations.map((op) => ({
      _id: op._id,
      sequence: op.sequence,
      operation: {
        type: op.operation.type,
        position: op.operation.position,
        content: op.operation.content,
        length: op.operation.length,
      },
      timestamp: op.timestamp,
      applied: op.applied,
    }));
  },
});

/**
 * Gets notes collaboration statistics
 */
export const getNotesCollaborationStats = query({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    totalOperations: v.number(),
    totalAuthors: v.number(),
    contentLength: v.number(),
    version: v.number(),
    lastActivity: v.optional(v.number()),
    authorStats: v.array(
      v.object({
        authorId: v.id("users"),
        operationCount: v.number(),
        lastActivity: v.number(),
        operationTypes: v.object({
          insert: v.number(),
          delete: v.number(),
          retain: v.number(),
        }),
      }),
    ),
    recentActivity: v.object({
      operationsLastHour: v.number(),
      operationsLastMinute: v.number(),
      activeAuthorsLastHour: v.number(),
    }),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Get meeting notes
    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    // Get all operations
    const operations = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .collect();

    if (operations.length === 0) {
      return {
        totalOperations: 0,
        totalAuthors: 0,
        contentLength: notes?.content.length || 0,
        version: notes?.version || 0,
        lastActivity: undefined,
        authorStats: [],
        recentActivity: {
          operationsLastHour: 0,
          operationsLastMinute: 0,
          activeAuthorsLastHour: 0,
        },
      };
    }

    // Calculate author statistics
    const authorMap = new Map<
      string,
      {
        operationCount: number;
        lastActivity: number;
        operationTypes: { insert: number; delete: number; retain: number };
      }
    >();

    const oneHourAgo = Date.now() - 3600000;
    const oneMinuteAgo = Date.now() - 60000;
    let operationsLastHour = 0;
    let operationsLastMinute = 0;
    const activeAuthorsLastHour = new Set<string>();

    for (const op of operations) {
      // Update author stats
      if (!authorMap.has(op.authorId)) {
        authorMap.set(op.authorId, {
          operationCount: 0,
          lastActivity: 0,
          operationTypes: { insert: 0, delete: 0, retain: 0 },
        });
      }

      const authorStats = authorMap.get(op.authorId)!;
      authorStats.operationCount++;
      authorStats.lastActivity = Math.max(
        authorStats.lastActivity,
        op.timestamp,
      );

      const opType = op.operation.type as "insert" | "delete" | "retain";
      authorStats.operationTypes[opType]++;

      // Recent activity tracking
      if (op.timestamp > oneHourAgo) {
        operationsLastHour++;
        activeAuthorsLastHour.add(op.authorId);
      }
      if (op.timestamp > oneMinuteAgo) {
        operationsLastMinute++;
      }
    }

    const authorStats = Array.from(authorMap.entries()).map(
      ([authorId, stats]) => ({
        authorId: authorId as any, // Type assertion for Id<"users">
        operationCount: stats.operationCount,
        lastActivity: stats.lastActivity,
        operationTypes: stats.operationTypes,
      }),
    );

    const lastActivity = Math.max(...operations.map((op) => op.timestamp));

    return {
      totalOperations: operations.length,
      totalAuthors: authorMap.size,
      contentLength: notes?.content.length || 0,
      version: notes?.version || 0,
      lastActivity,
      authorStats,
      recentActivity: {
        operationsLastHour,
        operationsLastMinute,
        activeAuthorsLastHour: activeAuthorsLastHour.size,
      },
    };
  },
});

/**
 * Gets notes synchronization status for a client
 */
export const getNotesSyncStatus = query({
  args: {
    meetingId: v.id("meetings"),
    clientSequence: v.number(),
    clientVersion: v.number(),
  },
  returns: v.object({
    inSync: v.boolean(),
    serverSequence: v.number(),
    serverVersion: v.number(),
    missedOperations: v.number(),
    needsRebase: v.boolean(),
    syncRecommendation: v.union(
      v.literal("up_to_date"),
      v.literal("apply_operations"),
      v.literal("full_resync"),
      v.literal("rebase_required"),
    ),
  }),
  handler: async (ctx, { meetingId, clientSequence, clientVersion }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Get current server state
    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    const lastOp = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .order("desc")
      .first();

    const serverSequence = lastOp?.sequence || 0;
    const serverVersion = notes?.version || 0;

    // Calculate sync status
    const missedOperations = Math.max(0, serverSequence - clientSequence);
    const versionDiff = serverVersion - clientVersion;

    let inSync = false;
    let needsRebase = false;
    let syncRecommendation:
      | "up_to_date"
      | "apply_operations"
      | "full_resync"
      | "rebase_required";

    if (clientSequence === serverSequence && clientVersion === serverVersion) {
      inSync = true;
      syncRecommendation = "up_to_date";
    } else if (missedOperations <= 100 && versionDiff <= 10) {
      // Small number of missed operations, can catch up incrementally
      syncRecommendation = "apply_operations";
    } else if (versionDiff > 50 || missedOperations > 500) {
      // Large version difference, recommend full resync
      syncRecommendation = "full_resync";
    } else {
      // Medium difference, may need rebase
      needsRebase = true;
      syncRecommendation = "rebase_required";
    }

    return {
      inSync,
      serverSequence,
      serverVersion,
      missedOperations,
      needsRebase,
      syncRecommendation,
    };
  },
});

/**
 * Gets notes conflict resolution history
 */
export const getNotesConflictHistory = query({
  args: {
    meetingId: v.id("meetings"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      timestamp: v.number(),
      operationId: v.string(),
      authorId: v.id("users"),
      conflictType: v.string(),
      resolution: v.string(),
      metadata: v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean()),
      ),
    }),
  ),
  handler: async (ctx, { meetingId, limit = 50 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Get audit logs for conflict resolution
    const conflictLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "meetingNotes").eq("resourceId", meetingId),
      )
      .filter((q) => q.eq(q.field("action"), "resolve_conflict"))
      .order("desc")
      .take(Math.min(limit, 100));

    return conflictLogs.map((log) => ({
      timestamp: log.timestamp,
      operationId: String(log.metadata?.operationId ?? "unknown"),
      authorId: log.actorUserId!,
      conflictType: String(log.metadata?.conflictType ?? "unknown"),
      resolution: String(log.metadata?.resolution ?? "transformed"),
      metadata: (log.metadata ?? {}) as Record<string, string | number | boolean>,
    }));
  },
});

/**
 * Gets notes performance metrics
 */
export const getNotesPerformanceMetrics = query({
  args: {
    meetingId: v.id("meetings"),
    timeRangeMs: v.optional(v.number()),
  },
  returns: v.object({
    averageOperationLatency: v.number(),
    operationsPerSecond: v.number(),
    conflictRate: v.number(),
    transformationRate: v.number(),
    performanceGrade: v.union(
      v.literal("excellent"),
      v.literal("good"),
      v.literal("fair"),
      v.literal("poor"),
    ),
  }),
  handler: async (ctx, { meetingId, timeRangeMs = 3600000 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const since = Date.now() - timeRangeMs;

    // Get recent operations
    const recentOps = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_timestamp", (q) =>
        q.eq("meetingId", meetingId).gte("timestamp", since),
      )
      .collect();

    if (recentOps.length === 0) {
      return {
        averageOperationLatency: 0,
        operationsPerSecond: 0,
        conflictRate: 0,
        transformationRate: 0,
        performanceGrade: "fair" as const,
      };
    }

    // Calculate metrics
    const timeSpanSeconds = timeRangeMs / 1000;
    const operationsPerSecond = recentOps.length / timeSpanSeconds;

    // Get conflict logs
    const conflictLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", "meetingNotes").eq("resourceId", meetingId),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("action"), "apply_operation"),
          q.gte(q.field("timestamp"), since),
        ),
      )
      .collect();

    const conflictsCount = conflictLogs.filter((log) => {
      const n = Number((log.metadata as any)?.conflicts ?? 0);
      return n > 0;
    }).length;

    const conflictRate =
      recentOps.length > 0 ? conflictsCount / recentOps.length : 0;
    const transformationRate = conflictRate; // Simplified - conflicts require transformations

    // Estimate latency (simplified)
    const averageOperationLatency =
      operationsPerSecond > 0 ? 1000 / operationsPerSecond : 0;

    // Calculate performance grade
    let performanceGrade: "excellent" | "good" | "fair" | "poor";
    if (operationsPerSecond >= 10 && conflictRate < 0.1) {
      performanceGrade = "excellent";
    } else if (operationsPerSecond >= 5 && conflictRate < 0.2) {
      performanceGrade = "good";
    } else if (operationsPerSecond >= 1 && conflictRate < 0.5) {
      performanceGrade = "fair";
    } else {
      performanceGrade = "poor";
    }

    return {
      averageOperationLatency,
      operationsPerSecond,
      conflictRate,
      transformationRate,
      performanceGrade,
    };
  },
});
