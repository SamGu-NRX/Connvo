/**
 * Offline Support and Operation Management for Collaborative Notes
 *
 * This module handles client-side operation queuing, sync-on-reconnect,
 * and conflict-safe merging for offline scenarios.
 *
 * Requirements: 8.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import {
  mutation,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";
import { createError } from "../lib/errors";
import {
  Operation,
  OperationWithMetadata,
  operationValidator,
  operationWithMetadataValidator,
  transformAgainstOperations,
  applyOperations,
  normalizeOperations,
  validateOperation,
} from "./operations";

/**
 * Queued operation for offline scenarios
 */
export interface QueuedOperation extends OperationWithMetadata {
  clientId: string;
  queuedAt: number;
  attempts: number;
  lastAttempt?: number;
  error?: string;
  status: "pending" | "syncing" | "synced" | "failed";
}

/**
 * Validator for queued operations
 */
export const queuedOperationValidator = v.object({
  type: v.union(v.literal("insert"), v.literal("delete"), v.literal("retain")),
  position: v.number(),
  content: v.optional(v.string()),
  length: v.optional(v.number()),
  id: v.string(),
  authorId: v.string(),
  timestamp: v.number(),
  sequence: v.number(),
  transformedFrom: v.optional(v.array(v.string())),
  clientId: v.string(),
  queuedAt: v.number(),
  attempts: v.number(),
  lastAttempt: v.optional(v.number()),
  error: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("syncing"),
    v.literal("synced"),
    v.literal("failed"),
  ),
});

/**
 * Sync result for offline operations
 */
export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  conflicts: number;
  newVersion: number;
  errors: string[];
}

/**
 * Queues operations for offline sync
 */
