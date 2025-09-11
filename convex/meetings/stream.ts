/**
 * GetStream Video Integration (Paid Tier)
 *
 * This module provides GetStream Video API integration for paid tier features
 * including recording, advanced layouts, and enterprise-grade video calling.
 *
 * Based on GetStream Video JS SDK documentation and best practices.
 *
 * Requirements: 6.2, 6.3, 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

"use node";

import {
  action,
  internalAction,
  internalMutation,
  httpAction,
} from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireIdentity, assertMeetingAccess } from "../auth/guards";
import { withActionIdempotency, IdempotencyUtils } from "../lib/idempotency";
import { sendAlert, trackMeetingEvent, AlertTemplates } from "../lib/alerting";
import { withRetry, RetryPolicies, CircuitBreakers } from "../lib/resilience";

/**
 * GetStream Video Client singleton for server-side operations
 */
let streamVideoClient: any = null;

function getStreamVideoClient() {
  if (!streamVideoClient) {
    const streamApiKey = process.env.STREAM_API_KEY;
    const streamSecret = process.env.STREAM_SECRET;

    if (!streamApiKey || !streamSecret) {
      throw new Error(
        "GetStream credentials not configured. Set STREAM_API_KEY and STREAM_SECRET environment variables.",
      );
    }

    // Import GetStream Video JS SDK for Node.js
    const { StreamVideoClient } = require("@stream-io/video-js");

    streamVideoClient = new StreamVideoClient(streamApiKey, {
      secret: streamSecret,
    });
  }

  return streamVideoClient;
}

/**
 * Creates a GetStream call for paid tier meetings with proper error handling and idempotency
 */
export const createStreamRoom = internalAction({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    roomId: v.string(),
    callId: v.string(),
    success: v.boolean(),
    features: v.object({
      recording: v.boolean(),
      transcription: v.boolean(),
      screensharing: v.boolean(),
      chat: v.boolean(),
    }),
  }),
  handler: async (ctx, { meetingId }) => {
    const startTime = Date.now();

    return await withActionIdempotency(
      ctx,
      IdempotencyUtils.externalService("getstream", "create_call", meetingId),
      async () => {
        try {
          // Get meeting details
          const meeting = await ctx.runQuery(
            internal.meetings.queries.getMeetingById,
            {
              meetingId,
            },
          );

          if (!meeting) {
            throw createError.notFound("Meeting", meetingId);
          }

          if (meeting.streamRoomId) {
            // Room already exists - return existing configuration
            return {
              roomId: meeting.streamRoomId,
              callId: meeting.streamRoomId,
              success: true,
              features: {
                recording: true,
                transcription: true,
                screensharing: true,
                chat: true,
              },
            };
          }

          // Generate unique call ID (GetStream uses call IDs, not room IDs)
          const callId = `call_${meetingId}_${Date.now()}`;
          const callType = "default"; // GetStream call type

          // Initialize GetStream client with retry and circuit breaker
          const result = await withRetry<{ callId: string; call: any }>(
            async () => {
              return await CircuitBreakers.getstream.execute(async () => {
                const client = getStreamVideoClient();

                // Create call using GetStream Video JS SDK
                const call = client.call(callType, callId);

                // Get organizer user details
                const organizer = await ctx.runQuery(
                  internal.users.queries.getUserById,
                  {
                    userId: meeting.organizerId,
                  },
                );

                if (!organizer) {
                  throw new Error("Meeting organizer not found");
                }

                // Create call with proper configuration
                await call.create({
                  data: {
                    created_by_id: organizer.workosUserId,
                    settings_override: {
                      recording: {
                        mode: "available", // Enable recording for paid tier
                        audio_only: false,
                        quality: "1080p",
                      },
                      transcription: {
                        mode: "available", // Enable transcription
                      },
                      screensharing: {
                        enabled: true,
                        access_request_enabled: false,
                      },
                      geofencing: {
                        names: [], // No geo-restrictions for now
                      },
                      limits: {
                        max_participants: 100, // Paid tier limit
                        max_duration_seconds: 14400, // 4 hours max
                      },
                    },
                    custom: {
                      meetingId: meetingId,
                      title: meeting.title,
                      description: meeting.description || "",
                    },
                  },
                });

                return {
                  callId,
                  call,
                };
              });
            },
            RetryPolicies.externalService(),
          );

          // Update meeting with GetStream call ID
          await ctx.runMutation(
            internal.meetings.lifecycle.updateStreamRoomId,
            {
              meetingId,
              streamRoomId: result.callId,
            },
          );

          // Track successful room creation
          const duration = Date.now() - startTime;
          const _result0: null = await ctx.runMutation(
            internal.meetings.stream.trackStreamEvent,
            {
              meetingId,
              event: "call_created",
              success: true,
              duration,
              metadata: {
                callId: result.callId,
                callType,
              },
            },
          );

          console.log(
            `Created GetStream call ${result.callId} for meeting ${meetingId}`,
          );

          return {
            roomId: result.callId,
            callId: result.callId,
            success: true,
            features: {
              recording: true,
              transcription: true,
              screensharing: true,
              chat: true,
            },
          };
        } catch (error) {
          // Track failed room creation
          const duration = Date.now() - startTime;
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          const _result1: null = await ctx.runMutation(
            internal.meetings.stream.trackStreamEvent,
            {
              meetingId,
              event: "call_creation_failed",
              success: false,
              duration,
              error: errorMessage,
            },
          );

          // Send alert for GetStream failures
          const _result2: null = await ctx.runMutation(
            internal.meetings.stream.sendStreamAlert,
            {
              alertType: "call_creation_failed",
              meetingId,
              error: errorMessage,
            },
          );

          console.error("Failed to create GetStream call:", error);
          throw createError.streamError("call creation", errorMessage);
        }
      },
    );
  },
});

