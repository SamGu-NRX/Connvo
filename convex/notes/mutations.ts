/**
 * Collaborative Notes Mutations with Operational Transform
 *
 * This module handles real-time note operations with conflict resolution,
 * optimistic updates, and comprehensive audit logging.
 *
 * Requirements: 8.1, 8.2, 8.4, 8.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";
import { createError } from "../lib/errors";
import { Id } from "../_generated/dataModel";
import {
  Operation,
  OperationWithMetadata,
  operationValidator,
  operationWithMetadataValidator,
  applyToDoc,
  transformAgainst,
  transformAgainstOperations,
  validateOperation,
  composeOperations,
  normalizeOperations,
  getOperationPriority,
} from "./operations";

/**
 * Applies a note operation with operational transform conflict resolution
 */
export const applyNoteOperation = mutation({
  args: {
    meetingId: v.id("meetings"),
    operation: operationValidator,
    clientSequence: v.number(),
    expectedVersion: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    serverSequence: v.number(),
    transformedOperation: operationValidator,
    newVersion: v.number(),
    conflicts: v.array(v.string()),
  }),
  handler: async (
    ctx,
    { meetingId, operation, clientSequence, expectedVersion },
  ) => {
    // Verify user is a participant with write access
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Validate the operation
    if (!validateOperation(operation)) {
      throw createError.validation("Invalid operation format");
    }

    // Get or create meeting notes document
    let meetingNotes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingNotes) {
      // Create initial notes document
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

    // Check version compatibility for optimistic updates
    if (
      expectedVersion !== undefined &&
      expectedVersion !== meetingNotes.version
    ) {
      throw createError.conflict(
        `Version mismatch: expected ${expectedVersion}, got ${meetingNotes.version}`,
      );
    }

    // Get operations that happened after the client's last known state
    const concurrentOps = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId).gt("sequence", clientSequence),
      )
      .order("asc")
      .collect();

    // Transform the incoming operation against concurrent operations
    let transformedOp = operation;
    const conflicts: string[] = [];

    for (const concurrentOp of concurrentOps) {
      // Validate the operation type before casting
      const opType = concurrentOp.operation.type;
      if (opType !== "insert" && opType !== "delete" && opType !== "retain") {
        throw createError.validation(`Invalid operation type: ${opType}`);
      }
      const concurrentOperation: Operation = {
        type: opType,
        position: concurrentOp.operation.position,
        content: concurrentOp.operation.content,
        length: concurrentOp.operation.length,
      };

      // Transform against this concurrent operation
      const beforeOp = transformedOp;
      transformedOp = transformAgainst(transformedOp, concurrentOperation);

      // Track conflicts for client notification
      const hasPositionConflict = beforeOp.position !== transformedOp.position;
      const hasContentConflict =
        beforeOp.type === "insert" &&
        transformedOp.type === "insert" &&
        (beforeOp.content || "") !== (transformedOp.content || "");
      const hasLengthConflict =
        (beforeOp.length ?? 0) !== (transformedOp.length ?? 0);
      const hasTypeConflict = beforeOp.type !== transformedOp.type;

      if (
        hasPositionConflict ||
        hasContentConflict ||
        hasLengthConflict ||
        hasTypeConflict
      ) {
        conflicts.push(concurrentOp._id);
      }
    }

    // Get next sequence number
    const lastOp = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .order("desc")
      .first();

    const serverSequence = (lastOp?.sequence || 0) + 1;

    // Create operation with metadata
    const operationWithMetadata: OperationWithMetadata = {
      ...transformedOp,
      id: `op_${Date.now()}_${crypto.randomUUID()}`,
      authorId: participant.userId,
      timestamp: Date.now(),
      sequence: serverSequence,
      transformedFrom: conflicts.length > 0 ? conflicts : undefined,
    };

    // Apply the transformed operation to the document
    let newContent: string;
    try {
      newContent = applyToDoc(meetingNotes.content, transformedOp);
    } catch (error) {
      throw createError.validation(`Failed to apply operation: ${error}`);
    }

    // Insert the operation record
    await ctx.db.insert("noteOps", {
      meetingId,
      sequence: serverSequence,
      authorId: participant.userId,
      operation: {
        type: transformedOp.type,
        position: transformedOp.position,
        content: transformedOp.content,
        length: transformedOp.length,
      },
      timestamp: Date.now(),
      applied: true,
    });

    // Update the materialized notes document
    const newVersion = meetingNotes.version + 1;
    await ctx.db.patch(meetingNotes._id, {
      content: newContent,
      version: newVersion,
      updatedAt: Date.now(),
    });

    // Log the operation for audit purposes
    await ctx.db.insert("auditLogs", {
      actorUserId: participant.userId,
      resourceType: "meetingNotes",
      resourceId: meetingId,
      action: "apply_operation",
      metadata: {
        operationType: transformedOp.type,
        operationId: operationWithMetadata.id,
        sequence: serverSequence,
        conflicts: conflicts.length,
        contentLength: newContent.length,
      },
      timestamp: Date.now(),
    });

    return {
      success: true,
      serverSequence,
      transformedOperation: transformedOp,
      newVersion,
      conflicts,
    };
  },
});