export const queueOfflineOperations = mutation({
  args: {
    meetingId: v.id("meetings"),
    operations: v.array(queuedOperationValidator),
    clientId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    queued: v.number(),
    queueId: v.string(),
  }),
  handler: async (ctx, { meetingId, operations, clientId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Validate all operations
    for (const op of operations) {
      if (!validateOperation(op)) {
        throw createError.validation(`Invalid operation: ${op.id}`);
      }
    }

    const queueId = `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let queued = 0;

    // Store operations in offline queue
    for (const operation of operations) {
      await ctx.db.insert("offlineOperationQueue", {
        meetingId,
        clientId,
        queueId,
        operation: {
          type: operation.type,
          position: operation.position,
          content: operation.content,
          length: operation.length,
        },
        operationId: operation.id,
        authorId: participant.userId,
        clientSequence: operation.sequence,
        timestamp: operation.timestamp,
        queuedAt: Date.now(),
        attempts: 0,
        status: "pending",
      });
      queued++;
    }

    // Log queuing for audit
    await ctx.db.insert("auditLogs", {
      actorUserId: participant.userId,
      resourceType: "meetingNotes",
      resourceId: meetingId,
      action: "queue_offline_operations",
      metadata: {
        clientId,
        queueId,
        operationCount: queued,
      },
      timestamp: Date.now(),
    });

    return {
      success: true,
      queued,
      queueId,
    };
  },
});

/**
 * Syncs queued offline operations with conflict resolution
 */
export const syncOfflineOperations = mutation({
  args: {
    meetingId: v.id("meetings"),
    clientId: v.string(),
    queueId: v.optional(v.string()),
    maxOperations: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    synced: v.number(),
    failed: v.number(),
    conflicts: v.number(),
    newVersion: v.number(),
    errors: v.array(v.string()),
    remainingInQueue: v.number(),
  }),
  handler: async (
    ctx,
    { meetingId, clientId, queueId, maxOperations = 50 },
  ) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Get queued operations
    let queuedOps;
    if (queueId) {
      queuedOps = await ctx.db
        .query("offlineOperationQueue")
        .withIndex("by_queue_id", (q) => q.eq("queueId", queueId))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .order("asc")
        .take(maxOperations);
    } else {
      queuedOps = await ctx.db
        .query("offlineOperationQueue")
        .withIndex("by_meeting_and_client", (q) =>
          q.eq("meetingId", meetingId).eq("clientId", clientId),
        )
        .filter((q) => q.eq(q.field("status"), "pending"))
        .order("asc")
        .take(maxOperations);
    }

    if (queuedOps.length === 0) {
      return {
        success: true,
        synced: 0,
        failed: 0,
        conflicts: 0,
        newVersion: 0,
        errors: [],
        remainingInQueue: 0,
      };
    }

    // Get current meeting notes state
    let meetingNotes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingNotes) {
      const notesId = await ctx.db.insert("meetingNotes", {
        meetingId,
        content: "",
        version: 0,
        lastRebasedAt: Date.now(),
        updatedAt: Date.now(),
      });
      meetingNotes = await ctx.db.get(notesId);
      if (!meetingNotes) {
        throw createError.internal("Failed to create meeting notes");
      }
    }

    let synced = 0;
    let failed = 0;
    let conflicts = 0;
    const errors: string[] = [];
    let currentContent = meetingNotes.content;
    let currentVersion = meetingNotes.version;

    // Get current server sequence
    const lastOp = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .order("desc")
      .first();

    let currentSequence = (lastOp?.sequence || 0) + 1;

    // Process queued operations in order
    for (const queuedOp of queuedOps) {
      try {
        // Mark as syncing
        await ctx.db.patch(queuedOp._id, {
          status: "syncing",
          attempts: queuedOp.attempts + 1,
          lastAttempt: Date.now(),
        });

        // Get operations that happened after this client's sequence
        const concurrentOps = await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) =>
            q
              .eq("meetingId", meetingId)
              .gt("sequence", queuedOp.clientSequence),
          )
          .order("asc")
          .collect();

        // Transform the queued operation against concurrent operations
        let transformedOp: Operation = {
          type: queuedOp.operation.type as "insert" | "delete" | "retain",
          position: queuedOp.operation.position,
          content: queuedOp.operation.content,
          length: queuedOp.operation.length,
        };

        const conflictIds: string[] = [];
        for (const concurrentOp of concurrentOps) {
          const concurrentOperation: Operation = {
            type: concurrentOp.operation.type as "insert" | "delete" | "retain",
            position: concurrentOp.operation.position,
            content: concurrentOp.operation.content,
            length: concurrentOp.operation.length,
          };

          const originalPos = transformedOp.position;
          transformedOp = transformAgainstOperations(transformedOp, [
            concurrentOperation,
          ]);

          if (originalPos !== transformedOp.position) {
            conflictIds.push(concurrentOp._id);
            conflicts++;
          }
        }

        // Apply the transformed operation
        currentContent = applyOperations(currentContent, [transformedOp]);

        // Insert the operation record
        await ctx.db.insert("noteOps", {
          meetingId,
          sequence: currentSequence,
          authorId: participant.userId,
          operation: {
            type: transformedOp.type,
            position: transformedOp.position,
            content: transformedOp.content,
            length: transformedOp.length,
          },
          timestamp: queuedOp.timestamp,
          applied: true,
        });

        // Mark as synced
        await ctx.db.patch(queuedOp._id, {
          status: "synced",
        });

        currentSequence++;
        synced++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Operation ${queuedOp.operationId}: ${errorMsg}`);

        // Mark as failed
        await ctx.db.patch(queuedOp._id, {
          status: "failed",
          error: errorMsg,
        });

        failed++;
      }
    }

    // Update the materialized document
    if (synced > 0) {
      currentVersion++;
      await ctx.db.patch(meetingNotes._id, {
        content: currentContent,
        version: currentVersion,
        updatedAt: Date.now(),
      });
    }

    // Get remaining queue count
    const remainingOps = await ctx.db
      .query("offlineOperationQueue")
      .withIndex("by_meeting_and_client", (q) =>
        q.eq("meetingId", meetingId).eq("clientId", clientId),
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    // Log sync result
    await ctx.db.insert("auditLogs", {
      actorUserId: participant.userId,
      resourceType: "meetingNotes",
      resourceId: meetingId,
      action: "sync_offline_operations",
      metadata: {
        clientId,
        queueId: queueId ?? "",
        synced,
        failed,
        conflicts,
        newVersion: currentVersion,
        errors: errors.length,
      },
      timestamp: Date.now(),
    });

    return {
      success: synced > 0 || failed === 0,
      synced,
      failed,
      conflicts,
      newVersion: currentVersion,
      errors,
      remainingInQueue: remainingOps.length,
    };
  },
});