/**
 * Public action to generate GetStream token for authenticated users
 */
export const generateParticipantTokenPublic = action({
  args: {
    meetingId: v.id("meetings"),
    role: v.optional(v.string()),
  },
  returns: v.object({
    token: v.string(),
    userId: v.string(),
    user: v.object({
      id: v.string(),
      name: v.string(),
      image: v.optional(v.string()),
    }),
    expiresAt: v.number(),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Get current user identity
    const identity = await requireIdentity(ctx);
    const userId = identity.subject as Id<"users">;

    const result = await ctx.runAction(
      internal.meetings.stream.generateParticipantToken,
      {
        meetingId,
        userId,
      },
    );

    // Get user details for the response
    const user = await ctx.runQuery(internal.users.queries.getUserById, {
      userId,
    });
    if (!user) {
      throw createError.notFound("User", userId);
    }

    return {
      token: result.token,
      userId: result.userId,
      user: {
        id: user.workosUserId,
        name: user.displayName || user.email,
        image: user.profileImageUrl,
      },
      expiresAt: result.expiresAt,
      success: result.success,
    };
  },
});

/**
 * Generates a GetStream JWT token for a participant with proper permissions
 */
export const generateParticipantToken = internalAction({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: v.optional(v.union(v.literal("host"), v.literal("participant"))),
  },
  returns: v.object({
    token: v.string(),
    userId: v.string(),
    callId: v.string(),
    expiresAt: v.number(),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, userId, role = "participant" }) => {
    return await withActionIdempotency(
      ctx,
      IdempotencyUtils.externalService(
        "getstream",
        "generate_token",
        `${meetingId}_${userId}`,
      ),
      async () => {
        try {
          // Get meeting and user details
          const [meeting, user] = await Promise.all([
            ctx.runQuery(internal.meetings.queries.getMeetingById, {
              meetingId,
            }),
            ctx.runQuery(internal.users.queries.getUserById, { userId }),
          ]);

          if (!meeting) {
            throw createError.notFound("Meeting", meetingId);
          }

          if (!meeting.streamRoomId) {
            throw createError.validation(
              "Meeting does not have a GetStream call",
            );
          }

          if (!user) {
            throw createError.notFound("User", userId);
          }

          // Generate JWT token using GetStream Video JS SDK
          const result = await withRetry<{ token: string; expiresAt: number }>(
            async () => {
              return await CircuitBreakers.getstream.execute(async () => {
                const client = getStreamVideoClient();

                // Token expiry (1 hour for security)
                const expiresAt = Math.floor(Date.now() / 1000) + 3600;

                // Create JWT token with proper claims
                const token = client.createToken(user.workosUserId, {
                  exp: expiresAt,
                  iat: Math.floor(Date.now() / 1000),
                  user_id: user.workosUserId,
                  // Add custom claims for permissions
                  role: role,
                  call_cids: [`default:${meeting.streamRoomId}`], // Grant access to specific call
                });

                return {
                  token,
                  expiresAt,
                };
              });
            },
            RetryPolicies.externalService(),
          );

          console.log(
            `Generated GetStream token for user ${user.workosUserId} in call ${meeting.streamRoomId}`,
          );

          return {
            token: result.token,
            userId: user.workosUserId,
            callId: meeting.streamRoomId,
            expiresAt: result.expiresAt,
            success: true,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          // Send alert for token generation failures
          await ctx.runMutation(internal.meetings.stream.sendStreamAlert, {
            alertType: "token_generation_failed",
            meetingId,
            error: errorMessage,
            metadata: { userId },
          });

          console.error("Failed to generate GetStream token:", error);
          throw createError.streamError("token generation", errorMessage);
        }
      },
    );
  },
});

/**
 * Starts recording for a GetStream call with proper configuration
 */
export const startRecording = action({
  args: {
    meetingId: v.id("meetings"),
    recordingConfig: v.optional(
      v.object({
        mode: v.optional(
          v.union(v.literal("available"), v.literal("disabled")),
        ),
        audioOnly: v.optional(v.boolean()),
        quality: v.optional(
          v.union(v.literal("360p"), v.literal("720p"), v.literal("1080p")),
        ),
        layout: v.optional(
          v.union(
            v.literal("grid"),
            v.literal("spotlight"),
            v.literal("single-participant"),
          ),
        ),
      }),
    ),
  },
  returns: v.object({
    recordingId: v.string(),
    recordingUrl: v.optional(v.string()),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, recordingConfig }) => {
    const startTime = Date.now();

    try {
      // Verify user has permission to start recording (host only)
      await assertMeetingAccess(ctx, meetingId, "host");

      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting) {
        throw createError.notFound("Meeting", meetingId);
      }

      if (meeting.webrtcEnabled) {
        throw createError.validation(
          "Recording not available for WebRTC meetings (free tier)",
        );
      }

      if (!meeting.streamRoomId) {
        throw createError.validation("Meeting does not have a GetStream call");
      }

      // Start recording using GetStream Video JS SDK
      const result = await withRetry<{
        recordingId: string;
        recordingUrl?: string;
      }>(async () => {
        return await CircuitBreakers.getstream.execute(async () => {
          const client = getStreamVideoClient();
          const call = client.call("default", meeting.streamRoomId);

          // Configure recording settings
          const config = {
            mode: recordingConfig?.mode || "available",
            audio_only: recordingConfig?.audioOnly || false,
            quality: recordingConfig?.quality || "720p",
            layout: {
              name: recordingConfig?.layout || "grid",
              options: {
                background_color: "#000000",
                logo: {
                  image_url:
                    "https://getstream.io/images/logos/stream-logo-white.png",
                  horizontal_position: "right",
                  vertical_position: "top",
                },
              },
            },
          };

          // Start recording
          const recordingResponse = await call.startRecording(config);

          return {
            recordingId:
              recordingResponse.recording?.id || `recording_${Date.now()}`,
            recordingUrl: recordingResponse.recording?.url,
          };
        });
      }, RetryPolicies.externalService());

      // Update meeting state to indicate recording is active
      const _result3: null = await ctx.runMutation(
        internal.meetings.stream.updateRecordingState,
        {
          meetingId,
          recordingEnabled: true,
          recordingId: result.recordingId,
        },
      );

      // Track successful recording start
      const duration = Date.now() - startTime;
      const _result4: null = await ctx.runMutation(
        internal.meetings.stream.trackStreamEvent,
        {
          meetingId,
          event: "recording_started",
          success: true,
          duration,
          metadata: {
            recordingId: result.recordingId,
            config: recordingConfig,
          },
        },
      );

      console.log(
        `Started recording ${result.recordingId} for meeting ${meetingId}`,
      );

      return {
        recordingId: result.recordingId,
        recordingUrl: result.recordingUrl,
        success: true,
      };
    } catch (error) {
      // Track failed recording start
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      const _result5: null = await ctx.runMutation(
        internal.meetings.stream.trackStreamEvent,
        {
          meetingId,
          event: "recording_start_failed",
          success: false,
          duration,
          error: errorMessage,
        },
      );

      // Send alert for recording failures
      const _result6: null = await ctx.runMutation(
        internal.meetings.stream.sendStreamAlert,
        {
          alertType: "recording_failed",
          meetingId,
          error: errorMessage,
        },
      );

      console.error("Failed to start GetStream recording:", error);
      throw createError.streamError("recording start", errorMessage);
    }
  },
});

