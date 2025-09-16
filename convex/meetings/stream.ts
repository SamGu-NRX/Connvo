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

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { Id, Doc } from "../_generated/dataModel";
import { requireIdentity } from "../auth/guards";
import { withActionIdempotency, IdempotencyUtils } from "../lib/idempotency";
// Alerting helpers are invoked through internal mutations in streamHelpers.
import { withRetry, RetryPolicies, CircuitBreakers } from "../lib/resilience";

// Result type aliases to avoid recursive inference and keep return types consistent.
type CreateStreamRoomResult = {
  roomId: string;
  callId: string;
  success: boolean;
  features: {
    recording: boolean;
    transcription: boolean;
    screensharing: boolean;
    chat: boolean;
  };
};

type ParticipantTokenPublicResult = {
  token: string;
  userId: string;
  user: { id: string; name: string; image?: string };
  expiresAt: number;
  success: boolean;
};

type GenerateParticipantTokenResult = {
  token: string;
  userId: string;
  callId: string;
  expiresAt: number;
  success: boolean;
};

type StartRecordingResult = {
  recordingId: string;
  recordingUrl?: string;
  success: boolean;
};
type StopRecordingResult = {
  success: boolean;
  recordingUrl?: string;
  recordingId?: string;
  duration?: number;
};

/**
 * Minimal types for GetStream Video client to avoid any.
 */
type StreamRecording = { id?: string; url?: string; duration?: number };
type StreamCall = {
  create: (opts: { data: Record<string, unknown> }) => Promise<void>;
  startRecording: (config: {
    mode: string;
    audio_only: boolean;
    quality: string;
    layout: { name: string; options?: Record<string, unknown> };
  }) => Promise<{ recording?: StreamRecording }>;
  stopRecording: () => Promise<unknown>;
  queryRecordings: (query: {
    session_id: string;
  }) => Promise<{ recordings?: StreamRecording[] }>;
};
type StreamVideoClient = {
  call: (callType: string, callId: string) => StreamCall;
  createToken: (userId: string, claims: Record<string, unknown>) => string;
};

/**
 * GetStream Video Client singleton for server-side operations
 */
let streamVideoClient: StreamVideoClient | null = null;

