/**
 * Batched Operations for High-Frequency Real-Time Updates
 *
 * This module implements server-side batching for transcripts, note operations,
 * and presence updates with configurable coalescing strategies.
 *
 * Requirements: 5.3, 4.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { internal } from "@convex/_generated/api";
import {
  mutation,
  action,
  internalMutation,
  internalAction,
} from "@convex/_generated/server";
import { Id } from "@convex/_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { withTrace } from "@convex/lib/performance";
import { metadataRecordV } from "@convex/lib/validators";
import {
  BatchQueueResultV,
  BatchNoteOperationResultV,
  BatchTranscriptProcessResultV,
  BatchNoteProcessResultV,
  BatchPresenceProcessResultV,
  BatchStatsResultV,
  BatchPresenceUpdateV,
} from "@convex/types/validators/realTime";
import { NoteV } from "@convex/types/validators/note";
import { TranscriptV } from "@convex/types/validators/transcript";

/**
 * Batched transcript ingestion with coalescing
 */
export const batchIngestTranscriptChunk = mutation({
  args: {
    meetingId: v.id("meetings"),
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startMs: v.number(),
    endMs: v.number(),
    interim: v.optional(v.boolean()),
  },
  returns: BatchQueueResultV.full,
  handler: withTrace("batchIngestTranscriptChunk", async (ctx, args) => {
    // Validate meeting access
    await assertMeetingAccess(ctx, args.meetingId, "participant");
    const identity = await requireIdentity(ctx);

    // Check if meeting is active
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q: any) => q.eq("meetingId", args.meetingId))
      .unique();

    if (!meetingState?.active) {
      throw new Error("Meeting is not active");
    }

    // Ack-without-persist repair: the old path enqueued into an in-memory
    // processor whose flusher only logged, so every acked chunk was lost.
    // Persist the chunk durably in this transaction instead. Interim chunks
    // are transient (superseded by the final transcript) and are acked as
    // coalesced without a durable write.
    if (!args.interim) {
      const result = await ctx.runMutation(
        internal.realtime.batchedOperations.processBatchedTranscriptChunks,
        {
          meetingId: args.meetingId,
          chunks: [
            {
              speakerId: args.speakerId,
              text: args.text,
              confidence: args.confidence,
              startMs: args.startMs,
              endMs: args.endMs,
              userId: identity.userId,
              timestamp: Date.now(),
            },
          ],
        },
      );
      if (result.inserted !== 1) {
        throw createError.validation(
          `Transcript chunk was not persisted: ${
            result.errors?.[0] ?? "unknown ingestion failure"
          }`,
        );
      }
    }

    // Kept for response-shape compatibility: the chunk is now durable (or an
    // interim ack), not merely queued. batchSize 1 = the single persisted
    // chunk.
    return {
      queued: true,
      batchSize: 1,
    };
  }),
});

/**
 * Batched note operation processing with operational transform
 */
