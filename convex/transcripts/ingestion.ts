/**
 * Transcription Ingestion Pipeline
 *
 * This module handles real-time transcription chunk ingestion with
 * time-bucketed storage and rate limiting for scalability.
 *
 * Requirements: 7.1, 7.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns with centralized types
 */

import {
  mutation,
  internalMutation,
  internalQuery,
} from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { v } from "convex/values";
import { TranscriptQueryOptimizer } from "@convex/lib/queryOptimization";
import { assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { enforceUserLimit } from "@convex/lib/rateLimiter";
import { metadataRecordV } from "@convex/lib/validators";
import { Id } from "@convex/_generated/dataModel";
import { TranscriptV } from "@convex/types/validators/transcript";
import type {
  TranscriptChunk,
  TranscriptStats,
} from "@convex/types/entities/transcript";

/**
 * @summary Ingests a single transcription chunk with validation and rate limiting
 * @description Processes real-time transcription data from speech-to-text services,
 * validates input parameters, enforces rate limits per user, and stores chunks in
 * time-bucketed shards (5-minute windows) to prevent hot partitions. Allocates
 * globally unique sequence numbers for ordering. Returns rate limit status for
 * client-side throttling.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "speakerId": "user_alice_123",
 *     "text": "Let's discuss the Q4 roadmap priorities.",
 *     "confidence": 0.92,
 *     "startTime": 1698765432000,
 *     "endTime": 1698765435500,
 *     "language": "en",
 *     "isInterim": false
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "success": true,
 *     "sequence": 42,
 *     "bucketMs": 1698765300000,
 *     "rateLimitRemaining": 95
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "RATE_LIMIT_EXCEEDED",
 *     "message": "Transcript ingestion rate limit exceeded. Try again in 60 seconds."
 *   }
 * }
 * ```
 */
export const ingestTranscriptChunk = mutation({
  args: {
    meetingId: v.id("meetings"),
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startTime: v.number(),
    endTime: v.number(),
    language: v.optional(v.string()),
    isInterim: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    sequence: v.number(),
    bucketMs: v.number(),
    rateLimitRemaining: v.number(),
  }),
  handler: async (ctx, args) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, args.meetingId);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting || meeting.state !== "active") {
      throw createError.meetingNotActive(args.meetingId);
    }

    // Validate input
    if (args.text.trim().length === 0) {
      throw createError.validation("Transcript text cannot be empty");
    }

    if (args.confidence < 0 || args.confidence > 1) {
      throw createError.validation("Confidence must be between 0 and 1");
    }

    if (args.startTime >= args.endTime) {
      throw createError.validation("Start time must be before end time");
    }

    // Validate text length (prevent abuse)
    if (args.text.length > 10000) {
      throw createError.validation(
        "Transcript text too long (max 10,000 characters)",
      );
    }

    // Enforce rate limits using shared component-backed limiter
    const rateLimitResult = await enforceUserLimit(
      ctx,
      "transcriptIngestion",
      participant.userId,
      {
        throws: true,
      },
    );

    // Calculate time bucket (5-minute windows) to prevent hot partitions
    const bucketMs = Math.floor(args.startTime / 300000) * 300000;

    // Atomically allocate the next global sequence for this meeting using a counter row.
    // This avoids races between concurrent ingestions.
    const now = Date.now();
    const allocateNextSequence = async (): Promise<number> => {
      // Get or initialize the meeting counter
      let counter = await ctx.db
        .query("meetingCounters")
        .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
        .unique();

      if (!counter) {
        // Initialize from the current highest transcript sequence, if any
        const globalLast = await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_time_range", (q) =>
            q.eq("meetingId", args.meetingId),
          )
          .order("desc")
          .first();

        await ctx.db.insert("meetingCounters", {
          meetingId: args.meetingId,
          lastSequence: globalLast?.sequence ?? 0,
          updatedAt: now,
        });

        counter = await ctx.db
          .query("meetingCounters")
          .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
          .unique();
      }

      // Increment atomically via transactional patch. If two transactions race,
      // Convex will retry one to preserve serializability.
      const next = (counter?.lastSequence ?? 0) + 1;
      await ctx.db.patch(counter!._id, { lastSequence: next, updatedAt: now });
      return next;
    };

    // Allocate a unique sequence, retrying if an unexpected duplicate is detected.
    let globalSequence = 0;
    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const seq = await allocateNextSequence();

      // Defensive uniqueness check: ensure no transcript already has this sequence
      const existing = await ctx.db
        .query("transcripts")
        .withIndex("by_meeting_sequence", (q) =>
          q.eq("meetingId", args.meetingId).eq("sequence", seq),
        )
        .unique();

      if (!existing) {
        globalSequence = seq;
        break;
      }
      // Otherwise loop to get the next sequence
    }
    if (globalSequence === 0) {
      throw new Error(
        "Failed to allocate unique transcript sequence after retries",
      );
    }

    // Calculate word count for analytics
    const wordCount = args.text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    // Insert transcript chunk with enhanced metadata
    await ctx.db.insert("transcripts", {
      meetingId: args.meetingId,
      bucketMs,
      sequence: globalSequence,
      speakerId: args.speakerId,
      text: args.text.trim(),
      confidence: args.confidence,
      startMs: args.startTime,
      endMs: args.endTime,
      isInterim: args.isInterim,
      wordCount,
      language: args.language || "en",
      createdAt: now,
    });

    // Update meeting state with latest activity
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        updatedAt: Date.now(),
      });
    }

    console.log("rateLimitRemaining in return:", rateLimitResult.remaining);
    return {
      success: true,
      sequence: globalSequence,
      bucketMs,
      rateLimitRemaining: rateLimitResult.remaining,
    };
  },
});