/**
 * Batch applies multiple note operations with optimized conflict resolution
 */
export const batchApplyNoteOperations = mutation({
  args: {
    meetingId: v.id("meetings"),
    operations: v.array(
      v.object({
        operation: operationValidator,
        clientSequence: v.number(),
      }),
    ),
    expectedVersion: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    processed: v.number(),
    failed: v.number(),
    results: v.array(
      v.object({
        serverSequence: v.number(),
        transformedOperation: operationValidator,
        conflicts: v.array(v.string()),
      }),
    ),
    newVersion: v.number(),
  }),
  handler: async (ctx, { meetingId, operations, expectedVersion }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Get meeting notes
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

    // Check version compatibility
    if (
      expectedVersion !== undefined &&
      expectedVersion !== meetingNotes.version
    ) {
      throw createError.conflict(
        `Version mismatch: expected ${expectedVersion}, got ${meetingNotes.version}`,
      );
    }

    let processed = 0;
    let failed = 0;
    const results: Array<{
      serverSequence: number;
      transformedOperation: Operation;
      conflicts: string[];
    }> = [];

    let currentContent = meetingNotes.content;
    let currentVersion = meetingNotes.version;

    // Get the current max sequence
    const lastOp = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .order("desc")
      .first();

    let currentSequence = (lastOp?.sequence || 0) + 1;

    // Process operations in order
    for (const { operation, clientSequence } of operations) {
      try {
        // Validate operation
        if (!validateOperation(operation)) {
          failed++;
          continue;
        }

        // Get concurrent operations for this specific client sequence
        const concurrentOps = await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) =>
            q.eq("meetingId", meetingId).gt("sequence", clientSequence),
          )
          .order("asc")
          .collect();

        // Transform against concurrent operations
        let transformedOp = operation;
        const conflicts: string[] = [];

        for (const concurrentOp of concurrentOps) {
          const concurrentOperation: Operation = {
            type: concurrentOp.operation.type as "insert" | "delete" | "retain",
            position: concurrentOp.operation.position,
            content: concurrentOp.operation.content,
            length: concurrentOp.operation.length,
          };

          // Attempt to transform against the concurrent operation. Only
          // overwrite transformedOp on success; otherwise record a conflict.
          const maybeTransformed = transformAgainst(
            transformedOp,
            concurrentOperation,
          );
          if (maybeTransformed) {
            transformedOp = maybeTransformed;
          } else {
            conflicts.push(concurrentOp._id);
          }
        }

        // Apply to current content
        currentContent = applyToDoc(currentContent, transformedOp);

        // Insert operation record
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
          timestamp: Date.now(),
          applied: true,
        });

        results.push({
          serverSequence: currentSequence,
          transformedOperation: transformedOp,
          conflicts,
        });

        currentSequence++;
        processed++;
      } catch (error) {
        console.error("Failed to process operation:", error);
        failed++;
      }
    }

    // Update the materialized document
    currentVersion++;
    await ctx.db.patch(meetingNotes._id, {
      content: currentContent,
      version: currentVersion,
      updatedAt: Date.now(),
    });

    // Log batch operation
    await ctx.db.insert("auditLogs", {
      actorUserId: participant.userId,
      resourceType: "meetingNotes",
      resourceId: meetingId,
      action: "batch_apply_operations",
      metadata: {
        totalOperations: operations.length,
        processed,
        failed,
        newVersion: currentVersion,
        contentLength: currentContent.length,
      },
      timestamp: Date.now(),
    });

    return {
      success: processed > 0,
      processed,
      failed,
      results,
      newVersion: currentVersion,
    };
  },
});