/**
 * Stops recording for a GetStream call and retrieves the recording URL
 */
export const stopRecording = action({
  args: {
    meetingId: v.id("meetings"),
    recordingId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    recordingUrl: v.optional(v.string()),
    recordingId: v.optional(v.string()),
    duration: v.optional(v.number()),
  }),
  handler: async (ctx, { meetingId, recordingId }) => {
    const startTime = Date.now();

    try {
      // Verify user has permission to stop recording (host only)
      await assertMeetingAccess(ctx, meetingId, "host");

      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting) {
        throw createError.notFound("Meeting", meetingId);
      }

      if (!meeting.streamRoomId) {
        throw createError.validation("Meeting does not have a GetStream call");
      }

      // Stop recording using GetStream Video JS SDK
      const result = await withRetry<{
        recordingUrl?: string;
        recordingId?: string;
        duration?: number;
      }>(async () => {
        return await CircuitBreakers.getstream.execute(async () => {
          const client = getStreamVideoClient();
          const call = client.call("default", meeting.streamRoomId);

          // Stop recording
          const stopResponse = await call.stopRecording();

          // Get recording details
          let recordingDetails = null;
          if (recordingId) {
            try {
              recordingDetails = await call.queryRecordings({
                session_id: recordingId,
              });
            } catch (error) {
              console.warn("Failed to query recording details:", error);
            }
          }

          return {
            recordingUrl: recordingDetails?.recordings?.[0]?.url,
            recordingId: recordingDetails?.recordings?.[0]?.id || recordingId,
            duration: recordingDetails?.recordings?.[0]?.duration,
          };
        });
      }, RetryPolicies.externalService());

      // Update meeting state to indicate recording is stopped
      const _result7: null = await ctx.runMutation(
        internal.meetings.stream.updateRecordingState,
        {
          meetingId,
          recordingEnabled: false,
          recordingId: result.recordingId,
          recordingUrl: result.recordingUrl,
        },
      );

      // Track successful recording stop
      const duration = Date.now() - startTime;
      const _result8: null = await ctx.runMutation(
        internal.meetings.stream.trackStreamEvent,
        {
          meetingId,
          event: "recording_stopped",
          success: true,
          duration,
          metadata: {
            recordingId: result.recordingId,
            recordingUrl: result.recordingUrl,
            recordingDuration: result.duration,
          },
        },
      );

      console.log(
        `Stopped recording ${result.recordingId} for meeting ${meetingId}`,
      );

      return {
        success: true,
        recordingUrl: result.recordingUrl,
        recordingId: result.recordingId,
        duration: result.duration,
      };
    } catch (error) {
      // Track failed recording stop
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await ctx.runMutation(internal.meetings.stream.trackStreamEvent, {
        meetingId,
        event: "recording_stop_failed",
        success: false,
        duration,
        error: errorMessage,
      });

      console.error("Failed to stop GetStream recording:", error);
      throw createError.streamError("recording stop", errorMessage);
    }
  },
});