export const batchApplyNoteOperation = mutation({
  args: {
    meetingId: v.id("meetings"),
    operation: NoteV.operation,
    clientSequence: v.number(),
    expectedVersion: v.number(),
  },
  returns: BatchNoteOperationResultV.full,
  handler: withTrace("batchApplyNoteOperation", async (ctx, args) => {
    // Validate meeting access
    await assertMeetingAccess(ctx, args.meetingId, "participant");
    const identity = await requireIdentity(ctx);

    // Get or create the materialized notes document
    let meetingNotes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q: any) => q.eq("meetingId", args.meetingId))
      .unique();

    if (!meetingNotes) {
      const notesId = await ctx.db.insert("meetingNotes", {
        meetingId: args.meetingId,
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

    // Optimistic concurrency: a version mismatch must fail the call rather
    // than ack an operation that would never be persisted.
    if (args.expectedVersion !== meetingNotes.version) {
      throw createError.conflict(
        `Version mismatch: expected ${args.expectedVersion}, got ${meetingNotes.version}`,
      );
    }

    // Get next sequence number
    const lastOp = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q: any) =>
        q.eq("meetingId", args.meetingId),
      )
      .order("desc")
      .first();

    const serverSequence = (lastOp?.sequence || 0) + 1;

    // Persist BEFORE acking, in this same transaction: by the time the client
    // sees the ack carrying serverSequence, the operation record and the
    // advanced materialized document are durable. (The previous path only
    // enqueued into an in-memory processor whose flusher never wrote to the
    // database, so acks were lies.)
    await ctx.db.insert("noteOps", {
      meetingId: args.meetingId,
      sequence: serverSequence,
      authorId: identity.userId,
      operation: args.operation,
      timestamp: Date.now(),
      applied: true,
    });

    const newContent = applyOperation(meetingNotes.content, args.operation);
    await ctx.db.patch(meetingNotes._id, {
      content: newContent,
      version: meetingNotes.version + 1,
      updatedAt: Date.now(),
    });

    // Kept for response-shape compatibility: the operation is now durable,
    // not merely queued. batchSize 1 = the single persisted operation.
    return {
      queued: true,
      batchSize: 1,
      serverSequence,
    };
  }),
});

/**
 * Batched presence updates with latest-state-wins coalescing
 */
export const batchUpdatePresence = mutation({
  args: {
    meetingId: v.id("meetings"),
    presence: v.union(v.literal("joined"), v.literal("left")),
    metadata: v.optional(metadataRecordV),
  },
  returns: BatchQueueResultV.full,
  handler: withTrace("batchUpdatePresence", async (ctx, args) => {
    // Validate meeting access
    await assertMeetingAccess(ctx, args.meetingId, "participant");
    const identity = await requireIdentity(ctx);

    // Ack-without-persist repair: persist the presence change durably in
    // this transaction (latest-state-wins coalescing is per-user within the
    // batch, and this batch has one update). metadata has no durable column
    // on meetingParticipants; it is accepted for API compatibility and
    // intentionally not persisted.
    const result = await ctx.runMutation(
      internal.realtime.batchedOperations.processBatchedPresenceUpdates,
      {
        meetingId: args.meetingId,
        updates: [
          {
            userId: identity.userId as Id<"users">,
            presence: args.presence,
            metadata: args.metadata,
            timestamp: Date.now(),
          },
        ],
      },
    );
    if (result.updated !== 1) {
      throw createError.validation(
        "Presence update was not persisted: no meeting participant row",
      );
    }

    // Kept for response-shape compatibility: the update is now durable, not
    // merely queued. batchSize 1 = the single persisted update.
    return {
      queued: true,
      batchSize: 1,
    };
  }),
});

/**
 * Internal mutation to process batched transcript chunks
 */
export const processBatchedTranscriptChunks = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    chunks: v.array(TranscriptV.batchChunk),
  },
  returns: BatchTranscriptProcessResultV.full,
  handler: async (ctx, { meetingId, chunks }) => {
    const sequences: number[] = [];

    // Get current bucket and sequence
    const now = Date.now();
    const bucketMs = Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000); // 5-minute buckets

    // Get last sequence for this meeting
    const lastTranscript = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_bucket_seq", (q: any) =>
        q.eq("meetingId", meetingId),
      )
      .order("desc")
      .first();

    let currentSequence = lastTranscript?.sequence || 0;

    // Insert chunks with proper sequencing
    for (const chunk of chunks) {
      currentSequence++;

      await ctx.db.insert("transcripts", {
        meetingId,
        bucketMs,
        sequence: currentSequence,
        speakerId: chunk.speakerId,
        text: chunk.text,
        confidence: chunk.confidence,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        wordCount: chunk.text.split(/\s+/).length,
        createdAt: chunk.timestamp,
      });

      sequences.push(currentSequence);
    }

    return {
      inserted: chunks.length,
      sequences,
    };
  },
});

/**
 * Internal mutation to process batched note operations
 */
