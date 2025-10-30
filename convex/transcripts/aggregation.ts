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
 * @summary Clears existing transcript segments for a meeting
 * @description Internal mutation that deletes all transcript segments for a specific
 * meeting. Used before re-aggregation to ensure idempotency and prevent duplicate
 * segments. Returns the count of deleted segments. Called by aggregation action
 * before processing new segments.
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
 *   "value": 42
 * }
 * ```
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
 * @summary Inserts a batch of transcript segments
 * @description Internal mutation that writes multiple processed transcript segments
 * to the database in a single transaction. Each segment includes time range, speaker
 * IDs, aggregated text, extracted topics, and optional sentiment scores. Used by
 * aggregation action to efficiently store processed segments. Returns count of
 * inserted segments.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "segments": [
 *       {
 *         "startMs": 1698765432000,
 *         "endMs": 1698765445000,
 *         "speakers": ["user_alice_123"],
 *         "text": "Let's discuss the Q4 roadmap priorities and action items.",
 *         "topics": ["action", "plan"],
 *         "sentiment": 0.75
 *       },
 *       {
 *         "startMs": 1698765446000,
 *         "endMs": 1698765458000,
 *         "speakers": ["user_bob_456"],
 *         "text": "I agree. We should set a deadline for the feature freeze.",
 *         "topics": ["deadline", "decision"],
 *         "sentiment": 0.65
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": 2
 * }
 * ```
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
 * @summary Aggregates raw transcript chunks into searchable segments
 * @description Internal action that processes all transcript chunks for a meeting and
 * creates coalesced segments grouped by speaker and time proximity (5-second gap
 * threshold). Extracts topics using keyword matching, skips interim results, and
 * creates audit log entries. Clears existing segments first for idempotency. Used
 * after meeting completion to prepare transcripts for search and insights generation.
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
 *     "success": true,
 *     "segmentsCreated": 47
 *   }
 * }
 * ```
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
 * @summary Cleans up old transcript segments for data retention
 * @description Internal maintenance mutation that removes transcript segments older
 * than the specified retention period (default 365 days). Creates audit log entries
 * for compliance tracking. Used by scheduled maintenance jobs to manage storage
 * costs while maintaining longer retention than raw chunks.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "olderThanMs": 31536000000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "deleted": 1847
 *   }
 * }
 * ```
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