/**
 * Composes consecutive operations from the same author for optimization
 */
export const composeConsecutiveOperations = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    authorId: v.id("users"),
    maxOperations: v.optional(v.number()),
  },
  returns: v.object({
    composed: v.number(),
    originalCount: v.number(),
    newCount: v.number(),
  }),
  handler: async (ctx, { meetingId, authorId, maxOperations = 100 }) => {
    // Get recent operations from the author
    const operations = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .filter((q) => q.eq(q.field("authorId"), authorId))
      .order("desc")
      .take(maxOperations);

    if (operations.length < 2) {
      return {
        composed: 0,
        originalCount: operations.length,
        newCount: operations.length,
      };
    }

    // Sort by sequence for processing
    operations.sort((a, b) => a.sequence - b.sequence);

    const composed: typeof operations = [];
    let i = 0;

    while (i < operations.length) {
      let currentOp = operations[i];
      let j = i + 1;

      // Try to compose with subsequent operations
      while (j < operations.length) {
        const nextOp = operations[j];

        // Check if operations can be composed (adjacent sequences, same author)
        if (
          nextOp.sequence === currentOp.sequence + 1 &&
          nextOp.authorId === currentOp.authorId
        ) {
          const currentOperation: Operation = {
            type: currentOp.operation.type as "insert" | "delete" | "retain",
            position: currentOp.operation.position,
            content: currentOp.operation.content,
            length: currentOp.operation.length,
          };

          const nextOperation: Operation = {
            type: nextOp.operation.type as "insert" | "delete" | "retain",
            position: nextOp.operation.position,
            content: nextOp.operation.content,
            length: nextOp.operation.length,
          };

          const composedOp = composeOperations(currentOperation, nextOperation);

          if (composedOp) {
            // Update current operation with composed result
            currentOp = {
              ...currentOp,
              operation: {
                type: composedOp.type,
                position: composedOp.position,
                content: composedOp.content,
                length: composedOp.length,
              },
              timestamp: Math.max(currentOp.timestamp, nextOp.timestamp),
            };
            j++;
          } else {
            break; // Cannot compose further
          }
        } else {
          break; // Not consecutive or different author
        }
      }

      composed.push(currentOp);
      i = j;
    }

    // Update the database with composed operations
    let composedCount = 0;
    if (composed.length < operations.length) {
      // Delete original operations
      for (const op of operations) {
        await ctx.db.delete(op._id);
      }

      // Insert composed operations
      for (const op of composed) {
        await ctx.db.insert("noteOps", {
          meetingId: op.meetingId,
          sequence: op.sequence,
          authorId: op.authorId,
          operation: op.operation,
          timestamp: op.timestamp,
          applied: op.applied,
        });
      }

      composedCount = operations.length - composed.length;
    }

    return {
      composed: composedCount,
      originalCount: operations.length,
      newCount: composed.length,
    };
  },
});

/**
 * Rebases the notes document by reapplying all operations
 */
