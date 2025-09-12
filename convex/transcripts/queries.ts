/**
 * Transcript Query Functions (Minimal for Insights)
 *
 * This module provides basic transcript queries needed for insights generation.
 * Full transcript functionality is implemented in other tasks.
 */

import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Gets transcript segments for a meeting (internal use)
 */
export const getTranscriptSegments = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("transcriptSegments"),
      meetingId: v.id("meetings"),
      startMs: v.number(),
      endMs: v.number(),
      speakers: v.array(v.string()),
      text: v.string(),
      topics: v.array(v.string()),
      sentiment: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId, limit = 100 }) => {
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
 * Internal: List transcripts after a given sequence for a meeting
 */
export const listTranscriptsAfterSequence = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.number(),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("transcripts"),
      handler: async (ctx, { meetingId, fromSequence, limit }) => {
        const take = Math.max(1, Math.min(Math.floor(limit), 1000));
        const docs = await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_sequence", (q) =>
            q.eq("meetingId", meetingId).gt("sequence", fromSequence),
          )
          .order("asc")
          .take(take);
        return docs.map((d) => ({
          _id: d._id,
          meetingId: d.meetingId,
          bucketMs: d.bucketMs,
          sequence: d.sequence,
          speakerId: d.speakerId,
          text: d.text,
          confidence: d.confidence,
          startMs: d.startMs,
          endMs: d.endMs,
          isInterim: d.isInterim,
          wordCount: d.wordCount,
          language: d.language,
          createdAt: d.createdAt ?? d._creationTime,
        }));
      },
      wordCount: v.number(),
      language: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId, fromSequence, limit }) => {
    const results = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
      .filter((q) => q.gt(q.field("sequence"), fromSequence))
      .order("asc")
      .take(Math.min(limit, 1000));
    return results;
  },
});
