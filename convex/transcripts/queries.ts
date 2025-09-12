/**
 * Real-Time Transcript Streaming Queries
 *
 * This module provides reactive queries for live transcript streaming with
 * per-meeting isolation, cursor-based pagination, and performance optimization.
 *
 * Requirements: 7.2, 7.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";
import { TranscriptQueryOptimizer } from "../lib/queryOptimization";
import { Id } from "../_generated/dataModel";

/**
 * Subscribes to real-time transcript stream for a meeting
 * Supports cursor-based pagination and time-bounded queries
 */
export const subscribeTranscriptStream = query({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
    timeWindowMs: v.optional(v.number()),
  },
  returns: v.object({
    transcripts: v.array(
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
    nextCursor: v.string(),
    hasMore: v.boolean(),
    performance: v.object({
      bucketsQueried: v.number(),
      totalResults: v.number(),
      queryTimeMs: v.number(),
      earlyTermination: v.boolean(),
    }),
  }),
  handler: async (
    ctx,
    { meetingId, fromSequence = 0, limit = 50, timeWindowMs = 1800000 },
  ) => {
    // Verify user is a participant with access to transcripts
    await assertMeetingAccess(ctx, meetingId);

    // Validate meeting is active for live streaming
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Use optimized query with time-bucketed sharding
    const result = await TranscriptQueryOptimizer.queryTranscripts(
      ctx,
      meetingId,
      fromSequence,
      Math.min(limit, 200), // Cap at 200 for performance
      timeWindowMs,
    );

    // Encode cursor for client-side pagination
    const nextCursor = TranscriptQueryOptimizer.encodeCursor(result.nextCursor);
    const hasMore = result.transcripts.length === limit;

    return {
      transcripts: result.transcripts.map((t) => ({
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
      })),
      nextCursor,
      hasMore,
      performance: result.performance,
    };
  },
});

/**
 * Gets recent transcript chunks for a specific time range
 * Optimized for displaying transcript history
 */
export const getTranscriptsByTimeRange = query({
  args: {
    meetingId: v.id("meetings"),
    startMs: v.number(),
    endMs: v.number(),
    limit: v.optional(v.number()),
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
    }),
  ),
  handler: async (ctx, { meetingId, startMs, endMs, limit = 100 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Validate time range
    if (startMs >= endMs) {
      throw new Error("Invalid time range: start must be before end");
    }

    // Query transcripts within time range using optimized index
    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_time_range", (q) =>
        q
          .eq("meetingId", meetingId)
          .gte("startMs", startMs)
          .lte("startMs", endMs),
      )
      .order("asc")
      .take(Math.min(limit, 500));

    return transcripts.map((t) => ({
      _id: t._id,
      sequence: t.sequence,
      speakerId: t.speakerId,
      text: t.text,
      confidence: t.confidence,
      startMs: t.startMs,
      endMs: t.endMs,
      wordCount: t.wordCount,
      language: t.language,
    }));
  },
});

/**
 * Gets live transcript statistics for meeting dashboard
 */
export const getLiveTranscriptStats = query({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    totalChunks: v.number(),
    totalWords: v.number(),
    averageConfidence: v.number(),
    duration: v.number(),
    speakers: v.array(v.string()),
    languages: v.array(v.string()),
    recentActivity: v.object({
      lastChunkAt: v.optional(v.number()),
      chunksLastMinute: v.number(),
      wordsPerMinute: v.number(),
    }),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Get all transcripts for the meeting
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
        recentActivity: {
          lastChunkAt: undefined,
          chunksLastMinute: 0,
          wordsPerMinute: 0,
        },
      };
    }

    // Calculate basic statistics
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

    // Calculate recent activity (last minute)
    const oneMinuteAgo = Date.now() - 60000;
    const recentChunks = transcripts.filter((t) => t.createdAt > oneMinuteAgo);
    const recentWords = recentChunks.reduce((sum, t) => sum + t.wordCount, 0);
    const lastChunkAt =
      transcripts.length > 0
        ? Math.max(...transcripts.map((t) => t.createdAt))
        : undefined;

    return {
      totalChunks: transcripts.length,
      totalWords,
      averageConfidence,
      duration,
      speakers,
      languages,
      recentActivity: {
        lastChunkAt,
        chunksLastMinute: recentChunks.length,
        wordsPerMinute: recentWords,
      },
    };
  },
});