/**
 * @summary Batch ingests multiple transcript chunks with optimized performance
 * @description Internal mutation for high-throughput transcript ingestion. Processes
 * multiple chunks in a single transaction, sorts by timestamp for proper sequencing,
 * validates each chunk, and allocates unique sequence numbers. Includes performance
 * metrics (processing time, throughput) for monitoring. Used by streaming pipeline
 * and coalescing operations. Processes chunks in sub-batches of 20 to avoid
 * transaction timeouts.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "chunks": [
 *       {
 *         "speakerId": "user_alice_123",
 *         "text": "Welcome everyone to the meeting.",
 *         "confidence": 0.95,
 *         "startTime": 1698765432000,
 *         "endTime": 1698765434000,
 *         "language": "en",
 *         "isInterim": false
 *       },
 *       {
 *         "speakerId": "user_bob_456",
 *         "text": "Thanks for having me.",
 *         "confidence": 0.89,
 *         "startTime": 1698765435000,
 *         "endTime": 1698765437000,
 *         "language": "en",
 *         "isInterim": false
 *       }
 *     ],
 *     "batchId": "batch_1698765432_abc123"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "success": true,
 *     "processed": 2,
 *     "failed": 0,
 *     "batchId": "batch_1698765432_abc123",
 *     "performance": {
 *       "processingTimeMs": 145,
 *       "chunksPerSecond": 13.79
 *     }
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "MEETING_NOT_FOUND",
 *     "message": "Meeting jd7xzqn8h9p2v4k5m6n7p8q9 not found"
 *   }
 * }
 * ```
 */