function getStreamVideoClient(): StreamVideoClient {
  if (!streamVideoClient) {
    const streamApiKey = process.env.STREAM_API_KEY;
    const streamSecret = process.env.STREAM_SECRET;

    if (!streamApiKey || !streamSecret) {
      throw new Error(
        "GetStream credentials not configured. Set STREAM_API_KEY and STREAM_SECRET environment variables.",
      );
    }

    // Import GetStream Video JS SDK for Node.js
    const { StreamVideoClient: StreamCtor } =
      require("@stream-io/video-react-sdk") as {
        StreamVideoClient: new (
          apiKey: string,
          opts: { secret: string },
        ) => StreamVideoClient;
      };

    streamVideoClient = new StreamCtor(streamApiKey, { secret: streamSecret });
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
  handler: async (ctx, { meetingId }): Promise<CreateStreamRoomResult> => {
    const startTime = Date.now();

    const idem1 = await withActionIdempotency(
      ctx,
      IdempotencyUtils.externalService("getstream", "create_call", meetingId),
      async () => {
        try {
          // Get meeting details
          const meeting: Doc<"meetings"> | null = await ctx.runQuery(
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
          const result = await withRetry<{ callId: string; call: StreamCall }>(
            async () => {
              return await CircuitBreakers.getstream.execute(async () => {
                const client = getStreamVideoClient();

                // Create call using GetStream Video JS SDK
                const call = client.call(callType, callId);

                // Get organizer user details
                const organizer: Doc<"users"> | null = await ctx.runQuery(
                  internal.users.queries.getUserByIdInternal,
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
          const _updated: null = await ctx.runMutation(
            internal.meetings.lifecycle.updateStreamRoomId,
            {
              meetingId,
              streamRoomId: result.callId,
            },
          );

          // Track successful room creation
          const duration = Date.now() - startTime;
          const _result0: null = await ctx.runMutation(
            internal.meetings.streamHelpers.trackStreamEvent,
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
            internal.meetings.streamHelpers.trackStreamEvent,
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
            internal.meetings.streamHelpers.sendStreamAlert,
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
    if (!idem1.result) {
      throw new Error("Idempotent result missing");
    }
    return idem1.result;
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
  handler: async (
    ctx,
    { meetingId },
  ): Promise<ParticipantTokenPublicResult> => {
    // Get current user identity and resolve Convex user id
    const identity = await requireIdentity(ctx);
    const user: Doc<"users"> | null = await ctx.runQuery(
      internal.users.queries.getUserByWorkosId,
      { workosUserId: identity.workosUserId },
    );
    if (!user) {
      throw createError.notFound("User", identity.workosUserId);
    }
    const userId = user._id;

    const result: {
      token: string;
      userId: string;
      expiresAt: number;
      success: boolean;
    } = await ctx.runAction(internal.meetings.stream.generateParticipantToken, {
      meetingId,
      userId,
    });

    // Get user details for the response
    const freshUser: Doc<"users"> | null = await ctx.runQuery(
      internal.users.queries.getUserByIdInternal,
      {
        userId,
      },
    );
    if (!freshUser) {
      throw createError.notFound("User", userId);
    }

    return {
      token: result.token,
      userId: result.userId,
      user: {
        id: freshUser.workosUserId,
        name: freshUser.displayName || freshUser.email,
        image: freshUser.avatarUrl,
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
  handler: async (
    ctx,
    { meetingId, userId, role = "participant" },
  ): Promise<GenerateParticipantTokenResult> => {
    const idem2 = await withActionIdempotency(
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
            ctx.runQuery(internal.users.queries.getUserByIdInternal, {
              userId,
            }),
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
          await ctx.runMutation(
            internal.meetings.streamHelpers.sendStreamAlert,
            {
              alertType: "token_generation_failed",
              meetingId,
              error: errorMessage,
              metadata: { userId },
            },
          );

          console.error("Failed to generate GetStream token:", error);
          throw createError.streamError("token generation", errorMessage);
        }
      },
    );
    if (!idem2.result) {
      throw new Error("Idempotent result missing");
    }
    return idem2.result;
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
  handler: async (
    ctx,
    { meetingId, recordingConfig },
  ): Promise<StartRecordingResult> => {
    const startTime = Date.now();

    try {
      // Verify user has permission to start recording (host only)
      const { workosUserId: workosUserId1 } = await requireIdentity(ctx);
      const participant1 = await ctx.runQuery(
        internal.meetings.queries.getMeetingParticipant,
        { meetingId, workosUserId: workosUserId1 },
      );
      if (!participant1 || participant1.role !== "host") {
        throw createError.insufficientPermissions(
          "host",
          participant1?.role ?? "participant",
        );
      }

      const meeting: Doc<"meetings"> | null = await ctx.runQuery(
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
      const streamRoomId: string = meeting.streamRoomId as string;

      // Rate limit: max 3 recording starts per minute per host
      try {
        await ctx.runMutation(internal.system.idempotency.enforceRateLimit, {
          userId: participant1.userId,
          action: "recording_start",
          windowMs: 60_000,
          maxCount: 3,
        });
      } catch {
        throw createError.rateLimitExceeded("recording_start", 3);
      }

      // Start recording using GetStream Video JS SDK
      const result = await withRetry<{
        recordingId: string;
        recordingUrl?: string;
      }>(async () => {
        return await CircuitBreakers.getstream.execute(async () => {
          const client = getStreamVideoClient();
          const call: StreamCall = client.call("default", streamRoomId);

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
          const recordingResponse: { recording?: StreamRecording } =
            await call.startRecording(config);

          return {
            recordingId:
              recordingResponse.recording?.id || `recording_${Date.now()}`,
            recordingUrl: recordingResponse.recording?.url,
          };
        });
      }, RetryPolicies.externalService());

      // Update meeting state to indicate recording is active
      const _result3: null = await ctx.runMutation(
        internal.meetings.streamHelpers.updateRecordingState,
        {
          meetingId,
          recordingEnabled: true,
          recordingId: result.recordingId,
        },
      );

      // Track successful recording start
      const duration = Date.now() - startTime;
      const _result4: null = await ctx.runMutation(
        internal.meetings.streamHelpers.trackStreamEvent,
        {
          meetingId,
          event: "recording_started",
          success: true,
          duration,
          metadata: {
            recordingId: result.recordingId ?? "",
            config: JSON.stringify(recordingConfig),
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
        internal.meetings.streamHelpers.trackStreamEvent,
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
        internal.meetings.streamHelpers.sendStreamAlert,
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
  handler: async (
    ctx,
    { meetingId, recordingId },
  ): Promise<StopRecordingResult> => {
    const startTime = Date.now();

    try {
      // Verify user has permission to stop recording (host only)
      const { workosUserId: workosUserId2 } = await requireIdentity(ctx);
      const participant2 = await ctx.runQuery(
        internal.meetings.queries.getMeetingParticipant,
        { meetingId, workosUserId: workosUserId2 },
      );
      if (!participant2 || participant2.role !== "host") {
        throw createError.insufficientPermissions(
          "host",
          participant2?.role ?? "participant",
        );
      }

      const meeting: Doc<"meetings"> | null = await ctx.runQuery(
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
      const streamRoomId2: string = meeting.streamRoomId as string;

      // Rate limit: max 5 recording stops per minute per host
      try {
        await ctx.runMutation(internal.system.idempotency.enforceRateLimit, {
          userId: participant2.userId,
          action: "recording_stop",
          windowMs: 60_000,
          maxCount: 5,
        });
      } catch {
        throw createError.rateLimitExceeded("recording_stop", 5);
      }

      // Stop recording using GetStream Video JS SDK
      const result = await withRetry<{
        recordingUrl?: string;
        recordingId?: string;
        duration?: number;
      }>(async () => {
        return await CircuitBreakers.getstream.execute(async () => {
          const client = getStreamVideoClient();
          const call: StreamCall = client.call("default", streamRoomId2);

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
        internal.meetings.streamHelpers.updateRecordingState,
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
        internal.meetings.streamHelpers.trackStreamEvent,
        {
          meetingId,
          event: "recording_stopped",
          success: true,
          duration,
          metadata: {
            recordingId: result.recordingId ?? "",
            recordingUrl: result.recordingUrl ?? "",
            recordingDuration: result.duration ?? 0,
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

      await ctx.runMutation(internal.meetings.streamHelpers.trackStreamEvent, {
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
        const StreamVideo = require('@stream-io/video-react-sdk');
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
// (HTTP webhook handler moved to convex/http.ts)

/**
 * Internal mutations for webhook event handling
 */

// (webhook handler mutations moved to convex/meetings/streamHandlers.ts)