export const processBatchedNoteOperations = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    operations: v.array(NoteV.batchOperation),
  },
  returns: BatchNoteProcessResultV.full,
  handler: async (ctx, { meetingId, operations }) => {
    const conflicts: number[] = [];

    // Get current notes state
    const currentNotes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q: any) => q.eq("meetingId", meetingId))
      .unique();

    let currentVersion = currentNotes?.version || 0;
    let currentContent = currentNotes?.content || "";

    // Process operations in sequence order
    const sortedOps = operations.sort(
      (a, b) => a.serverSequence - b.serverSequence,
    );

    for (const op of sortedOps) {
      // Check for version conflicts
      if (op.expectedVersion !== currentVersion) {
        conflicts.push(op.serverSequence);
        continue;
      }

      // Insert operation record
      await ctx.db.insert("noteOps", {
        meetingId,
        sequence: op.serverSequence,
        authorId: op.authorId,
        operation: op.operation,
        timestamp: op.timestamp,
        applied: true,
      });

      // Apply operation to content (simplified OT)
      currentContent = applyOperation(currentContent, op.operation);
      currentVersion++;
    }

    // Update materialized notes
    if (currentNotes) {
      await ctx.db.patch(currentNotes._id, {
        content: currentContent,
        version: currentVersion,
        lastRebasedAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("meetingNotes", {
        meetingId,
        content: currentContent,
        version: currentVersion,
        lastRebasedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return {
      processed: operations.length - conflicts.length,
      newVersion: currentVersion,
      conflicts,
    };
  },
});

/**
 * Internal mutation to process batched presence updates
 */
export const processBatchedPresenceUpdates = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    updates: v.array(BatchPresenceUpdateV.update),
  },
  returns: BatchPresenceProcessResultV.full,
  handler: async (ctx, { meetingId, updates }) => {
    let updatedCount = 0;

    // Group updates by user (latest state wins)
    const latestByUser = new Map<string, any>();

    for (const update of updates) {
      const existing = latestByUser.get(update.userId);
      if (!existing || update.timestamp > existing.timestamp) {
        latestByUser.set(update.userId, update);
      }
    }

    // Apply latest state for each user
    for (const update of latestByUser.values()) {
      const participant = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_user", (q: any) =>
          q.eq("meetingId", meetingId).eq("userId", update.userId),
        )
        .unique();

      if (participant) {
        const updateData: any = {
          presence: update.presence,
        };

        if (update.presence === "joined") {
          updateData.joinedAt = update.timestamp;
        } else if (update.presence === "left") {
          updateData.leftAt = update.timestamp;
        }

        await ctx.db.patch(participant._id, updateData);
        updatedCount++;
      }
    }

    return {
      updated: updatedCount,
    };
  },
});

/**
 * Flush all pending batches (for testing or shutdown)
 */
export const flushAllBatches = action({
  args: {},
  returns: v.null(),
  handler: async (ctx, {}) => {
    // Nothing to flush: every batched write is persisted inline in its own
    // mutation transaction (the old in-memory queues are gone).
    return null;
  },
});

/**
 * Get batch processing statistics
 */
export const getBatchStats = action({
  args: {},
  returns: BatchStatsResultV.full,
  handler: async (ctx, {}) => {
    return {
      transcripts: {
        // No queue: writes are persisted inline per mutation.
        queueSize: 0,
      },
      noteOps: {
        // Note ops are persisted inline per mutation (no queue), so the
        // batch queue is always empty.
        queueSize: 0,
      },
      presence: {
        // No queue: writes are persisted inline per mutation.
        queueSize: 0,
      },
    };
  },
});

/**
 * Simplified operational transform application
 */
function applyOperation(content: string, operation: any): string {
  switch (operation.type) {
    case "insert":
      return (
        content.slice(0, operation.position) +
        (operation.content || "") +
        content.slice(operation.position)
      );

    case "delete":
      return (
        content.slice(0, operation.position) +
        content.slice(operation.position + (operation.length || 0))
      );

    case "retain":
      return content; // No change for retain operations

    default:
      return content;
  }
}
