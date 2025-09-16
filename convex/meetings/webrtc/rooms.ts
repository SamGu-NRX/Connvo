/**
 * Video Room Management (WebRTC + GetStream Provider Abstraction)
 *
 * This module handles video room creation and management using the provider
 * abstraction layer to support both WebRTC (free) and GetStream (paid) tiers.
 *
 * Requirements: 6.2, 6.3, 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

import {
  action,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { requireIdentity, assertMeetingAccess } from "../../auth/guards";
import { createError } from "../../lib/errors";
import {
  VideoProviderFactory,
  VideoProviderUtils,
} from "../../lib/videoProviders";
import { WebRTCApiResponseV } from "../../types/validators/webrtc";
import type {
  Meeting,
  VideoRoomConfig,
  ICEServer,
  VideoRoomFeatures,
  MeetingParticipant,
} from "../../types/entities/meeting";
import { Id } from "../../_generated/dataModel";
import { connectionStatsV } from "../../types/validators/webrtc";

/**
 * Initializes WebRTC room for a meeting using the provider abstraction
 */
export const initializeWebRTCRoom = action({
  args: {
    meetingId: v.id("meetings"),
    maxParticipants: v.optional(v.number()),
  },
  returns: WebRTCApiResponseV.initializeRoom,
  handler: async (ctx, { meetingId, maxParticipants = 4 }) => {
    const identity = await requireIdentity(ctx);

    // Verify user is a participant via internal query
    const participant: MeetingParticipant & {
      role: "host" | "participant" | "observer";
      presence: "invited" | "joined" | "left";
    } = await ctx.runQuery(internal.meetings.webrtc.getParticipantForAccess, {
      meetingId,
    });

    // Fetch meeting via internal query
    const meeting: Meeting | null = await ctx.runQuery(
      internal.meetings.webrtc.getMeetingDoc,
      { meetingId },
    );

    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    // Determine user plan and select provider
    const userPlan = VideoProviderUtils.getUserPlan(identity.orgRole);
    const recordingRequired = false; // Will be determined by meeting settings

    const provider = VideoProviderFactory.selectProvider(
      userPlan,
      maxParticipants,
      recordingRequired,
    );

    // Create room using selected provider
    const roomConfig = await provider.createRoom(meetingId, {
      title: meeting.title,
      organizerId: meeting.organizerId,
      maxParticipants,
      recordingEnabled: userPlan === "paid",
      transcriptionEnabled: true,
      scheduledAt: meeting.scheduledAt,
    });

    // Store room configuration in database
    await ctx.runMutation(internal.meetings.webrtc.storeRoomConfiguration, {
      meetingId,
      roomConfig: {
        roomId: roomConfig.roomId,
        provider: roomConfig.provider as "webrtc" | "getstream",
        iceServers: roomConfig.iceServers,
        features: roomConfig.features,
        success: true,
      },
    });

    return {
      roomId: roomConfig.roomId,
      provider: roomConfig.provider as "webrtc" | "getstream",
      iceServers: roomConfig.iceServers,
      features: roomConfig.features,
      success: true,
    };
  },
});

/**
 * Stores WebRTC room configuration in database
 */
export const storeRoomConfiguration = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    roomConfig: WebRTCApiResponseV.initializeRoom,
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, roomConfig }) => {
    // Update meeting with room configuration
    await ctx.db.patch(meetingId, {
      streamRoomId: roomConfig.roomId,
      webrtcEnabled: roomConfig.provider === "webrtc",
      updatedAt: Date.now(),
    });

    // Store detailed room configuration using centralized types
    const videoRoomConfig: Omit<VideoRoomConfig, "_id"> = {
      meetingId,
      roomId: roomConfig.roomId,
      provider: roomConfig.provider,
      iceServers: roomConfig.iceServers,
      features: roomConfig.features,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await ctx.db.insert("videoRoomConfigs", videoRoomConfig);
    return null;
  },
});

/**
 * Generates participant access token for video room
 */
type ParticipantAccessTokenResult = {
  token: string;
  provider: "webrtc" | "getstream";
  roomId: string;
  participantId: string;
  permissions: {
    canRecord: boolean;
    canMute: boolean;
    canKick: boolean;
    canShare: boolean;
  };
  success: boolean;
};

export const generateParticipantAccessToken = action({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.optional(v.string()),
  },
  returns: WebRTCApiResponseV.participantToken,
  handler: async (
    ctx,
    { meetingId, sessionId },
  ): Promise<ParticipantAccessTokenResult> => {
    const identity = await requireIdentity(ctx);

    // Verify user is a participant and get their role via internal query
    const participant = await ctx.runQuery(
      internal.meetings.webrtc.getParticipantForAccess,
      { meetingId },
    );

    const meeting: Meeting | null = await ctx.runQuery(
      internal.meetings.webrtc.getMeetingDoc,
      {
        meetingId,
      },
    );
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation(
        "Cannot generate token for inactive meeting",
      );
    }

    // Get room configuration
    const roomConfig: VideoRoomConfig | null = await ctx.runQuery(
      internal.meetings.webrtc.getVideoRoomConfigByMeeting,
      { meetingId },
    );

    if (!roomConfig) {
      throw createError.validation(
        "Meeting does not have a video room configured",
      );
    }

    // Get appropriate provider
    const provider = VideoProviderFactory.getProvider(roomConfig.provider);

    // Handle observer role - observers can't generate tokens for active participation
    if (participant.role === "observer") {
      throw createError.validation(
        "Observers cannot generate participant tokens for active video participation",
      );
    }

    // Generate token using provider (only host/participant roles allowed)
    const token = await provider.generateParticipantToken(
      roomConfig.roomId,
      participant.userId,
      participant.role, // Now guaranteed to be "host" | "participant"
    );

    // Generate unique participant ID
    const participantId: string =
      sessionId ?? `${participant.userId}_${Date.now()}`;

    // Determine permissions based on role
    const permissions = {
      canRecord: participant.role === "host" && roomConfig.features.recording,
      canMute: participant.role === "host",
      canKick: participant.role === "host",
      canShare: roomConfig.features.screenSharing,
    };

    return {
      token,
      provider: roomConfig.provider,
      roomId: roomConfig.roomId,
      participantId,
      permissions,
      success: true,
    };
  },
});