/**
 * Gets offline operation queue status for a client
 */
export const getOfflineQueueStatus = mutation({
  args: {
    meetingId: v.id("meetings"),
    clientId: v.string(),
  },
  returns: v.object({
    totalQueued: v.number(),
    pending: v.number(),
    syncing: v.number(),
    synced: v.number(),
    failed: v.number(),
    oldestPending: v.optional(v.number()),
    newestPending: v.optional(v.number()),
    queueHealth: v.union(
      v.literal("healthy"),
      v.literal("warning"),
      v.literal("critical"),
    ),
  }),
  handler: async (ctx, { meetingId, clientId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const queuedOps = await ctx.db
      .query("offlineOperationQueue")
      .withIndex("by_meeting_and_client", (q) =>
        q.eq("meetingId", meetingId).eq("clientId", clientId),
      )
      .collect();

    const statusCounts = {
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 0,
    };

    let oldestPending: number | undefined;
    let newestPending: number | undefined;

    for (const op of queuedOps) {
      statusCounts[op.status]++;

      if (op.status === "pending") {
        if (!oldestPending || op.queuedAt < oldestPending) {
          oldestPending = op.queuedAt;
        }
        if (!newestPending || op.queuedAt > newestPending) {
          newestPending = op.queuedAt;
        }
      }
    }

    // Determine queue health
    let queueHealth: "healthy" | "warning" | "critical";
    const now = Date.now();
    const oldestAge = oldestPending ? now - oldestPending : 0;

    if (statusCounts.failed > 10 || oldestAge > 300000) {
      // 5 minutes
      queueHealth = "critical";
    } else if (statusCounts.pending > 50 || oldestAge > 60000) {
      // 1 minute
      queueHealth = "warning";
    } else {
      queueHealth = "healthy";
    }

    return {
      totalQueued: queuedOps.length,
      pending: statusCounts.pending,
      syncing: statusCounts.syncing,
      synced: statusCounts.synced,
      failed: statusCounts.failed,
      oldestPending,
      newestPending,
      queueHealth,
    };
  },
});

/**
 * Retries failed offline operations
 */
export const retryFailedOperations = mutation({
  args: {
    meetingId: v.id("meetings"),
    clientId: v.string(),
    maxRetries: v.optional(v.number()),
  },
  returns: v.object({
    retriedCount: v.number(),
    successCount: v.number(),
  }),
  handler: async (ctx, { meetingId, clientId, maxRetries = 3 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Get failed operations that haven't exceeded max retries
    const failedOps = await ctx.db
      .query("offlineOperationQueue")
      .withIndex("by_meeting_and_client", (q) =>
        q.eq("meetingId", meetingId).eq("clientId", clientId),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "failed"),
          q.lt(q.field("attempts"), maxRetries),
        ),
      )
      .collect();

    let retriedCount = 0;
    let successCount = 0;

    for (const op of failedOps) {
      // Reset to pending for retry
      await ctx.db.patch(op._id, {
        status: "pending",
        error: undefined,
      });
      retriedCount++;
    }

    // Attempt to sync the retried operations
    if (retriedCount > 0) {
      const syncResult = await ctx.runMutation(
        api.notes.offline.syncOfflineOperations,
        {
          meetingId,
          clientId,
          maxOperations: retriedCount,
        },
      );
      successCount = syncResult.synced;
    }

    return {
      retriedCount,
      successCount,
    };
  },
});

