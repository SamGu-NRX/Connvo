/**
 * Transcript Query Functions (Minimal for Insights)
 *
 * This module provides basic transcript queries needed for insights generation.
 * Full transcript functionality is implemented in other tasks.
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "@convex/auth/guards";
import {
  TranscriptV,
  TranscriptSegmentV,
} from "@convex/types/validators/transcript";
import type {
  TranscriptSegment,
  TranscriptChunk,
} from "@convex/types/entities/transcript";

/**
 * Gets transcript segments for a meeting (public, with auth)
 */
export const getTranscriptSegments = query({
  args: {
    meetingId: v.id("meetings"),
    limit: v.optional(v.number()),
  },
  returns: v.array(TranscriptSegmentV.full),
  handler: async (
    ctx,
    { meetingId, limit = 100 },
  ): Promise<TranscriptSegment[]> => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const take = Math.max(1, Math.min(Math.floor(limit ?? 100), 1000));
    const docs = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .order("asc")
      .take(take);
    return docs.map((d) => ({
      _id: d._id,
      _creationTime: d._creationTime,
      meetingId: d.meetingId,
      startMs: d.startMs,
      endMs: d.endMs,
      speakers: d.speakers ?? [],
      text: d.text ?? "",
      topics: d.topics ?? [],
      sentiment: d.sentiment,
      createdAt: d.createdAt ?? d._creationTime,
    }));
  },
});

/**
 * @summary Gets aggregated transcript segments for a meeting
 * @description Internal query that retrieves processed transcript segments (coalesced
 * chunks grouped by speaker and topic). Returns segments with speaker IDs, text,
 * topics, sentiment scores, and time ranges. Used by insights generation and search
 * features. Supports pagination with configurable limits (max 1000 per request).
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "limit": 100
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
 *       "_creationTime": 1698765434100,
 *       "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *       "startMs": 1698765432000,
 *       "endMs": 1698765445000,
 *       "speakers": ["user_alice_123"],
 *       "text": "Let's discuss the Q4 roadmap priorities and action items.",
 *       "topics": ["action", "plan"],
 *       "sentiment": 0.75,
 *       "createdAt": 1698765445100
 *     },
 *     {
 *       "_id": "jh8xzqn8h9p2v4k5m6n7p8r2",
 *       "_creationTime": 1698765450100,
 *       "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *       "startMs": 1698765446000,
 *       "endMs": 1698765458000,
 *       "speakers": ["user_bob_456"],
 *       "text": "I agree. We should set a deadline for the feature freeze.",
 *       "topics": ["deadline", "decision"],
 *       "sentiment": 0.65,
 *       "createdAt": 1698765458100
 *     }
 *   ]
 * }
 * ```
 */
export const getTranscriptSegmentsInternal = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    limit: v.optional(v.number()),
  },
  returns: v.array(TranscriptSegmentV.full),
  handler: async (
    ctx,
    { meetingId, limit = 100 },
  ): Promise<TranscriptSegment[]> => {
    const take = Math.max(1, Math.min(Math.floor(limit ?? 100), 1000));
    const docs = await ctx.db
      .query("transcriptSegments")
      // Prefer an index keyed by time for deterministic ordering:
      // .withIndex("by_meeting_startMs", (q) => q.eq("meetingId", meetingId))
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .order("asc")
      .take(take);
    return docs.map((d) => ({
      _id: d._id,
      _creationTime: d._creationTime,
      meetingId: d.meetingId,
      startMs: d.startMs,
      endMs: d.endMs,
      speakers: d.speakers ?? [],
      text: d.text ?? "",
      topics: d.topics ?? [],
      sentiment: d.sentiment,
      createdAt: d.createdAt ?? d._creationTime,
    }));
  },
});

/**
 * @summary Lists transcript chunks after a given sequence number
 * @description Internal query that retrieves raw transcript chunks starting from a
 * specific sequence number. Used for incremental processing during aggregation and
 * streaming operations. Returns chunks in ascending sequence order with configurable
 * pagination (max 1000 per request). Includes all chunk metadata (speaker, text,
 * confidence, timing, word count).
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "fromSequence": 42,
 *     "limit": 100
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
 *       "_creationTime": 1698765434100,
 *       "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *       "bucketMs": 1698765300000,
 *       "sequence": 43,
 *       "speakerId": "user_alice_123",
 *       "text": "Let's discuss the roadmap.",
 *       "confidence": 0.92,
 *       "startMs": 1698765432000,
 *       "endMs": 1698765435000,
 *       "isInterim": false,
 *       "wordCount": 4,
 *       "language": "en",
 *       "createdAt": 1698765435100
 *     },
 *     {
 *       "_id": "jh8xzqn8h9p2v4k5m6n7p8r2",
 *       "_creationTime": 1698765437100,
 *       "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *       "bucketMs": 1698765300000,
 *       "sequence": 44,
 *       "speakerId": "user_bob_456",
 *       "text": "Sounds good to me.",
 *       "confidence": 0.89,
 *       "startMs": 1698765436000,
 *       "endMs": 1698765438000,
 *       "isInterim": false,
 *       "wordCount": 4,
 *       "language": "en",
 *       "createdAt": 1698765438100
 *     }
 *   ]
 * }
 * ```
 */
export const listTranscriptsAfterSequence = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.number(),
    limit: v.number(),
  },
  returns: v.array(TranscriptV.full),
  handler: async (ctx, { meetingId, fromSequence, limit }) => {
    const take = Math.max(1, Math.min(Math.floor(limit), 1000));
    const docs = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId).gt("sequence", fromSequence),
      )
      .order("asc")
      .take(take);

    // Return full transcript entities with proper type safety
    return docs;
  },
});
