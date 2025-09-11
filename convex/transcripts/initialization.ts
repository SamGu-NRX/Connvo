/**
 * Transcription Initialization and Management
 *
 * This module handles transcription setup for meetings, supporting both
 * free tier (external API) and paid tier (GetStream) transcription.
 *
 * Requirements: 7.1, 7.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

/**
 * Initializes transcription for a meeting
 */
export const initializeTranscription = internalAction({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    transcriptionProvider: v.union(
      v.literal("whisper"),
      v.literal("assemblyai"),
      v.literal("getstream"),
    ),
  }),
  handler: async (ctx, { meetingId }) => {
    try {
      // Get meeting details
      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting) {
        console.error(
          "Meeting not found for transcription initialization:",
          meetingId,
        );
        return { success: false, transcriptionProvider: "whisper" };
      }

      // Determine transcription provider based on meeting configuration
      const transcriptionProvider = meeting.webrtcEnabled
        ? "whisper"
        : "getstream";

      // Create transcription session record
      await ctx.runMutation(
        internal.transcripts.initialization.createTranscriptionSession,
        {
          meetingId,
          provider: transcriptionProvider,
        },
      );

      console.log(
        `Initialized ${transcriptionProvider} transcription for meeting ${meetingId}`,
      );

      return {
        success: true,
        transcriptionProvider,
      };
    } catch (error) {
      console.error("Failed to initialize transcription:", error);
      return { success: false, transcriptionProvider: "whisper" };
    }
  },
});

/**
 * Creates a transcription session record
 */
export const createTranscriptionSession = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    provider: v.union(
      v.literal("whisper"),
      v.literal("assemblyai"),
      v.literal("getstream"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, provider }) => {
    // Create transcription session metadata
    await ctx.db.insert("transcriptionSessions", {
      meetingId,
      provider,
      status: "initializing",
      startedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Updates transcription session status
 */
export const updateTranscriptionStatus = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    status: v.union(
      v.literal("initializing"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, status, metadata }) => {
    const session = await ctx.db
      .query("transcriptionSessions")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (session) {
      await ctx.db.patch(session._id, {
        status,
        metadata,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Processes transcription chunk from external provider
 */
export const processTranscriptionChunk = internalAction({
  args: {
    meetingId: v.id("meetings"),
    chunk: v.object({
      text: v.string(),
      confidence: v.number(),
      startTime: v.number(),
      endTime: v.number(),
      speakerId: v.optional(v.string()),
      language: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, chunk }) => {
    try {
      // Store transcription chunk using existing ingestion system
      await ctx.runMutation(
        internal.transcripts.ingestion.ingestTranscriptChunk,
        {
          meetingId,
          speakerId: chunk.speakerId,
          text: chunk.text,
          confidence: chunk.confidence,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          language: chunk.language,
        },
      );

      console.log(`Processed transcription chunk for meeting ${meetingId}`);
    } catch (error) {
      console.error("Failed to process transcription chunk:", error);
    }

    return null;
  },
});

/**
 * Finalizes transcription session when meeting ends
 */
export const finalizeTranscription = internalAction({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    totalChunks: v.number(),
  }),
  handler: async (ctx, { meetingId }) => {
    try {
      // Update session status
      await ctx.runMutation(
        internal.transcripts.initialization.updateTranscriptionStatus,
        {
          meetingId,
          status: "completed",
        },
      );

      // Count total transcript chunks via internal query
      const total = await ctx.runQuery(
        internal.transcripts.ingestion.countTranscriptsForMeeting,
        { meetingId },
      );

      // Schedule transcript aggregation
      await ctx.scheduler.runAfter(
        5000, // 5 second delay
        internal.transcripts.aggregation.aggregateTranscriptSegments,
        { meetingId },
      );

      console.log(
        `Finalized transcription for meeting ${meetingId} with ${total} chunks`,
      );

      return {
        success: true,
        totalChunks: total,
      };
    } catch (error) {
      console.error("Failed to finalize transcription:", error);
      return { success: false, totalChunks: 0 };
    }
  },
});