/**
 * Clears synced operations from the offline queue
 */
export const clearSyncedOperations = mutation({
  args: {
    meetingId: v.id("meetings"),
    clientId: v.string(),
    olderThanMs: v.optional(v.number()),
  },
  returns: v.object({
    cleared: v.number(),
  }),
  handler: async (ctx, { meetingId, clientId, olderThanMs = 3600000 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const cutoff = Date.now() - olderThanMs;

    const syncedOps = await ctx.db
      .query("offlineOperationQueue")
      .withIndex("by_meeting_and_client", (q) =>
        q.eq("meetingId", meetingId).eq("clientId", clientId),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "synced"),
          q.lt(q.field("queuedAt"), cutoff),
        ),
      )
      .collect();

    for (const op of syncedOps) {
      await ctx.db.delete(op._id);
    }

    return {
      cleared: syncedOps.length,
    };
  },
});

/**
 * Creates a checkpoint for offline operations
 */
export const createOfflineCheckpoint = mutation({
  args: {
    meetingId: v.id("meetings"),
    clientId: v.string(),
    checkpointData: v.object({
      sequence: v.number(),
      version: v.number(),
      contentHash: v.string(),
      timestamp: v.number(),
    }),
  },
  returns: v.object({
    checkpointId: v.string(),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, clientId, checkpointData }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const checkpointId = `checkpoint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await ctx.db.insert("offlineCheckpoints", {
      checkpointId,
      meetingId,
      clientId,
      sequence: checkpointData.sequence,
      version: checkpointData.version,
      contentHash: checkpointData.contentHash,
      timestamp: checkpointData.timestamp,
      createdAt: Date.now(),
    });

    return {
      checkpointId,
      success: true,
    };
  },
});

/**
 * Restores from an offline checkpoint
 */
export const restoreFromCheckpoint = mutation({
  args: {
    meetingId: v.id("meetings"),
    clientId: v.string(),
    checkpointId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    checkpoint: v.optional(
      v.object({
        sequence: v.number(),
        version: v.number(),
        contentHash: v.string(),
        timestamp: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { meetingId, clientId, checkpointId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const checkpoint = await ctx.db
      .query("offlineCheckpoints")
      .withIndex("by_checkpoint_id", (q) => q.eq("checkpointId", checkpointId))
      .filter((q) =>
        q.and(
          q.eq(q.field("meetingId"), meetingId),
          q.eq(q.field("clientId"), clientId),
        ),
      )
      .unique();

    if (!checkpoint) {
      return {
        success: false,
        checkpoint: undefined,
      };
    }

    return {
      success: true,
      checkpoint: {
        sequence: checkpoint.sequence,
        version: checkpoint.version,
        contentHash: checkpoint.contentHash,
        timestamp: checkpoint.timestamp,
      },
    };
  },
});

/**
 * Internal function to clean up old offline data
 */
export const cleanupOfflineData = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
  },
  returns: v.object({
    queueItemsDeleted: v.number(),
    checkpointsDeleted: v.number(),
  }),
  handler: async (ctx, { olderThanMs = 7 * 24 * 60 * 60 * 1000 }) => {
    // Default 7 days retention
    const cutoff = Date.now() - olderThanMs;

    // Clean up old queue items (synced and failed)
    const oldQueueItems = await ctx.db
      .query("offlineOperationQueue")
      .filter((q) =>
        q.and(
          q.lt(q.field("queuedAt"), cutoff),
          q.neq(q.field("status"), "pending"), // Keep pending items
        ),
      )
      .collect();

    for (const item of oldQueueItems) {
      await ctx.db.delete(item._id);
    }

    // Clean up old checkpoints
    const oldCheckpoints = await ctx.db
      .query("offlineCheckpoints")
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .collect();

    for (const checkpoint of oldCheckpoints) {
      await ctx.db.delete(checkpoint._id);
    }

    return {
      queueItemsDeleted: oldQueueItems.length,
      checkpointsDeleted: oldCheckpoints.length,
    };
  },
});
