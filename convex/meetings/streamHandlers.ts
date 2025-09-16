/**
 * GetStream Webhook Handlers (V8 runtime)
 *
 * This file contains internal mutations that process webhook payloads and
 * update Convex state. It must NOT use Node.js APIs and must NOT include
 * the "use node" directive so that mutations can run in Convex's V8 runtime.
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";

// Shared validator for webhook event payloads covering only the fields we read.
const streamEventDataV = v.object({
  call: v.optional(
    v.object({
      id: v.string(),
    }),
  ),
  call_session: v.optional(
    v.object({
      id: v.string(),
      duration_ms: v.optional(v.number()),
    }),
  ),
  user: v.optional(
    v.object({
      id: v.string(),
    }),
  ),
  call_recording: v.optional(
    v.object({
      id: v.string(),
      url: v.optional(v.string()),
    }),
  ),
});

export const handleCallSessionStarted = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const sessionId = data.call_session?.id;

      if (!callId) {
        console.warn("Call session started webhook missing call ID");
        return { success: false };
      }

      const meeting = await ctx.db
        .query("meetings")
        .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      await ctx.db.patch(meeting._id, {
        state: "active",
        updatedAt: Date.now(),
      });

      const meetingState = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();

      if (meetingState) {
        await ctx.db.patch(meetingState._id, {
          active: true,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      console.log(`GetStream call session started for meeting ${meeting._id}`);
      return { success: true };
    } catch (error) {
      console.error("Failed to handle call session started:", error);
      return { success: false };
    }
  },
});

export const handleCallSessionEnded = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const sessionId = data.call_session?.id;
      const duration = data.call_session?.duration_ms;

      if (!callId) {
        console.warn("Call session ended webhook missing call ID");
        return { success: false };
      }

      const meeting = await ctx.db
        .query("meetings")
        .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      await ctx.db.patch(meeting._id, {
        state: "concluded",
        updatedAt: Date.now(),
      });

      const meetingState = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();

      if (meetingState) {
        await ctx.db.patch(meetingState._id, {
          active: false,
          endedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      await ctx.scheduler.runAfter(
        5000,
        internal.meetings.postProcessing.handleMeetingEnd,
        { meetingId: meeting._id, endedAt: Date.now() },
      );

      console.log(
        `GetStream call session ended for meeting ${meeting._id}, duration: ${duration}ms`,
      );
      return { success: true };
    } catch (error) {
      console.error("Failed to handle call session ended:", error);
      return { success: false };
    }
  },
});

export const handleMemberJoined = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const userId = data.user?.id;
      const sessionId = data.call_session?.id;

      if (!callId || !userId) {
        console.warn("Member joined webhook missing call ID or user ID");
        return { success: false };
      }

      const [meeting, user] = await Promise.all([
        ctx.db
          .query("meetings")
          .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
          .unique(),
        ctx.db
          .query("users")
          .withIndex("by_workos_id", (q) => q.eq("workosUserId", userId))
          .unique(),
      ]);

      if (!meeting || !user) {
        console.warn(
          `Meeting or user not found for GetStream member joined event`,
        );
        return { success: false };
      }

      const participant = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_user", (q) =>
          q.eq("meetingId", meeting._id).eq("userId", user._id),
        )
        .unique();

      if (participant) {
        await ctx.db.patch(participant._id, {
          presence: "joined",
          joinedAt: Date.now(),
        });
      }

      console.log(`User ${userId} joined GetStream call ${callId}`);
      return { success: true };
    } catch (error) {
      console.error("Failed to handle member joined:", error);
      return { success: false };
    }
  },
});

export const handleMemberLeft = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const userId = data.user?.id;

      if (!callId || !userId) {
        console.warn("Member left webhook missing call ID or user ID");
        return { success: false };
      }

      const [meeting, user] = await Promise.all([
        ctx.db
          .query("meetings")
          .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
          .unique(),
        ctx.db
          .query("users")
          .withIndex("by_workos_id", (q) => q.eq("workosUserId", userId))
          .unique(),
      ]);

      if (!meeting || !user) {
        console.warn(
          `Meeting or user not found for GetStream member left event`,
        );
        return { success: false };
      }

      const participant = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_user", (q) =>
          q.eq("meetingId", meeting._id).eq("userId", user._id),
        )
        .unique();

      if (participant) {
        await ctx.db.patch(participant._id, {
          presence: "left",
          leftAt: Date.now(),
        });
      }

      console.log(`User ${userId} left GetStream call ${callId}`);
      return { success: true };
    } catch (error) {
      console.error("Failed to handle member left:", error);
      return { success: false };
    }
  },
});

export const handleRecordingStarted = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const recordingId = data.call_recording?.id;

      if (!callId || !recordingId) {
        console.warn(
          "Recording started webhook missing call ID or recording ID",
        );
        return { success: false };
      }

      const meeting = await ctx.db
        .query("meetings")
        .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      const meetingState = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();

      if (meetingState) {
        await ctx.db.patch(meetingState._id, {
          recordingEnabled: true,
          updatedAt: Date.now(),
        });
      }

      console.log(
        `Recording ${recordingId} started for GetStream call ${callId}`,
      );
      return { success: true };
    } catch (error) {
      console.error("Failed to handle recording started:", error);
      return { success: false };
    }
  },
});

export const handleRecordingStopped = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const recordingId = data.call_recording?.id;

      if (!callId || !recordingId) {
        console.warn(
          "Recording stopped webhook missing call ID or recording ID",
        );
        return { success: false };
      }

      const meeting = await ctx.db
        .query("meetings")
        .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      const meetingState = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();

      if (meetingState) {
        await ctx.db.patch(meetingState._id, {
          recordingEnabled: false,
          updatedAt: Date.now(),
        });
      }

      console.log(
        `Recording ${recordingId} stopped for GetStream call ${callId}`,
      );
      return { success: true };
    } catch (error) {
      console.error("Failed to handle recording stopped:", error);
      return { success: false };
    }
  },
});

export const handleRecordingReady = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const recordingId = data.call_recording?.id;
      const recordingUrl = data.call_recording?.url;

      if (!callId || !recordingId) {
        console.warn("Recording ready webhook missing call ID or recording ID");
        return { success: false };
      }

      const meeting = await ctx.db
        .query("meetings")
        .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      await ctx.db.insert("meetingRecordings", {
        meetingId: meeting._id,
        recordingId,
        recordingUrl,
        provider: "getstream",
        status: "ready",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      console.log(
        `Recording ${recordingId} ready for GetStream call ${callId}, URL: ${recordingUrl}`,
      );
      return { success: true };
    } catch (error) {
      console.error("Failed to handle recording ready:", error);
      return { success: false };
    }
  },
});

export const handleTranscriptionStarted = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;

      if (!callId) {
        console.warn("Transcription started webhook missing call ID");
        return { success: false };
      }

      const meeting = await ctx.db
        .query("meetings")
        .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      const transcriptionSession = await ctx.db
        .query("transcriptionSessions")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();

      if (transcriptionSession) {
        await ctx.db.patch(transcriptionSession._id, {
          status: "active",
          updatedAt: Date.now(),
        });
      }

      console.log(`Transcription started for GetStream call ${callId}`);
      return { success: true };
    } catch (error) {
      console.error("Failed to handle transcription started:", error);
      return { success: false };
    }
  },
});

export const handleTranscriptionStopped = internalMutation({
  args: { data: streamEventDataV },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;

      if (!callId) {
        console.warn("Transcription stopped webhook missing call ID");
        return { success: false };
      }

      const meeting = await ctx.db
        .query("meetings")
        .withIndex("by_stream_room_id", (q) => q.eq("streamRoomId", callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      const transcriptionSession = await ctx.db
        .query("transcriptionSessions")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();

      if (transcriptionSession) {
        await ctx.db.patch(transcriptionSession._id, {
          status: "completed",
          endedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      console.log(`Transcription stopped for GetStream call ${callId}`);
      return { success: true };
    } catch (error) {
      console.error("Failed to handle transcription stopped:", error);
      return { success: false };
    }
  },
});