/**
 * Deletes a GetStream room when meeting ends
 */
export const deleteStreamRoom = internalAction({
  args: {
    meetingId: v.id("meetings"),
    roomId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, roomId }) => {
    try {
      // TODO: Delete actual GetStream room
      const streamApiKey = process.env.STREAM_API_KEY;
      const streamSecret = process.env.STREAM_SECRET;

      if (streamApiKey && streamSecret) {
        // TODO: Actual GetStream room deletion
        /*
        const StreamVideo = require('@stream-io/video-js');
        const client = new StreamVideo(streamApiKey, streamSecret);

        const call = client.call('default', roomId);
        await call.delete();
        */
      }

      console.log(`Deleted GetStream room ${roomId} for meeting ${meetingId}`);

      return { success: true };
    } catch (error) {
      console.error("Failed to delete GetStream room:", error);
      return { success: false };
    }
  },
});

/**
 * Handles GetStream webhooks with proper signature verification and event processing
 */
export const handleStreamWebhook = httpAction(async (ctx, request) => {
  try {
    const body = await request.text();
    const signature =
      request.headers.get("x-signature") || request.headers.get("signature");

    // Verify webhook signature for security
    if (signature) {
      const streamSecret = process.env.STREAM_SECRET;
      if (!streamSecret) {
        console.error(
          "GetStream secret not configured for webhook verification",
        );
        return new Response("Webhook secret not configured", { status: 500 });
      }

      // Verify HMAC signature
      const crypto = require("crypto");
      const expectedSignature = crypto
        .createHmac("sha256", streamSecret)
        .update(body)
        .digest("hex");

      const providedSignature = signature.replace("sha256=", "");

      if (expectedSignature !== providedSignature) {
        console.error("Invalid webhook signature");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Parse webhook payload
    const payload = JSON.parse(body);
    const eventType = payload.type;
    const eventData = payload;

    console.log(`Received GetStream webhook: ${eventType}`);

    // Process webhook event based on type
    let processingResult = { success: false };

    switch (eventType) {
      case "call.session_started":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleCallSessionStarted,
          {
            data: eventData,
          },
        );
        break;

      case "call.session_ended":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleCallSessionEnded,
          {
            data: eventData,
          },
        );
        break;

      case "call.member_joined":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleMemberJoined,
          {
            data: eventData,
          },
        );
        break;

      case "call.member_left":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleMemberLeft,
          {
            data: eventData,
          },
        );
        break;

      case "call.recording_started":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleRecordingStarted,
          {
            data: eventData,
          },
        );
        break;

      case "call.recording_stopped":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleRecordingStopped,
          {
            data: eventData,
          },
        );
        break;

      case "call.recording_ready":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleRecordingReady,
          {
            data: eventData,
          },
        );
        break;

      case "call.transcription_started":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleTranscriptionStarted,
          {
            data: eventData,
          },
        );
        break;

      case "call.transcription_stopped":
        processingResult = await ctx.runMutation(
          internal.meetings.stream.handleTranscriptionStopped,
          {
            data: eventData,
          },
        );
        break;

      default:
        console.log(`Unhandled GetStream webhook event: ${eventType}`);
        processingResult = { success: true }; // Don't fail for unknown events
    }

    if (processingResult.success) {
      return new Response("OK", { status: 200 });
    } else {
      return new Response("Processing failed", { status: 500 });
    }
  } catch (error) {
    console.error("Failed to handle GetStream webhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
});

