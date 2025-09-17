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
import {
  mutation,
  action,
  internalMutation,
  internalAction,
} from "@convex/_generated/server";
import { Id } from "@convex/_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import {
  BatchProcessor,
  CoalescingBatchProcessor,
  BATCH_CONFIGS,
  transcriptCoalescing,
  noteOpsCoalescing,
  presenceCoalescing,
} from "@convex/lib/batching";
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
} from "@convex/types/validators/real-time";
import { NoteV } from "@convex/types/validators/note";
import { TranscriptV } from "@convex/types/validators/transcript";

/**
 * Global batch processors for different operation types
 */
class BatchProcessorManager {
  private static transcriptProcessor: CoalescingBatchProcessor<any> | null =
    null;
  private static noteOpsProcessor: CoalescingBatchProcessor<any> | null = null;
  private static presenceProcessor: CoalescingBatchProcessor<any> | null = null;

  static getTranscriptProcessor(): CoalescingBatchProcessor<any> {
    if (!this.transcriptProcessor) {
      this.transcriptProcessor = new CoalescingBatchProcessor(
        BATCH_CONFIGS.transcripts.maxBatchSize,
        BATCH_CONFIGS.transcripts.maxWaitMs,
        async (items) => {
          // Process batch of transcript chunks
          await this.processBatchedTranscripts(items);
        },
        transcriptCoalescing,
        (error, items) => {
          console.error("Transcript batch processing failed:", error);
          // Implement retry logic or dead letter queue
        },
      );
    }
    return this.transcriptProcessor;
  }

  static getNoteOpsProcessor(): CoalescingBatchProcessor<any> {
    if (!this.noteOpsProcessor) {
      this.noteOpsProcessor = new CoalescingBatchProcessor(
        BATCH_CONFIGS.noteOps.maxBatchSize,
        BATCH_CONFIGS.noteOps.maxWaitMs,
        async (items) => {
          await this.processBatchedNoteOps(items);
        },
        noteOpsCoalescing,
        (error, items) => {
          console.error("Note ops batch processing failed:", error);
        },
      );
    }
    return this.noteOpsProcessor;
  }

  static getPresenceProcessor(): CoalescingBatchProcessor<any> {
    if (!this.presenceProcessor) {
      this.presenceProcessor = new CoalescingBatchProcessor(
        BATCH_CONFIGS.presenceUpdates.maxBatchSize,
        BATCH_CONFIGS.presenceUpdates.maxWaitMs,
        async (items) => {
          await this.processBatchedPresenceUpdates(items);
        },
        presenceCoalescing,
        (error, items) => {
          console.error("Presence batch processing failed:", error);
        },
      );
    }
    return this.presenceProcessor;
  }

  private static async processBatchedTranscripts(items: any[]): Promise<void> {
    // Group by meeting for efficient processing
    const byMeeting = new Map<string, any[]>();

    for (const item of items) {
      const meetingId = item.meetingId;
      if (!byMeeting.has(meetingId)) {
        byMeeting.set(meetingId, []);
      }
      byMeeting.get(meetingId)!.push(item);
    }

    // Process each meeting's transcripts in parallel
    const promises = Array.from(byMeeting.entries()).map(
      ([meetingId, transcripts]) =>
        this.processTranscriptsForMeeting(meetingId, transcripts),
    );

    await Promise.all(promises);
  }

  private static async processBatchedNoteOps(items: any[]): Promise<void> {
    // Group by meeting for efficient processing
    const byMeeting = new Map<string, any[]>();

    for (const item of items) {
      const meetingId = item.meetingId;
      if (!byMeeting.has(meetingId)) {
        byMeeting.set(meetingId, []);
      }
      byMeeting.get(meetingId)!.push(item);
    }

    // Process each meeting's note operations
    const promises = Array.from(byMeeting.entries()).map(([meetingId, ops]) =>
      this.processNoteOpsForMeeting(meetingId, ops),
    );

    await Promise.all(promises);
  }

