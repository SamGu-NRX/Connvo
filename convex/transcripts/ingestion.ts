/**
 * Transcription Ingestion Pipeline
 *
 * This module handles real-time transcription chunk ingestion with
 * time-bucketed storage and rate limiting for scalability.
 *
 * Requirements: 7.1, 7.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import {
  mutation,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { TranscriptQueryOptimizer } from "../lib/queryOptimization";
import { assertMeetingAccess } from "../auth/guards";
import { createError } from "../lib/errors";
import { enforceUserLimit } from "../lib/rateLimiter";
import { metadataRecordV } from "../lib/validators";
import { Id } from "../_generated/dataModel";

/**
 * Ingests a transcription chunk with validation, sharding, and rate limiting
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
    await enforceUserLimit(ctx, "transcriptIngestion", participant.userId, {
      throws: true,
    });

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
          .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", args.meetingId))
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
      throw new Error("Failed to allocate unique transcript sequence after retries");
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

    return {
      success: true,
      sequence: globalSequence,
      bucketMs,
      // Remaining capacity is not exposed by the component; returning 0 as neutral value.
      rateLimitRemaining: 0,
    };
  },
});

/**
 * Internal mutation for batch transcript ingestion with optimized performance
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
          .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
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
            throw new Error("Failed to allocate unique transcript sequence in batch");
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
 * Coalesced transcript ingestion for high-frequency streams
 * Buffers chunks and processes them in optimized batches
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
 * Gets transcript chunks for a meeting with pagination
 */
export const getTranscriptChunks = mutation({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
    bucketMs: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("transcripts"),
      sequence: v.number(),
      speakerId: v.optional(v.string()),
      text: v.string(),
      confidence: v.number(),
      startMs: v.number(),
      endMs: v.number(),
      wordCount: v.number(),
      language: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (
    ctx,
    { meetingId, fromSequence = 0, limit = 100, bucketMs },
  ) => {
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

    return results;
  },
});

/**
 * Deletes old transcript chunks for cleanup
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
 * Gets transcript statistics for a meeting
 */
export const getTranscriptStats = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    totalChunks: v.number(),
    totalWords: v.number(),
    averageConfidence: v.number(),
    duration: v.number(),
    speakers: v.array(v.string()),
    languages: v.array(v.string()),
  }),
  handler: async (ctx, { meetingId }) => {
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

    return {
      totalChunks: transcripts.length,
      totalWords,
      averageConfidence,
      duration,
      speakers,
      languages,
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