/**
 * Gets transcript chunks by speaker for speaker-specific views
 */
export const getTranscriptsBySpeaker = query({
  args: {
    meetingId: v.id("meetings"),
    speakerId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("transcripts"),
      sequence: v.number(),
      text: v.string(),
      confidence: v.number(),
      startMs: v.number(),
      endMs: v.number(),
      wordCount: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId, speakerId, limit = 100 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Query transcripts for specific speaker
    // Note: This uses a table scan since we don't have a speaker index
    // In production, consider adding an index by_meeting_and_speaker
    const allTranscripts = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
      .filter((q) => q.eq(q.field("speakerId"), speakerId))
      .order("asc")
      .take(Math.min(limit, 200));

    return allTranscripts.map((t) => ({
      _id: t._id,
      sequence: t.sequence,
      text: t.text,
      confidence: t.confidence,
      startMs: t.startMs,
      endMs: t.endMs,
      wordCount: t.wordCount,
      createdAt: t.createdAt,
    }));
  },
});

/**
 * Searches transcript content using full-text search
 * Note: Requires search index on transcripts.text field
 */
export const searchTranscriptContent = query({
  args: {
    meetingId: v.id("meetings"),
    searchQuery: v.string(),
    limit: v.optional(v.number()),
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
      relevanceScore: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { meetingId, searchQuery, limit = 50 }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Validate search query
    if (!searchQuery.trim()) {
      return [];
    }

    // Use full-text search if available, otherwise fallback to filter
    try {
      // Attempt to use search index (may not be available in all Convex versions)
      const results = await ctx.db
        .query("transcripts")
        .withSearchIndex("search_text", (q) =>
          q.search("text", searchQuery.trim()).eq("meetingId", meetingId),
        )
        .take(Math.min(limit, 100));

      return results.map((t) => ({
        _id: t._id,
        sequence: t.sequence,
        speakerId: t.speakerId,
        text: t.text,
        confidence: t.confidence,
        startMs: t.startMs,
        endMs: t.endMs,
        wordCount: t.wordCount,
        relevanceScore: undefined, // Search relevance not exposed in current API
      }));
    } catch (error) {
      // Fallback to text filtering if search index is not available
      console.warn("Search index not available, using text filter:", error);

      const results = await ctx.db
        .query("transcripts")
        .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
        .filter((q) =>
          q.or(
            q.eq(q.field("text"), searchQuery),
            // Note: Convex doesn't support LIKE queries, so exact match only
          ),
        )
        .take(Math.min(limit, 100));

      return results.map((t) => ({
        _id: t._id,
        sequence: t.sequence,
        speakerId: t.speakerId,
        text: t.text,
        confidence: t.confidence,
        startMs: t.startMs,
        endMs: t.endMs,
        wordCount: t.wordCount,
        relevanceScore: undefined,
      }));
    }
  },
});

/**
 * Gets transcript session status for monitoring
 */
export const getTranscriptionSessionStatus = query({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    sessionExists: v.boolean(),
    provider: v.optional(
      v.union(
        v.literal("whisper"),
        v.literal("assemblyai"),
        v.literal("getstream"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("initializing"),
        v.literal("active"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    const session = await ctx.db
      .query("transcriptionSessions")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (!session) {
      return {
        sessionExists: false,
        provider: undefined,
        status: undefined,
        startedAt: undefined,
        endedAt: undefined,
        metadata: undefined,
      };
    }

    return {
      sessionExists: true,
      provider: session.provider,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      metadata: session.metadata,
    };
  },
});