export const rebaseNotesDocument = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    newVersion: v.number(),
    operationsProcessed: v.number(),
    contentLength: v.number(),
  }),
  handler: async (ctx, { meetingId, fromSequence = 0 }) => {
    // Get meeting notes
    const meetingNotes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!meetingNotes) {
      throw new Error("Meeting notes not found");
    }

    // Get all operations from the specified sequence
    const operations = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId).gte("sequence", fromSequence),
      )
      .order("asc")
      .collect();

    // Start with empty content or current content if fromSequence > 0
    let content = fromSequence === 0 ? "" : meetingNotes.content;

    // Apply all operations in sequence
    for (const op of operations) {
      const operation: Operation = {
        type: op.operation.type as "insert" | "delete" | "retain",
        position: op.operation.position,
        content: op.operation.content,
        length: op.operation.length,
      };

      try {
        content = applyToDoc(content, operation);
      } catch (error) {
        console.error(`Failed to apply operation ${op.sequence}:`, error);
        // Mark operation as failed but continue
        await ctx.db.patch(op._id, { applied: false });
      }
    }

    // Update the materialized document
    const newVersion = meetingNotes.version + 1;
    await ctx.db.patch(meetingNotes._id, {
      content,
      version: newVersion,
      lastRebasedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      success: true,
      newVersion,
      operationsProcessed: operations.length,
      contentLength: content.length,
    };
  },
});

/**
 * Rolls back operations to a specific sequence number
 */
export const rollbackToSequence = mutation({
  args: {
    meetingId: v.id("meetings"),
    targetSequence: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    operationsRemoved: v.number(),
    newVersion: v.number(),
  }),
  handler: async (ctx, { meetingId, targetSequence, reason }) => {
    // Verify user has host permissions for rollback
    await assertMeetingAccess(ctx, meetingId, "host");

    // Get operations to remove
    const operationsToRemove = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId).gt("sequence", targetSequence),
      )
      .collect();

    // Remove the operations
    for (const op of operationsToRemove) {
      await ctx.db.delete(op._id);
    }

    // Rebase the document from the target sequence
    const rebaseResult: {
      success: boolean;
      newVersion: number;
      operationsProcessed: number;
      contentLength: number;
    } = await ctx.runMutation(internal.notes.mutations.rebaseNotesDocument, {
      meetingId,
      fromSequence: 0, // Rebuild from scratch
    });

    // Log the rollback
    await ctx.db.insert("auditLogs", {
      actorUserId: (await assertMeetingAccess(ctx, meetingId)).userId,
      resourceType: "meetingNotes",
      resourceId: meetingId,
      action: "rollback_operations",
      metadata: {
        targetSequence,
        operationsRemoved: operationsToRemove.length,
        reason: reason || "Manual rollback",
        newVersion: rebaseResult.newVersion,
      },
      timestamp: Date.now(),
    });

    return {
      success: true,
      operationsRemoved: operationsToRemove.length,
      newVersion: rebaseResult.newVersion,
    };
  },
});

/**
 * Cleans up old note operations beyond retention period
 */
export const cleanupOldNoteOperations = internalMutation({
  args: {
    meetingId: v.optional(v.id("meetings")),
    olderThanMs: v.optional(v.number()),
    keepMinimumOps: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (
    ctx,
    { meetingId, olderThanMs = 90 * 24 * 60 * 60 * 1000, keepMinimumOps = 100 },
  ) => {
    // Default 90 days retention for note operations
    const cutoff = Date.now() - olderThanMs;

    let oldOperations;
    if (meetingId) {
      oldOperations = await ctx.db
        .query("noteOps")
        .withIndex("by_meeting_timestamp", (q) =>
          q.eq("meetingId", meetingId).lt("timestamp", cutoff),
        )
        .collect();
    } else {
      oldOperations = await ctx.db
        .query("noteOps")
        .filter((q) => q.lt(q.field("timestamp"), cutoff))
        .collect();
    }

    // Keep minimum number of operations per meeting
    const operationsByMeeting = new Map<string, typeof oldOperations>();
    for (const op of oldOperations) {
      const key = op.meetingId;
      if (!operationsByMeeting.has(key)) {
        operationsByMeeting.set(key, []);
      }
      operationsByMeeting.get(key)!.push(op);
    }

    let deleted = 0;
    for (const [meetingKey, ops] of operationsByMeeting) {
      // Sort by sequence and keep the most recent operations
      ops.sort((a, b) => b.sequence - a.sequence);
      const toDelete = ops.slice(keepMinimumOps);

      for (const op of toDelete) {
        await ctx.db.delete(op._id);
        deleted++;
      }
    }

    return { deleted };
  },
});