export const batchIngestTranscriptChunks = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    chunks: v.array(
      v.object({
        speakerId: v.optional(v.string()),
        text: v.string(),
        confidence: v.number(),
        startTime: v.number(),
        endTime: v.number(),
        language: v.optional(v.string()),
        isInterim: v.optional(v.boolean()),
      }),
    ),
    batchId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    processed: v.number(),
    failed: v.number(),
    batchId: v.string(),
    performance: v.object({
      processingTimeMs: v.number(),
      chunksPerSecond: v.number(),
    }),
  }),
  handler: async (ctx, { meetingId, chunks, batchId }) => {
    const startTime = Date.now();
    const generatedBatchId =
      batchId ||
      `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let processed = 0;
    let failed = 0;

    // Validate meeting exists and is active
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw new Error(`Meeting ${meetingId} not found`);
    }

    // Helper to atomically allocate the next sequence for this meeting
    const allocateNextSequence = async (): Promise<number> => {
      const now = Date.now();
      let counter = await ctx.db
        .query("meetingCounters")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique();

      if (!counter) {
        const globalLast = await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_time_range", (q) =>
            q.eq("meetingId", meetingId),
          )
          .order("desc")
          .first();

        await ctx.db.insert("meetingCounters", {
          meetingId,
          lastSequence: globalLast?.sequence ?? 0,
          updatedAt: now,
        });

        counter = await ctx.db
          .query("meetingCounters")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
      }

      const next = (counter?.lastSequence ?? 0) + 1;
      await ctx.db.patch(counter!._id, { lastSequence: next, updatedAt: now });
      return next;
    };

    // Sort chunks by start time for proper sequence ordering
    const sortedChunks = chunks
      .filter((chunk) => chunk.text.trim().length > 0)
      .sort((a, b) => a.startTime - b.startTime);

    // Process chunks in batches to avoid transaction timeouts
    const BATCH_SIZE = 20;
    for (let i = 0; i < sortedChunks.length; i += BATCH_SIZE) {
      const batchChunks = sortedChunks.slice(i, i + BATCH_SIZE);

      for (const chunk of batchChunks) {
        try {
          // Enhanced validation
          if (chunk.text.length > 10000) {
            failed++;
            continue;
          }

          if (chunk.confidence < 0 || chunk.confidence > 1) {
            failed++;
            continue;
          }

          if (chunk.startTime >= chunk.endTime) {
            failed++;
            continue;
          }

          // Calculate time bucket (5-minute windows)
          const bucketMs = Math.floor(chunk.startTime / 300000) * 300000;
          const wordCount = chunk.text
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length;

          // Allocate a unique sequence, retrying on rare conflicts
          let sequence = 0;
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = await allocateNextSequence();
            const existing = await ctx.db
              .query("transcripts")
              .withIndex("by_meeting_sequence", (q) =>
                q.eq("meetingId", meetingId).eq("sequence", candidate),
              )
              .unique();
            if (!existing) {
              sequence = candidate;
              break;
            }
          }
          if (!sequence) {
            throw new Error(
              "Failed to allocate unique transcript sequence in batch",
            );
          }

          // Insert transcript chunk with batch metadata
          await ctx.db.insert("transcripts", {
            meetingId,
            bucketMs,
            sequence,
            speakerId: chunk.speakerId,
            text: chunk.text.trim(),
            confidence: chunk.confidence,
            startMs: chunk.startTime,
            endMs: chunk.endTime,
            isInterim: chunk.isInterim,
            wordCount,
            language: chunk.language || "en",
            createdAt: Date.now(),
          });

          processed++;
        } catch (error) {
          console.error("Failed to process transcript chunk:", error);
          failed++;
        }
      }
    }

    const processingTimeMs = Date.now() - startTime;
    const chunksPerSecond =
      processed > 0 && processingTimeMs > 0
        ? (processed / processingTimeMs) * 1000
        : 0;

    // Update meeting state with batch processing info
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        updatedAt: Date.now(),
      });
    }

    return {
      success: processed > 0,
      processed,
      failed,
      batchId: generatedBatchId,
      performance: {
        processingTimeMs,
        chunksPerSecond,
      },
    };
  },
});

/**
 * @summary Coalesces and ingests transcript chunks for high-frequency streams
 * @description Optimizes high-frequency transcription streams by merging consecutive
 * chunks from the same speaker within a time window (default 250ms). Reduces database
 * writes and improves query performance by consolidating rapid-fire interim results
 * into coherent segments. Returns compression metrics showing reduction ratio.
 * Delegates to batch ingestion after coalescing.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "chunks": [
 *       {
 *         "speakerId": "user_alice_123",
 *         "text": "I think",
 *         "confidence": 0.88,
 *         "startTime": 1698765432000,
 *         "endTime": 1698765432500,
 *         "language": "en"
 *       },
 *       {
 *         "speakerId": "user_alice_123",
 *         "text": "we should",
 *         "confidence": 0.91,
 *         "startTime": 1698765432600,
 *         "endTime": 1698765433100,
 *         "language": "en"
 *       },
 *       {
 *         "speakerId": "user_alice_123",
 *         "text": "prioritize this feature.",
 *         "confidence": 0.93,
 *         "startTime": 1698765433200,
 *         "endTime": 1698765434500,
 *         "language": "en"
 *       }
 *     ],
 *     "coalescingWindowMs": 250
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "success": true,
 *     "processed": 1,
 *     "coalesced": 1,
 *     "performance": {
 *       "originalChunks": 3,
 *       "coalescedChunks": 1,
 *       "compressionRatio": 0.33
 *     }
 *   }
 * }
 * ```
 */
export const coalescedIngestTranscriptChunks = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    chunks: v.array(
      v.object({
        speakerId: v.optional(v.string()),
        text: v.string(),
        confidence: v.number(),
        startTime: v.number(),
        endTime: v.number(),
        language: v.optional(v.string()),
        isInterim: v.optional(v.boolean()),
      }),
    ),
    coalescingWindowMs: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    processed: v.number(),
    coalesced: v.number(),
    performance: v.object({
      originalChunks: v.number(),
      coalescedChunks: v.number(),
      compressionRatio: v.number(),
    }),
  }),
  handler: async (
    ctx,
    { meetingId, chunks, coalescingWindowMs = 250 },
  ): Promise<{
    success: boolean;
    processed: number;
    coalesced: number;
    performance: {
      originalChunks: number;
      coalescedChunks: number;
      compressionRatio: number;
    };
  }> => {
    // Group chunks by speaker and time proximity for coalescing
    const coalescedChunks = coalesceTranscriptChunks(
      chunks,
      coalescingWindowMs,
    );

    // Use batch ingestion for the coalesced chunks via proper function reference
    const result = await ctx.runMutation(
      internal.transcripts.ingestion.batchIngestTranscriptChunks,
      {
        meetingId,
        chunks: coalescedChunks,
        batchId: `coalesced_${Date.now()}`,
      },
    );

    const compressionRatio =
      chunks.length > 0 ? coalescedChunks.length / chunks.length : 1;

    return {
      success: result.success,
      processed: result.processed,
      coalesced: coalescedChunks.length,
      performance: {
        originalChunks: chunks.length,
        coalescedChunks: coalescedChunks.length,
        compressionRatio,
      },
    };
  },
});