  private static async processBatchedPresenceUpdates(
    items: any[],
  ): Promise<void> {
    // Group by meeting for efficient processing
    const byMeeting = new Map<string, any[]>();

    for (const item of items) {
      const meetingId = item.meetingId;
      if (!byMeeting.has(meetingId)) {
        byMeeting.set(meetingId, []);
      }
      byMeeting.get(meetingId)!.push(item);
    }

    // Process each meeting's presence updates
    const promises = Array.from(byMeeting.entries()).map(
      ([meetingId, updates]) =>
        this.processPresenceForMeeting(meetingId, updates),
    );

    await Promise.all(promises);
  }

  private static async processTranscriptsForMeeting(
    meetingId: string,
    transcripts: any[],
  ): Promise<void> {
    // This would call the internal mutation to batch insert transcripts
    console.log(
      `Processing ${transcripts.length} transcript chunks for meeting ${meetingId}`,
    );
    // Implementation would call internal mutation
  }

  private static async processNoteOpsForMeeting(
    meetingId: string,
    ops: any[],
  ): Promise<void> {
    // This would call the internal mutation to batch process note operations
    console.log(
      `Processing ${ops.length} note operations for meeting ${meetingId}`,
    );
    // Implementation would call internal mutation
  }

  private static async processPresenceForMeeting(
    meetingId: string,
    updates: any[],
  ): Promise<void> {
    // This would call the internal mutation to batch update presence
    console.log(
      `Processing ${updates.length} presence updates for meeting ${meetingId}`,
    );
    // Implementation would call internal mutation
  }
}

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

    // Add to batch processor with coalescing
    const processor = BatchProcessorManager.getTranscriptProcessor();

    const transcriptItem = {
      meetingId: args.meetingId,
      speakerId: args.speakerId,
      text: args.text,
      confidence: args.confidence,
      startMs: args.startMs,
      endMs: args.endMs,
      interim: args.interim || false,
      userId: identity.userId,
      timestamp: Date.now(),
    };

    await processor.add(transcriptItem);

    return {
      queued: true,
      batchSize: processor.getQueueSize(),
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

    // Get next sequence number
    const lastOp = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q: any) =>
        q.eq("meetingId", args.meetingId).order("desc"),
      )
      .first();

    const serverSequence = (lastOp?.sequence || 0) + 1;

    // Add to batch processor
    const processor = BatchProcessorManager.getNoteOpsProcessor();

    const noteOpItem = {
      meetingId: args.meetingId,
      authorId: identity.userId,
      operation: args.operation,
      clientSequence: args.clientSequence,
      serverSequence,
      expectedVersion: args.expectedVersion,
      timestamp: Date.now(),
    };

    await processor.add(noteOpItem);

    return {
      queued: true,
      batchSize: processor.getQueueSize(),
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

    // Add to batch processor with coalescing (latest state wins)
    const processor = BatchProcessorManager.getPresenceProcessor();

    const presenceItem = {
      userId: identity.userId as Id<"users">,
      meetingId: args.meetingId,
      presence: args.presence,
      metadata: args.metadata,
      timestamp: Date.now(),
    };

    await processor.add(presenceItem);

    return {
      queued: true,
      batchSize: processor.getQueueSize(),
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
        q.eq("meetingId", meetingId).order("desc"),
      )
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
    await BatchProcessorManager.getTranscriptProcessor().shutdown();
    await BatchProcessorManager.getNoteOpsProcessor().shutdown();
    await BatchProcessorManager.getPresenceProcessor().shutdown();
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
        queueSize:
          BatchProcessorManager.getTranscriptProcessor().getQueueSize(),
      },
      noteOps: {
        queueSize: BatchProcessorManager.getNoteOpsProcessor().getQueueSize(),
      },
      presence: {
        queueSize: BatchProcessorManager.getPresenceProcessor().getQueueSize(),
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
