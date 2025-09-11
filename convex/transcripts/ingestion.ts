/**
 * Transcription Ingestion Pipeline
 *
 * This module handles real-time transcription chunk ingestion with
 * time-bucketed storage and rate limiting for scalability.
 *
 * Requirements: 7.1, 7.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";
import { createError } from "../lib/errors";
import { Id } from "../_generated/dataModel";

/**
 * Ingests a transcription chunk with validation and sharding
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
  },
  returns: v.object({
    success: v.boolean(),
    sequence: v.number(),
    bucketMs: v.number(),
  }),
  handler: async (ctx, args) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, args.meetingId);

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

    // Calculate time bucket (5-minute windows) to prevent hot partitions
    const bucketMs = Math.floor(args.startTime / 300000) * 300000;

    // Get next sequence number for this meeting
    const lastTranscript = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_time_range", (q) =>
        q.eq("meetingId", args.meetingId),
      )
      .order("desc")
      .first();

    const sequence = (lastTranscript?.sequence || 0) + 1;

    // Calculate word count for analytics
    const wordCount = args.text.trim().split(/\s+/).length;

    // Insert transcript chunk
    await ctx.db.insert("transcripts", {
      meetingId: args.meetingId,
      bucketMs,
      sequence,
      speakerId: args.speakerId,
      text: args.text.trim(),
      confidence: args.confidence,
      startMs: args.startTime,
      endMs: args.endTime,
      wordCount,
      language: args.language || "en",
      createdAt: Date.now(),
    });

    return {
      success: true,
      sequence,
      bucketMs,
    };
  },
});

/**
 * Internal mutation for batch transcript ingestion
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
      }),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    processed: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, { meetingId, chunks }) => {
    let processed = 0;
    let failed = 0;

    // Get current sequence number
    const lastTranscript = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
      .order("desc")
      .first();

    let currentSequence = (lastTranscript?.sequence || 0) + 1;

    for (const chunk of chunks) {
      try {
        // Validate chunk
        if (chunk.text.trim().length === 0) {
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

        // Calculate time bucket
        const bucketMs = Math.floor(chunk.startTime / 300000) * 300000;
        const wordCount = chunk.text.trim().split(/\s+/).length;

        // Insert transcript chunk
        await ctx.db.insert("transcripts", {
          meetingId,
          bucketMs,
          sequence: currentSequence++,
          speakerId: chunk.speakerId,
          text: chunk.text.trim(),
          confidence: chunk.confidence,
          startMs: chunk.startTime,
          endMs: chunk.endTime,
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

    return {
      success: processed > 0,
      processed,
      failed,
    };
  },
});

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
      const q = ctx.db
        .query("transcripts")
        .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
        .filter((q) => q.gt(q.field("sequence"), fromSequence));
      results = await q.order("asc").take(Math.min(limit, 200));
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
          .withIndex("by_meeting_time_range", (q) =>
            q.eq("meetingId", meetingId),
          )
          .filter((q) => q.lt(q.field("createdAt"), cutoff))
          .collect()
      : await ctx.db
          .query("transcripts")
          .filter((q) => q.lt(q.field("createdAt"), cutoff))
          .collect();

    for (const transcript of oldTranscripts) {
      await ctx.db.delete(transcript._id);
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