/**
 * Internal: Ingest a transcript streaming performance metric.
 * Placed in transcripts/ingestion namespace to ensure availability in generated API.
 */
export const ingestStreamingMetric = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    metrics: v.object({
      chunksProcessed: v.number(),
      batchesProcessed: v.number(),
      latencyMs: v.number(),
      throughputChunksPerSecond: v.number(),
      timestamp: v.number(),
    }),
  },
  returns: v.null(),

  handler: async (ctx, { meetingId, metrics }) => {
    // Validate metrics
    if (
      metrics.throughputChunksPerSecond < 0 ||
      metrics.latencyMs < 0 ||
      metrics.chunksProcessed < 0
    ) {
      throw new Error(
        "Invalid metric values: all metrics must be non-negative",
      );
    }

    try {
      // Record throughput metric (chunks/sec)
      await ctx.db.insert("performanceMetrics", {
        name: "transcript_streaming",
        value: metrics.throughputChunksPerSecond,
        unit: "chunks_per_second",
        labels: {
          meetingId,
          operation: "transcript_ingestion",
          batchesProcessed: String(metrics.batchesProcessed),
        },
        meetingId, // Denormalized for indexing
        threshold: { warning: 10, critical: 5 },
        timestamp: metrics.timestamp,
        createdAt: Date.now(),
      });

      // Record latency sample (ms) so we can compute averages later
      await ctx.db.insert("performanceMetrics", {
        name: "transcript_streaming_latency",
        value: metrics.latencyMs, // already in ms
        unit: "ms",
        labels: {
          meetingId,
          operation: "transcript_ingestion",
        },
        meetingId, // Denormalized for indexing
        timestamp: metrics.timestamp,
        createdAt: Date.now(),
      });
    } catch (error) {
      console.error("Failed to insert performance metrics:", error);
      throw error;
    }

    return null;
  },
});

/**
 * Internal: Create a system alert for monitoring (no auth requirement).
 */
