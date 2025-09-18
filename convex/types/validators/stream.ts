/**
 * Stream (GetStream) Validator Definitions
 *
 * Convex validators corresponding to the centralized Stream domain types.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3
 * Compliance: steering/convex_rules.mdc - Consistent validator usage
 */

import { v } from "convex/values";

const streamRoomFeaturesV = v.object({
  recording: v.boolean(),
  transcription: v.boolean(),
  maxParticipants: v.number(),
  screenSharing: v.boolean(),
  chat: v.boolean(),
});

export const StreamApiResponseV = {
  createRoom: v.object({
    roomId: v.string(),
    callId: v.string(),
    success: v.boolean(),
    features: streamRoomFeaturesV,
  }),
  participantTokenPublic: v.object({
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
  participantTokenInternal: v.object({
    token: v.string(),
    userId: v.string(),
    callId: v.string(),
    expiresAt: v.number(),
    success: v.boolean(),
  }),
  startRecording: v.object({
    recordingId: v.string(),
    recordingUrl: v.optional(v.string()),
    success: v.boolean(),
  }),
  stopRecording: v.object({
    success: v.boolean(),
    recordingUrl: v.optional(v.string()),
    recordingId: v.optional(v.string()),
    duration: v.optional(v.number()),
  }),
  simpleSuccess: v.object({
    success: v.boolean(),
  }),
  cleanupResult: v.object({
    success: v.boolean(),
    tasksCompleted: v.array(v.string()),
  }),
} as const;

export const StreamWebhookPayloadV = v.object({
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

/**
 * Aggregated export exposing key Stream validators under a single namespace.
 */
export const StreamV = {
  roomFeatures: streamRoomFeaturesV,
  api: StreamApiResponseV,
  webhook: StreamWebhookPayloadV,
} as const;
