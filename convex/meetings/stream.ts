/**
 * GetStream Video Integration Actions
 *
 * This module handles all Stream Video API integrations including room creation,
 * token generation, and webhook processing with proper error handling and idempotency.
 *
 * Requirements: 6.2, 6.3, 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

"use node";

import { action, httpAction, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import {
  withTiming,
  withCircuitBreaker,
  monitorStreamHealth,
  checkRateLimit,
} from "../lib/monitoring";

// Stream SDK imports
import { StreamClient } from "@stream-io/node-sdk";

/**
 * Stream client configuration with enhanced error handling
 */
function getStreamClient(): StreamClient {
  const apiKey = process.env.STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;

  if (!apiKey) {
    throw createError.validation(
      "STREAM_API_KEY environment variable not configured",
    );
  }

  if (!apiSecret) {
    throw createError.validation(
      "STREAM_API_SECRET environment variable not configured",
    );
  }

  try {
    return new StreamClient(apiKey, apiSecret);
  } catch (error) {
    console.error("Failed to initialize Stream client:", error);
    throw createError.validation(
      `Stream client initialization failed: ${error}`,
    );
  }
}

/**
 * Creates a Stream room for a meeting with idempotency and retry logic
 */
export const createStreamRoom = internalAction({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    roomId: v.string(),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId }) => {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if room already exists (idempotency)
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
          // Room already exists, verify it's still valid
          try {
            const streamClient = getStreamClient();
            const call = streamClient.video.call(
              "default",
              meeting.streamRoomId,
            );
            await call.get(); // This will throw if room doesn't exist

            return {
              roomId: meeting.streamRoomId,
              success: true,
            };
          } catch (verifyError) {
            console.warn(
              `Existing room ${meeting.streamRoomId} not found, creating new one`,
            );
            // Continue to create new room
          }
        }

        // Generate unique room ID with timestamp and random component
        const roomId = `meeting_${meetingId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Initialize Stream client
        const streamClient = getStreamClient();

        // Create call/room in Stream
        const call = streamClient.video.call("default", roomId);

        // Configure call settings
        await call.create({
          data: {
            created_by_id: meeting.organizerId,
            settings_override: {
              audio: {
                mic_default_on: true,
                speaker_default_on: true,
                opus_dtx_enabled: true, // Optimize bandwidth
              },
              video: {
                camera_default_on: false,
                target_resolution: "720p",
              },
              screensharing: {
                enabled: true,
                target_resolution: "1080p",
              },
              recording: {
                mode: "disabled", // Can be enabled per meeting
              },
              transcription: {
                mode: "disabled", // We handle transcription separately
              },
              limits: {
                max_participants: 50, // Reasonable limit
                max_duration_seconds: 14400, // 4 hours max
              },
            },
          },
          custom: {
            meetingId,
            title: meeting.title,
            description: meeting.description,
            createdAt: Date.now(),
          },
        });

        // Update meeting with Stream room ID
        await ctx.runMutation(internal.meetings.lifecycle.updateStreamRoomId, {
          meetingId,
          streamRoomId: roomId,
        });

        console.log(
          `Successfully created Stream room ${roomId} for meeting ${meetingId}`,
        );

        return {
          roomId,
          success: true,
        };
      } catch (error) {
        lastError = error as Error;
        console.error(
          `Attempt ${attempt}/${maxRetries} failed to create Stream room:`,
          error,
        );

        // Don't retry on certain errors
        if (
          error instanceof Error &&
          (error.message.includes("not configured") ||
            (error.message.includes("Meeting") &&
              error.message.includes("not found")))
        ) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }

    throw createError.validation(
      `Failed to create Stream room after ${maxRetries} attempts: ${lastError?.message}`,
    );
  },
});

/**
 * Generates a participant token for Stream access
 */
export const generateParticipantToken = internalAction({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  returns: v.object({
    token: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, { meetingId, userId }) => {
    try {
      // Get meeting and user details
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
        throw createError.validation("Meeting does not have a Stream room");
      }

      const user = await ctx.runQuery(internal.users.queries.getUserById, {
        userId,
      });

      if (!user) {
        throw createError.notFound("User", userId);
      }

      // Initialize Stream client
      const streamClient = getStreamClient();

      // Generate token with 1 hour expiration
      const expirationTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const issuedAt = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

      const token = streamClient.createToken(userId, expirationTime, issuedAt);

      return {
        token,
        expiresAt: expirationTime * 1000, // Convert to milliseconds
      };
    } catch (error) {
      console.error("Failed to generate Stream token:", error);
      throw createError.validation(`Failed to generate Stream token: ${error}`);
    }
  },
});

/**
 * Public action to get Stream token for authenticated user
 */
export const getStreamToken = action({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    token: v.string(),
    roomId: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Get user identity
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw createError.unauthorized("Authentication required");
    }

    // Verify user is a participant
    const participant = await ctx.runQuery(
      internal.meetings.queries.getMeetingParticipant,
      {
        meetingId,
        workosUserId: identity.subject,
      },
    );

    if (!participant) {
      throw createError.forbidden("Not a meeting participant");
    }

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

    if (!meeting.streamRoomId) {
      throw createError.validation("Meeting does not have a Stream room");
    }

    // Generate token
    const tokenResult = await ctx.runAction(
      internal.meetings.stream.generateParticipantToken,
      {
        meetingId,
        userId: participant.userId,
      },
    );

    return {
      token: tokenResult.token,
      roomId: meeting.streamRoomId,
      expiresAt: tokenResult.expiresAt,
    };
  },
});

/**
 * Handles Stream webhooks with signature verification
 */
export const handleStreamWebhook = httpAction(async (ctx, request) => {
  try {
    // Verify webhook signature
    const signature = request.headers.get("stream-signature");
    const timestamp = request.headers.get("stream-timestamp");

    if (!signature || !timestamp) {
      return new Response("Missing signature or timestamp", { status: 401 });
    }

    const body = await request.text();

    // Verify signature (implement HMAC verification)
    const isValidSignature = await verifyStreamSignature(
      body,
      signature,
      timestamp,
    );
    if (!isValidSignature) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse webhook payload
    const payload = JSON.parse(body);
    const { type, call, user } = payload;

    // Extract meeting ID from call custom data
    const meetingId = call?.custom?.meetingId;
    if (!meetingId) {
      console.warn("Webhook received without meetingId:", type);
      return new Response("OK");
    }

    // Handle different webhook events
    switch (type) {
      case "call.session_started":
        await ctx.runMutation(internal.meetings.webhooks.handleCallStarted, {
          meetingId,
          callId: call.id,
          startedAt: new Date(payload.created_at).getTime(),
        });
        break;

      case "call.session_ended":
        await ctx.runMutation(internal.meetings.webhooks.handleCallEnded, {
          meetingId,
          callId: call.id,
          endedAt: new Date(payload.created_at).getTime(),
        });
        break;

      case "call.session_participant_joined":
        await ctx.runMutation(
          internal.meetings.webhooks.handleParticipantJoined,
          {
            meetingId,
            userId: user.id,
            joinedAt: new Date(payload.created_at).getTime(),
          },
        );
        break;

      case "call.session_participant_left":
        await ctx.runMutation(
          internal.meetings.webhooks.handleParticipantLeft,
          {
            meetingId,
            userId: user.id,
            leftAt: new Date(payload.created_at).getTime(),
          },
        );
        break;

      case "call.recording_started":
        await ctx.runMutation(
          internal.meetings.webhooks.handleRecordingStarted,
          {
            meetingId,
            recordingId: payload.call_recording?.filename,
            startedAt: new Date(payload.created_at).getTime(),
          },
        );
        break;

      case "call.recording_stopped":
        await ctx.runMutation(
          internal.meetings.webhooks.handleRecordingStopped,
          {
            meetingId,
            recordingId: payload.call_recording?.filename,
            stoppedAt: new Date(payload.created_at).getTime(),
            downloadUrl: payload.call_recording?.url,
          },
        );
        break;

      default:
        console.log("Unhandled webhook type:", type);
    }

    return new Response("OK");
  } catch (error) {
    console.error("Webhook processing error:", error);

    // Determine appropriate error response
    if (error instanceof Error) {
      if (error.message.includes("timeout")) {
        return new Response("Request timeout", { status: 504 });
      }
      if (error.message.includes("Rate limit")) {
        return new Response("Rate limit exceeded", { status: 429 });
      }
    }

    return new Response("Internal Server Error", { status: 500 });
  }
});

/**
 * Verifies Stream webhook signature
 */
async function verifyStreamSignature(
  body: string,
  signature: string,
  timestamp: string,
): Promise<boolean> {
  try {
    const secret = process.env.STREAM_WEBHOOK_SECRET;
    if (!secret) {
      console.warn("Stream webhook secret not configured");
      return false;
    }

    // Check timestamp to prevent replay attacks (within 5 minutes)
    const timestampMs = parseInt(timestamp) * 1000;
    const now = Date.now();
    if (Math.abs(now - timestampMs) > 300000) {
      // 5 minutes
      console.warn("Webhook timestamp too old or too far in future");
      return false;
    }

    // Verify HMAC signature
    const crypto = await import("crypto");
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(timestamp + body)
      .digest("hex");

    return signature === expectedSignature;
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

/**
 * Deletes a Stream room when meeting is cancelled
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
      const streamClient = getStreamClient();
      const call = streamClient.video.call("default", roomId);

      // End the call if it's active
      await call.end();

      return { success: true };
    } catch (error) {
      console.error("Failed to delete Stream room:", error);
      // Don't throw - this is cleanup, not critical
      return { success: false };
    }
  },
});

/**
 * Updates Stream room settings
 */
export const updateStreamRoomSettings = internalAction({
  args: {
    meetingId: v.id("meetings"),
    roomId: v.string(),
    settings: v.object({
      recordingEnabled: v.optional(v.boolean()),
      transcriptionEnabled: v.optional(v.boolean()),
    }),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, roomId, settings }) => {
    try {
      const streamClient = getStreamClient();
      const call = streamClient.video.call("default", roomId);

      // Update call settings
      await call.update({
        settings_override: {
          recording: {
            mode: settings.recordingEnabled ? "available" : "disabled",
          },
          transcription: {
            mode: settings.transcriptionEnabled ? "available" : "disabled",
          },
        },
      });

      return { success: true };
    } catch (error) {
      console.error("Failed to update Stream room settings:", error);
      throw createError.validation(`Failed to update room settings: ${error}`);
    }
  },
});