export const createAlertInternal = internalMutation({
  args: {
    alertId: v.string(),
    severity: v.union(
      v.literal("critical"),
      v.literal("error"),
      v.literal("warning"),
      v.literal("info"),
    ),
    category: v.union(
      v.literal("meeting_lifecycle"),
      v.literal("video_provider"),
      v.literal("transcription"),
      v.literal("authentication"),
      v.literal("performance"),
      v.literal("security"),
      v.literal("system"),
    ),
    title: v.string(),
    message: v.string(),
    metadata: metadataRecordV,
    actionable: v.boolean(),
  },
  returns: v.id("alerts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("alerts")
      .filter((q) => q.eq(q.field("alertId"), args.alertId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        severity: args.severity,
        category: args.category,
        title: args.title,
        message: args.message,
        metadata: args.metadata,
        actionable: args.actionable,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("alerts", {
      alertId: args.alertId,
      severity: args.severity,
      category: args.category,
      title: args.title,
      message: args.message,
      metadata: args.metadata,
      actionable: args.actionable,
      status: "active",
      escalationTime: args.severity === "critical" ? now + 300000 : undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Helper function to coalesce transcript chunks by speaker and time proximity
 */
function coalesceTranscriptChunks(
  chunks: Array<{
    speakerId?: string;
    text: string;
    confidence: number;
    startTime: number;
    endTime: number;
    language?: string;
    isInterim?: boolean;
  }>,
  windowMs: number,
): Array<{
  speakerId?: string;
  text: string;
  confidence: number;
  startTime: number;
  endTime: number;
  language?: string;
  isInterim?: boolean;
}> {
  if (chunks.length === 0) return [];

  // Sort chunks by start time
  const sortedChunks = [...chunks].sort((a, b) => a.startTime - b.startTime);
  const coalesced: typeof chunks = [];

  let currentChunk = { ...sortedChunks[0] };

  for (let i = 1; i < sortedChunks.length; i++) {
    const nextChunk = sortedChunks[i];

    // Check if chunks can be coalesced (same speaker, within time window)
    const canCoalesce =
      currentChunk.speakerId === nextChunk.speakerId &&
      currentChunk.language === nextChunk.language &&
      nextChunk.startTime - currentChunk.endTime <= windowMs &&
      !currentChunk.isInterim &&
      !nextChunk.isInterim; // Don't coalesce interim results

    if (canCoalesce) {
      // Merge chunks
      currentChunk.text += " " + nextChunk.text;
      currentChunk.endTime = nextChunk.endTime;
      currentChunk.confidence =
        (currentChunk.confidence + nextChunk.confidence) / 2;
    } else {
      // Save current chunk and start new one
      coalesced.push(currentChunk);
      currentChunk = { ...nextChunk };
    }
  }

  // Add the last chunk
  coalesced.push(currentChunk);

  return coalesced;
}

/**
 * @summary Gets transcript chunks for a meeting with pagination
 * @description Retrieves transcript chunks for a meeting with optional filtering by
 * sequence number and time bucket. Supports pagination with configurable limits
 * (max 200 per request). Uses query optimizer for efficient index-backed retrieval.
 * Requires meeting participant access. Returns chunks in ascending sequence order.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "fromSequence": 0,
 *     "limit": 50,
 *     "bucketMs": 1698765300000
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
 *       "_id": "jh8xzqn8h9p2v4k5m6n7p8r1",
 *       "sequence": 1,
 *       "speakerId": "user_alice_123",
 *       "text": "Welcome everyone to the meeting.",
 *       "confidence": 0.95,
 *       "startMs": 1698765432000,
 *       "endMs": 1698765434000,
 *       "wordCount": 5,
 *       "language": "en",
 *       "createdAt": 1698765434100
 *     },
 *     {
 *       "_id": "jh8xzqn8h9p2v4k5m6n7p8r2",
 *       "sequence": 2,
 *       "speakerId": "user_bob_456",
 *       "text": "Thanks for having me.",
 *       "confidence": 0.89,
 *       "startMs": 1698765435000,
 *       "endMs": 1698765437000,
 *       "wordCount": 4,
 *       "language": "en",
 *       "createdAt": 1698765437100
 *     }
 *   ]
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "User is not a participant in this meeting"
 *   }
 * }
 * ```
 */
export const getTranscriptChunks = mutation({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
    bucketMs: v.optional(v.number()),
  },
  returns: v.array(TranscriptV.chunk),
  handler: async (
    ctx,
    { meetingId, fromSequence = 0, limit = 100, bucketMs },
  ): Promise<TranscriptChunk[]> => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    let results;
    if (bucketMs) {
      const q = ctx.db
        .query("transcripts")
        .withIndex("by_meeting_bucket_seq", (q) =>
          q
            .eq("meetingId", meetingId)
            .eq("bucketMs", bucketMs)
            .gt("sequence", fromSequence),
        );
      results = await q.order("asc").take(Math.min(limit, 200));
    } else {
      // Use optimizer for bucketed, index-backed query without server-side filters
      const optimized = await TranscriptQueryOptimizer.queryTranscripts(
        ctx,
        meetingId,
        fromSequence,
        Math.min(limit, 200),
      );
      results = optimized.transcripts;
    }

    // Transform to TranscriptChunk format
    return results.map((t) => ({
      _id: t._id,
      sequence: t.sequence,
      speakerId: t.speakerId,
      text: t.text,
      confidence: t.confidence,
      startMs: t.startMs,
      endMs: t.endMs,
      wordCount: t.wordCount,
      language: t.language,
      createdAt: t.createdAt,
    }));
  },
});

/**
 * @summary Deletes old transcript chunks for data retention compliance
 * @description Internal maintenance function that removes transcript chunks older than
 * a specified retention period (default 90 days). Can target a specific meeting or
 * clean up globally. Creates audit log entries for compliance tracking. Used by
 * scheduled maintenance jobs to manage storage costs and comply with data retention
 * policies.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "olderThanMs": 7776000000,
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "deleted": 342
 *   }
 * }
 * ```
 */
export const cleanupOldTranscripts = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
    meetingId: v.optional(v.id("meetings")),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (
    ctx,
    { olderThanMs = 90 * 24 * 60 * 60 * 1000, meetingId },
  ) => {
    // Default 90 days retention for raw chunks
    const cutoff = Date.now() - olderThanMs;

    const oldTranscripts = meetingId
      ? await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_and_created_at", (q) =>
            q.eq("meetingId", meetingId).lt("createdAt", cutoff),
          )
          .collect()
      : await ctx.db
          .query("transcripts")
          .withIndex("by_created_at", (q) => q.lt("createdAt", cutoff))
          .collect();

    for (const transcript of oldTranscripts) {
      await ctx.db.delete(transcript._id);
    }

    // Audit log
    try {
      await ctx.runMutation(internal.audit.logging.createAuditLog, {
        actorUserId: undefined,
        resourceType: "transcripts",
        resourceId: meetingId ? String(meetingId) : "*",
        action: "cleanup_transcripts",
        category: "transcription",
        success: true,
        metadata: { deleted: oldTranscripts.length, olderThanMs },
      });
    } catch (e) {
      console.warn("Failed to log transcript cleanup audit", e);
    }

    return {
      deleted: oldTranscripts.length,
    };
  },
});

/**
 * @summary Gets comprehensive transcript statistics for a meeting
 * @description Calculates aggregate statistics for all transcript chunks in a meeting,
 * including total chunks, word count, average confidence, duration, unique speakers,
 * languages detected, and bucket count for sharding metrics. Requires meeting
 * participant access. Returns zero values for meetings with no transcripts.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "totalChunks": 127,
 *     "totalWords": 1843,
 *     "averageConfidence": 0.91,
 *     "duration": 1800000,
 *     "speakers": ["user_alice_123", "user_bob_456", "user_carol_789"],
 *     "languages": ["en"],
 *     "bucketCount": 6
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "User is not a participant in this meeting"
 *   }
 * }
 * ```
 */
export const getTranscriptStats = mutation({
  args: { meetingId: v.id("meetings") },
  returns: TranscriptV.stats,
  handler: async (ctx, { meetingId }): Promise<TranscriptStats> => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
      .collect();

    if (transcripts.length === 0) {
      return {
        totalChunks: 0,
        totalWords: 0,
        averageConfidence: 0,
        duration: 0,
        speakers: [],
        languages: [],
        bucketCount: 0,
      };
    }

    const totalWords = transcripts.reduce((sum, t) => sum + t.wordCount, 0);
    const averageConfidence =
      transcripts.reduce((sum, t) => sum + t.confidence, 0) /
      transcripts.length;

    const speakers = [
      ...new Set(
        transcripts
          .map((t) => t.speakerId)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const languages = [
      ...new Set(
        transcripts
          .map((t) => t.language)
          .filter((x): x is string => Boolean(x)),
      ),
    ];

    const startTime = Math.min(...transcripts.map((t) => t.startMs));
    const endTime = Math.max(...transcripts.map((t) => t.endMs));
    const duration = endTime - startTime;

    // Calculate unique bucket count for sharding metrics
    const uniqueBuckets = new Set(transcripts.map((t) => t.bucketMs));
    const bucketCount = uniqueBuckets.size;

    return {
      totalChunks: transcripts.length,
      totalWords,
      averageConfidence,
      duration,
      speakers,
      languages,
      bucketCount,
    };
  },
});

/**
 * Counts transcripts for a meeting (used by actions via runQuery)
 */
export const countTranscriptsForMeeting = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.number(),
  handler: async (ctx, { meetingId }) => {
    const all = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_bucket", (q) => q.eq("meetingId", meetingId))
      .collect();
    return all.length;
  },
});