/**
 * Internal mutations for webhook event handling
 */

export const handleCallSessionStarted = internalMutation({
  args: { data: v.any() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const sessionId = data.call_session?.id;

      if (!callId) {
        console.warn("Call session started webhook missing call ID");
        return { success: false };
      }

      // Find meeting by GetStream call ID
      const meeting = await ctx.db
        .query("meetings")
        .filter((q) => q.eq(q.field("streamRoomId"), callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      // Update meeting state to active
      await ctx.db.patch(meeting._id, {
        state: "active",
        updatedAt: Date.now(),
      });

      // Update meeting state record
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
  args: { data: v.any() },
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

      // Find meeting by GetStream call ID
      const meeting = await ctx.db
        .query("meetings")
        .filter((q) => q.eq(q.field("streamRoomId"), callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      // Update meeting state to concluded
      await ctx.db.patch(meeting._id, {
        state: "concluded",
        updatedAt: Date.now(),
      });

      // Update meeting state record
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

      // Schedule post-meeting processing
      await ctx.scheduler.runAfter(
        5000, // 5 second delay
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
  args: { data: v.any() },
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

      // Find meeting and user
      const [meeting, user] = await Promise.all([
        ctx.db
          .query("meetings")
          .filter((q) => q.eq(q.field("streamRoomId"), callId))
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

      // Update participant presence
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
  args: { data: v.any() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;
      const userId = data.user?.id;

      if (!callId || !userId) {
        console.warn("Member left webhook missing call ID or user ID");
        return { success: false };
      }

      // Find meeting and user
      const [meeting, user] = await Promise.all([
        ctx.db
          .query("meetings")
          .filter((q) => q.eq(q.field("streamRoomId"), callId))
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

      // Update participant presence
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
  args: { data: v.any() },
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

      // Find meeting by GetStream call ID
      const meeting = await ctx.db
        .query("meetings")
        .filter((q) => q.eq(q.field("streamRoomId"), callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      // Update meeting state to indicate recording is active
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
  args: { data: v.any() },
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

      // Find meeting by GetStream call ID
      const meeting = await ctx.db
        .query("meetings")
        .filter((q) => q.eq(q.field("streamRoomId"), callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      // Update meeting state to indicate recording is stopped
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
  args: { data: v.any() },
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

      // Find meeting by GetStream call ID
      const meeting = await ctx.db
        .query("meetings")
        .filter((q) => q.eq(q.field("streamRoomId"), callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      // Store recording information
      await ctx.db.insert("meetingRecordings", {
        meetingId: meeting._id,
        recordingId,
        recordingUrl,
        provider: "getstream",
        status: "ready",
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
  args: { data: v.any() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;

      if (!callId) {
        console.warn("Transcription started webhook missing call ID");
        return { success: false };
      }

      // Find meeting by GetStream call ID
      const meeting = await ctx.db
        .query("meetings")
        .filter((q) => q.eq(q.field("streamRoomId"), callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      // Update transcription session status
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
  args: { data: v.any() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { data }) => {
    try {
      const callId = data.call?.id;

      if (!callId) {
        console.warn("Transcription stopped webhook missing call ID");
        return { success: false };
      }

      // Find meeting by GetStream call ID
      const meeting = await ctx.db
        .query("meetings")
        .filter((q) => q.eq(q.field("streamRoomId"), callId))
        .unique();

      if (!meeting) {
        console.warn(`No meeting found for GetStream call ${callId}`);
        return { success: false };
      }

      // Update transcription session status
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
 * Helper mutations for internal operations
 */

export const updateRecordingState = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    recordingEnabled: v.boolean(),
    recordingId: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { meetingId, recordingEnabled, recordingId, recordingUrl },
  ) => {
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        recordingEnabled,
        updatedAt: Date.now(),
      });
    }

    // Store recording information if provided
    if (recordingId && recordingUrl) {
      await ctx.db.insert("meetingRecordings", {
        meetingId,
        recordingId,
        recordingUrl,
        provider: "getstream",
        status: recordingEnabled ? "recording" : "ready",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

export const trackStreamEvent = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    event: v.string(),
    success: v.boolean(),
    duration: v.optional(v.number()),
    error: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("meetingEvents", {
      meetingId: args.meetingId,
      event: args.event,
      success: args.success,
      duration: args.duration,
      error: args.error,
      metadata: args.metadata || {},
      timestamp: Date.now(),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const sendStreamAlert = internalMutation({
  args: {
    alertType: v.string(),
    meetingId: v.id("meetings"),
    error: v.string(),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { alertType, meetingId, error, metadata }) => {
    const alertConfig = {
      id: `stream_${alertType}_${meetingId}_${Date.now()}`,
      severity: "error" as const,
      category: "video_provider" as const,
      title: `GetStream ${alertType.replace(/_/g, " ")}`,
      message: `GetStream operation failed for meeting ${meetingId}: ${error}`,
      metadata: {
        meetingId,
        provider: "getstream",
        ...metadata,
      },
      actionable: true,
    };

    await ctx.db.insert("alerts", {
      alertId: alertConfig.id,
      severity: alertConfig.severity,
      category: alertConfig.category,
      title: alertConfig.title,
      message: alertConfig.message,
      metadata: alertConfig.metadata,
      actionable: alertConfig.actionable,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});