/**
 * Handles WebRTC connection failures with automatic fallback
 */
export const handleConnectionFailure = action({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    errorType: v.union(
      v.literal("ice_failed"),
      v.literal("connection_timeout"),
      v.literal("media_failed"),
      v.literal("signaling_failed"),
    ),
    errorDetails: v.optional(v.string()),
  },
  returns: WebRTCApiResponseV.connectionFailure,
  handler: async (ctx, { meetingId, sessionId, errorType, errorDetails }) => {
    const identity = await requireIdentity(ctx);
    // Verify user is a participant
    const _p1: MeetingParticipant = await ctx.runQuery(
      internal.meetings.webrtc.getParticipantForAccess,
      {
        meetingId,
      },
    );

    // Log the error for monitoring
    console.error(`WebRTC connection failure: ${errorType}`, {
      meetingId,
      sessionId,
      userId: identity.userId,
      errorDetails,
    });

    // Update session state to failed
    const _update0: null = await ctx.runMutation(
      internal.meetings.webrtc.updateSessionStateInternal,
      {
        meetingId,
        sessionId,
        state: "failed",
        metadata: {
          errorType,
          errorDetails: errorDetails ?? "",
          failedAt: Date.now(),
        },
      },
    );

    // Determine if fallback is available
    // TODO: should it even be nullable here?
    const roomConfig: VideoRoomConfig | null = await ctx.runQuery(
      internal.meetings.webrtc.getVideoRoomConfigByMeeting,
      { meetingId },
    );

    let fallbackProvider: "webrtc" | "getstream" | undefined;
    let retryRecommended = false;

    if (roomConfig) {
      if (roomConfig.provider === "webrtc" && errorType === "ice_failed") {
        // WebRTC ICE failure - recommend retry with TURN servers
        retryRecommended = true;
      } else if (roomConfig.provider === "getstream") {
        // GetStream failure - could fallback to WebRTC for small meetings
        const userPlan = VideoProviderUtils.getUserPlan(identity.orgRole);
        if (userPlan === "free" || roomConfig.features.maxParticipants <= 4) {
          fallbackProvider = "webrtc";
        }
      }
    }

    return {
      success: true,
      fallbackProvider,
      retryRecommended,
    };
  },
});

/**
 * Monitors WebRTC connection quality and provides recommendations
 */
export const monitorConnectionQuality = action({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    stats: connectionStatsV,
  },
  returns: WebRTCApiResponseV.connectionQuality,
  handler: async (ctx, { meetingId, sessionId, stats }) => {
    const identity = await requireIdentity(ctx);
    // Verify user is a participant
    const _participant: MeetingParticipant = await ctx.runQuery(
      internal.meetings.webrtc.getParticipantForAccess,
      {
        meetingId,
      },
    );

    // Analyze connection quality
    let quality: "excellent" | "good" | "fair" | "poor" = "excellent";
    const recommendations: string[] = [];
    let shouldFallback = false;

    // Quality assessment based on stats
    if (stats.packetLoss > 5 || stats.latency > 300 || stats.jitter > 50) {
      quality = "poor";
      shouldFallback = true;
      recommendations.push("Consider switching to a more stable connection");
      recommendations.push("Close other applications using bandwidth");
    } else if (
      stats.packetLoss > 2 ||
      stats.latency > 150 ||
      stats.jitter > 30
    ) {
      quality = "fair";
      recommendations.push("Check your internet connection stability");
    } else if (stats.packetLoss > 0.5 || stats.latency > 100) {
      quality = "good";
      recommendations.push("Connection is stable but could be improved");
    }

    // Bitrate assessment
    if (stats.bitrate < 100000) {
      // Less than 100kbps
      quality = quality === "excellent" ? "fair" : quality;
      recommendations.push(
        "Low bitrate detected - check bandwidth availability",
      );
    }

    // Store quality metrics for analytics
    const _stored: null = await ctx.runMutation(
      internal.meetings.webrtc.storeConnectionMetrics,
      {
        meetingId,
        sessionId,
        userId: identity.userId as Id<"users">, // TODO: is this "as" needed?
        quality,
        stats,
        timestamp: Date.now(),
      },
    );

    return {
      quality,
      recommendations,
      shouldFallback,
    };
  },
});

/**
 * Internal helpers for actions to read data (actions can't access DB directly)
 */
export const getParticipantForAccess = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: WebRTCApiResponseV.participantAccess,
  handler: async (ctx, { meetingId }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    return {
      _id: participant._id,
      meetingId: participant.meetingId,
      userId: participant.userId,
      role: participant.role,
      presence: participant.presence,
      createdAt: participant.createdAt,
    };
  },
});

export const getMeetingDoc = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: WebRTCApiResponseV.meetingDoc,
  handler: async (ctx, { meetingId }) => {
    const meeting = await ctx.db.get(meetingId);
    return meeting ?? null;
  },
});

export const getVideoRoomConfigByMeeting = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: WebRTCApiResponseV.videoRoomConfig,
  handler: async (ctx, { meetingId }) => {
    const config: VideoRoomConfig | null = await ctx.db
      .query("videoRoomConfigs")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    return config ?? null;
  },
});
