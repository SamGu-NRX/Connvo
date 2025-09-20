/**
 * Transcript Aggregation Actions
 *
 * This module handles transcript processing and segment creation.
 * This is a placeholder implementation for task 6.
 *
 * Requirements: 7.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

import { internalAction, internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { internal } from "@convex/_generated/api";
import { metadataRecordV } from "@convex/lib/validators";

/**
 * Internal: Clears existing segments for a meeting (idempotent pre-aggregation)
 */
export const clearTranscriptSegmentsForMeeting = internalMutation({
  args: { meetingId: v.id("meetings") },
  returns: v.number(),
  handler: async (ctx, { meetingId }) => {
    const existing = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    for (const seg of existing) {
      await ctx.db.delete(seg._id);
    }
    return existing.length;
  },
});

/**
 * Internal: Inserts a batch of transcript segments
 */
export const writeTranscriptSegmentsBatch = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    segments: v.array(
      v.object({
        startMs: v.number(),
        endMs: v.number(),
        speakers: v.array(v.string()),
        text: v.string(),
        topics: v.array(v.string()),
        sentiment: v.optional(v.number()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { meetingId, segments }) => {
    let inserted = 0;
    for (const s of segments) {
      await ctx.db.insert("transcriptSegments", {
        meetingId,
        startMs: s.startMs,
        endMs: s.endMs,
        speakers: s.speakers,
        text: s.text,
        topics: s.topics,
        sentiment: s.sentiment,
        createdAt: Date.now(),
      });
      inserted++;
    }
    return inserted;
  },
});

/**
 * Aggregates transcript chunks into searchable segments
 */
export const aggregateTranscriptSegments = internalAction({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    segmentsCreated: v.number(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Clear existing segments first for idempotency
    await ctx.runMutation(
      internal.transcripts.aggregation.clearTranscriptSegmentsForMeeting,
      { meetingId },
    );

    // Iterate through transcripts in batches by sequence
    const BATCH = 500;
    let cursor = 0;
    let totalInserted = 0;

    // Simple topic extraction stub: split by keywords; can be replaced with AI later
    const extractTopics = (text: string): string[] => {
      const topics = new Set<string>();
      const keywords = [
        "action",
        "follow-up",
        "deadline",
        "risk",
        "plan",
        "decision",
        "owner",
      ];
      for (const k of keywords) {
        if (text.toLowerCase().includes(k)) topics.add(k);
      }
      return Array.from(topics);
    };

    // Coalescing strategy: group contiguous chunks from same speaker with short gaps (<= 5s)
    const GAP_MS = 5000;

    while (true) {
      const batch = await ctx.runQuery(
        internal.transcripts.queries.listTranscriptsAfterSequence,
        { meetingId, fromSequence: cursor, limit: BATCH },
      );
      if (batch.length === 0) break;

      // Build segments
      const segments: Array<{
        startMs: number;
        endMs: number;
        speakers: string[];
        text: string;
        topics: string[];
        sentiment?: number;
      }> = [];

      let current: {
        startMs: number;
        endMs: number;
        speakers: string[];
        text: string;
      } | null = null;
      let currentSpeaker: string | undefined = undefined;

      for (const t of batch) {
        // Skip interim chunks; only finalize on stable text
        if (t.isInterim) {
          cursor = t.sequence;
          continue;
        }

        if (!current) {
          current = {
            startMs: t.startMs,
            endMs: t.endMs,
            speakers: t.speakerId ? [t.speakerId] : [],
            text: t.text,
          };
          currentSpeaker = t.speakerId;
        } else {
          const sameSpeaker = t.speakerId === currentSpeaker;
          const smallGap = t.startMs - current.endMs <= GAP_MS;
          if (sameSpeaker && smallGap) {
            current.endMs = t.endMs;
            current.text = `${current.text} ${t.text}`;
          } else {
            const topics = extractTopics(current.text);
            segments.push({
              startMs: current.startMs,
              endMs: current.endMs,
              speakers: current.speakers,
              text: current.text,
              topics,
            });
            current = {
              startMs: t.startMs,
              endMs: t.endMs,
              speakers: t.speakerId ? [t.speakerId] : [],
              text: t.text,
            };
            currentSpeaker = t.speakerId;
          }
        }
        cursor = t.sequence;
      }

      if (current) {
        const topics = extractTopics(current.text);
        segments.push({
          startMs: current.startMs,
          endMs: current.endMs,
          speakers: current.speakers,
          text: current.text,
          topics,
        });
      }

      if (segments.length > 0) {
        const inserted = await ctx.runMutation(
          internal.transcripts.aggregation.writeTranscriptSegmentsBatch,
          { meetingId, segments },
        );
        totalInserted += inserted;
      }
    }

    // Audit log
    await ctx.runMutation(internal.audit.logging.createAuditLog, {
      actorUserId: undefined,
      resourceType: "transcripts",
      resourceId: String(meetingId),
      action: "aggregate_segments",
      category: "transcription",
      success: true,
      metadata: { segmentsCreated: totalInserted },
    });

    return { success: true, segmentsCreated: totalInserted };
  },
});

/**
 * Internal: Cleanup old transcript segments (default 365 days)
 */
export const cleanupOldTranscriptSegments = internalMutation({
  args: { olderThanMs: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, { olderThanMs = 365 * 24 * 60 * 60 * 1000 }) => {
    const cutoff = Date.now() - olderThanMs;
    const old = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_created_at", (q) => q.lt("createdAt", cutoff))
      .collect();
    for (const seg of old) {
      await ctx.db.delete(seg._id);
    }
    // Audit log (best-effort)
    try {
      await ctx.runMutation(internal.audit.logging.createAuditLog, {
        actorUserId: undefined,
        resourceType: "transcriptSegments",
        resourceId: "*",
        action: "cleanup_segments",
        category: "transcription",
        success: true,
        metadata: { deleted: old.length, olderThanMs },
      });
    } catch (e) {
      console.warn("Failed to log transcript segments cleanup audit", e);
    }
    return { deleted: old.length };
  },
});
