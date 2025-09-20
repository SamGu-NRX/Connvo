/**
 * Transcript Query Functions (Minimal for Insights)
 *
 * This module provides basic transcript queries needed for insights generation.
 * Full transcript functionality is implemented in other tasks.
 */

import { internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import {
  TranscriptV,
  TranscriptSegmentV,
} from "@convex/types/validators/transcript";
import type {
  TranscriptSegment,
  TranscriptChunk,
} from "@convex/types/entities/transcript";

/**
 * Gets transcript segments for a meeting (internal use)
 */
export const getTranscriptSegments = internalQuery({
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
 * Internal: List transcripts after a given sequence for a meeting
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
