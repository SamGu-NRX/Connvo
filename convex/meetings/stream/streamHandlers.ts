/**
 * GetStream Webhook Handlers (V8 runtime)
 *
 * This file contains internal mutations that process webhook payloads and
 * update Convex state. It must NOT use Node.js APIs and must NOT include
 * the "use node" directive so that mutations can run in Convex's V8 runtime.
 */

import { internalMutation } from "@convex/_generated/server";
import type { MutationCtx } from "@convex/_generated/server";
import { withIdempotency } from "@convex/lib/idempotency";
import { internal } from "@convex/_generated/api";
import {
  StreamApiResponseV,
  StreamWebhookPayloadV,
} from "@convex/types/validators/stream";
import type {
  StreamSimpleSuccess,
  StreamWebhookPayload,
} from "@convex/types/entities/stream";

type StreamWebhookArgs = { data: StreamWebhookPayload };

export const handleCallSessionStarted = internalMutation({
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
        console.warn(`No meeting found for GetStream call ${callId}; nothing to apply`);
        // Ack the delivery: Stream maps webhook URLs per-app, so an unmapped
        // call is expected traffic, not a transient failure. Returning failure
        // here makes Stream retry the event forever.
        return { success: true };
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
        console.warn(`No meeting found for GetStream call ${callId}; nothing to apply`);
        // Ack the delivery: Stream maps webhook URLs per-app, so an unmapped
        // call is expected traffic, not a transient failure. Returning failure
        // here makes Stream retry the event forever.
        return { success: true };
      }

      // Idempotence beyond the event-dedupe key: a duplicate session_ended
      // that survives key expiry (or a second end event) must not re-schedule
      // post-processing. The concluded state is the durable transition marker.
      if (meeting.state === "concluded") {
        console.log(
          `Meeting ${meeting._id} already concluded; skipping duplicate session_ended`,
        );
        return { success: true };
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
        console.warn(`No meeting found for GetStream call ${callId}; nothing to apply`);
        // Ack the delivery: Stream maps webhook URLs per-app, so an unmapped
        // call is expected traffic, not a transient failure. Returning failure
        // here makes Stream retry the event forever.
        return { success: true };
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
        console.warn(`No meeting found for GetStream call ${callId}; nothing to apply`);
        // Ack the delivery: Stream maps webhook URLs per-app, so an unmapped
        // call is expected traffic, not a transient failure. Returning failure
        // here makes Stream retry the event forever.
        return { success: true };
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
        console.warn(`No meeting found for GetStream call ${callId}; nothing to apply`);
        // Ack the delivery: Stream maps webhook URLs per-app, so an unmapped
        // call is expected traffic, not a transient failure. Returning failure
        // here makes Stream retry the event forever.
        return { success: true };
      }

      const existing = await ctx.db
        .query("meetingRecordings")
        .withIndex("by_recording_id", (q) => q.eq("recordingId", recordingId))
        .unique();

      if (existing) {
        // Stream redelivers recording_ready; update in place instead of
        // inserting a duplicate recording row.
        await ctx.db.patch(existing._id, {
          recordingUrl,
          status: "ready",
          updatedAt: Date.now(),
        });
        console.log(
          `Recording ${recordingId} already present for meeting ${meeting._id}; updated in place`,
        );
        return { success: true };
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: StreamWebhookArgs,
  ): Promise<StreamSimpleSuccess> => {
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
        console.warn(`No meeting found for GetStream call ${callId}; nothing to apply`);
        // Ack the delivery: Stream maps webhook URLs per-app, so an unmapped
        // call is expected traffic, not a transient failure. Returning failure
        // here makes Stream retry the event forever.
        return { success: true };
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
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data },
  ): Promise<StreamSimpleSuccess> => {
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
        console.warn(`No meeting found for GetStream call ${callId}; nothing to apply`);
        // Ack the delivery: Stream maps webhook URLs per-app, so an unmapped
        // call is expected traffic, not a transient failure. Returning failure
        // here makes Stream retry the event forever.
        return { success: true };
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

/**
 * Route a verified webhook event to its handler. Unknown event types are
 * acknowledged so Stream stops retrying them.
 */
async function routeWebhookEvent(
  ctx: MutationCtx,
  data: StreamWebhookPayload,
): Promise<StreamSimpleSuccess> {
  switch (data.type) {
    case "call.session_started":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleCallSessionStarted,
        { data },
      );
    case "call.session_ended":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleCallSessionEnded,
        { data },
      );
    case "call.member_joined":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleMemberJoined,
        { data },
      );
    case "call.member_left":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleMemberLeft,
        { data },
      );
    case "call.recording_started":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleRecordingStarted,
        { data },
      );
    case "call.recording_stopped":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleRecordingStopped,
        { data },
      );
    case "call.recording_ready":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleRecordingReady,
        { data },
      );
    case "call.transcription_started":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleTranscriptionStarted,
        { data },
      );
    case "call.transcription_stopped":
      return ctx.runMutation(
        internal.meetings.stream.streamHandlers.handleTranscriptionStopped,
        { data },
      );
    default:
      console.log(`Unhandled GetStream webhook event: ${data.type}`);
      return { success: true };
  }
}

/**
 * Single transactional entry point for webhook delivery.
 *
 * Dedupes retries via withIdempotency keyed on the event's identity
 * (type + call/session/recording/user ids). The dedupe key insert and the
 * handler run in the SAME transaction, so a redelivered event either observes
 * the committed key and replays the stored result, or runs the handler exactly
 * once. The httpAction cannot hold this lock itself (no ctx.db), so it
 * delegates here.
 */
export const dispatchWebhook = internalMutation({
  args: { data: StreamWebhookPayloadV },
  returns: StreamApiResponseV.simpleSuccess,
  handler: async (
    ctx,
    { data }: { data: StreamWebhookPayload },
  ): Promise<StreamSimpleSuccess> => {
    const key = [
      data.type ?? "unknown",
      data.call?.id,
      data.call_session?.id,
      data.call_recording?.id,
      data.user?.id,
    ]
      .filter((part): part is string => part !== undefined)
      .join(":");

    const { isFirstExecution, result } = await withIdempotency(
      ctx,
      {
        key,
        scope: "stream_webhook",
        // Stream retries deliveries for up to ~72h; keep the dedupe window
        // beyond that so late redeliveries still hit the stored result.
        ttlMs: 7 * 24 * 60 * 60 * 1000,
        allowRetry: false,
      },
      () => routeWebhookEvent(ctx, data),
    );

    if (!isFirstExecution) {
      console.log(`GetStream webhook ${key} replayed (already processed)`);
    }
    return result ?? { success: true };
  },
});
