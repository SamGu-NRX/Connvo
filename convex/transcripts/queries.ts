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
    return await ctx.db
      .query("transcriptSegments")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .order("asc")
      .take(limit);
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
      meetingId: v.id("meetings"),
      bucketMs: v.number(),
      sequence: v.number(),
      speakerId: v.optional(v.string()),
      text: v.string(),
      confidence: v.number(),
      startMs: v.number(),
      endMs: v.number(),
      isInterim: v.optional(v.boolean()),
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
