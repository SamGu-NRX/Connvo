/**
 * WebRTC Signaling Server Implementation
 *
 * This module provides WebRTC signaling through Convex real-time infrastructure,
 * enabling peer-to-peer video/audio connections with comprehensive session management.
 * Integrated with the hybrid video provider architecture.
 *
 * Requirements: 6.2, 6.3, 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex function patterns
 */

import {
  mutation,
  query,
  internalMutation,
  action,
  internalQuery,
} from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireIdentity, assertMeetingAccess } from "../auth/guards";
import {
  VideoProviderFactory,
  VideoProviderUtils,
} from "../lib/videoProviders";
import { metadataRecordV } from "../lib/validators";
import {
  MeetingV,
  MeetingParticipantV,
  VideoRoomConfigV,
} from "../types/validators/meeting";
import {
  WebRTCSessionV,
  WebRTCSignalV,
  ConnectionMetricsV,
  webrtcSessionStateV,
  sdpDataV,
  iceDataV,
  connectionQualityV,
  connectionStatsV,
} from "../types/validators/webrtc";
import type {
  Meeting,
  MeetingParticipant,
  VideoRoomConfig,
  ICEServer,
  VideoRoomFeatures,
} from "../types/entities/meeting";
import type {
  WebRTCSession,
  WebRTCSignal,
  WebRTCSessionState,
  WebRTCSignalType,
  ConnectionQuality,
  ConnectionMetrics,
  SDPData,
  ICEData,
} from "../types/entities/webrtc";

/**
 * Initializes WebRTC room for a meeting using the provider abstraction
 */
export const initializeWebRTCRoom = action({
  args: {
    meetingId: v.id("meetings"),
    maxParticipants: v.optional(v.number()),
  },
  returns: v.object({
    roomId: v.string(),
    provider: v.union(v.literal("webrtc"), v.literal("getstream")),
    iceServers: v.optional(
      v.array(
        v.object({
          urls: v.union(v.string(), v.array(v.string())),
          username: v.optional(v.string()),
          credential: v.optional(v.string()),
        }),
      ),
    ),
    features: v.object({
      recording: v.boolean(),
      transcription: v.boolean(),
      maxParticipants: v.number(),
      screenSharing: v.boolean(),
      chat: v.boolean(),
    }),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, maxParticipants = 4 }) => {
    const identity = await requireIdentity(ctx);

    // Verify user is a participant via internal query
    const participant: {
      _id: Id<"meetingParticipants">;
      meetingId: Id<"meetings">;
      userId: Id<"users">;
      role: "host" | "participant" | "observer";
      presence: "invited" | "joined" | "left";
    } = await ctx.runQuery(internal.meetings.webrtc.getParticipantForAccess, {
      meetingId,
    });
    // Fetch meeting via internal query
    const meeting: {
      _id: Id<"meetings">;
      organizerId: Id<"users">;
      title: string;
      description?: string;
      scheduledAt?: number;
      duration?: number;
      webrtcEnabled?: boolean;
      streamRoomId?: string;
      state: "scheduled" | "active" | "concluded" | "cancelled";
      createdAt: number;
      updatedAt: number;
    } | null = await ctx.runQuery(internal.meetings.webrtc.getMeetingDoc, {
      meetingId,
    });
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
    const _storedRoom: null = await ctx.runMutation(
      internal.meetings.webrtc.storeRoomConfiguration,
      {
        meetingId,
        roomConfig: {
          roomId: roomConfig.roomId,
          provider: roomConfig.provider,
          iceServers: roomConfig.iceServers,
          features: roomConfig.features,
        },
      },
    );

    return {
      roomId: roomConfig.roomId,
      provider: roomConfig.provider,
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
    roomConfig: v.object({
      roomId: v.string(),
      provider: v.union(v.literal("webrtc"), v.literal("getstream")),
      iceServers: v.optional(
        v.array(
          v.object({
            urls: v.union(v.string(), v.array(v.string())),
            username: v.optional(v.string()),
            credential: v.optional(v.string()),
          }),
        ),
      ),
      features: v.object({
        recording: v.boolean(),
        transcription: v.boolean(),
        maxParticipants: v.number(),
        screenSharing: v.boolean(),
        chat: v.boolean(),
      }),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, roomConfig }) => {
    // Update meeting with room configuration
    await ctx.db.patch(meetingId, {
      streamRoomId: roomConfig.roomId,
      webrtcEnabled: roomConfig.provider === "webrtc",
      updatedAt: Date.now(),
    });

    // Store detailed room configuration
    await ctx.db.insert("videoRoomConfigs", {
      meetingId,
      roomId: roomConfig.roomId,
      provider: roomConfig.provider,
      iceServers: roomConfig.iceServers,
      features: roomConfig.features,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Creates a WebRTC session for a meeting
 */
export const createWebRTCSession = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
  },
  returns: v.object({
    sessionId: v.string(),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, sessionId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation(
        "Cannot create WebRTC session for inactive meeting",
      );
    }

    // Check if session already exists
    const existingSession = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_and_session", (q) =>
        q.eq("meetingId", meetingId).eq("sessionId", sessionId),
      )
      .unique();

    if (existingSession) {
      return {
        sessionId: existingSession.sessionId,
        success: true,
      };
    }

    // Create new WebRTC session
    await ctx.db.insert("webrtcSessions", {
      meetingId,
      sessionId,
      userId: participant.userId,
      state: "connecting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      sessionId,
      success: true,
    };
  },
});

/**
 * Exchanges SDP offer/answer for WebRTC negotiation
 */
export const exchangeSessionDescription = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    description: sdpDataV,
    targetUserId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, description, targetUserId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    // Store the SDP offer/answer
    await ctx.db.insert("webrtcSignals", {
      meetingId,
      sessionId,
      fromUserId: participant.userId,
      toUserId: targetUserId,
      type: "sdp",
      data: {
        type: description.type,
        sdp: description.sdp,
      },
      timestamp: Date.now(),
      processed: false,
    });

    return null;
  },
});

/**
 * Exchanges ICE candidates for WebRTC connection establishment
 */
export const exchangeICECandidate = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    candidate: iceDataV,
    targetUserId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, candidate, targetUserId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Store the ICE candidate
    await ctx.db.insert("webrtcSignals", {
      meetingId,
      sessionId,
      fromUserId: participant.userId,
      toUserId: targetUserId,
      type: "ice",
      data: {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
        usernameFragment: candidate.usernameFragment,
      },
      timestamp: Date.now(),
      processed: false,
    });

    return null;
  },
});

/**
 * Gets pending WebRTC signals for a user in a meeting
 */
export const getPendingSignals = query({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.optional(v.string()),
    lastSignalId: v.optional(v.id("webrtcSignals")),
  },
  returns: v.array(
    v.object({
      _id: v.id("webrtcSignals"),
      sessionId: v.string(),
      fromUserId: v.id("users"),
      type: v.union(v.literal("sdp"), v.literal("ice")),
      data: v.union(sdpDataV, iceDataV),
      timestamp: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId, sessionId, lastSignalId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    let baseQuery = ctx.db
      .query("webrtcSignals")
      .withIndex("by_meeting_target_and_processed", (q) =>
        q
          .eq("meetingId", meetingId)
          .eq("toUserId", participant.userId)
          .eq("processed", false),
      );

    // Apply optional filters in-memory to avoid additional indexes explosion
    let signals = await baseQuery.order("asc").take(200);
    if (sessionId) {
      signals = signals.filter((s) => s.sessionId === sessionId);
    }

    if (lastSignalId) {
      signals = signals.filter((s) => s._id > lastSignalId);
    }
    signals = signals.slice(0, 50); // hard cap to prevent overwhelming clients

    return signals.map((signal) => ({
      _id: signal._id,
      sessionId: signal.sessionId,
      fromUserId: signal.fromUserId,
      type: signal.type,
      data: signal.data,
      timestamp: signal.timestamp,
    }));
  },
});

/**
 * Marks WebRTC signals as processed
 */
export const markSignalsProcessed = mutation({
  args: {
    signalIds: v.array(v.id("webrtcSignals")),
  },
  returns: v.null(),
  handler: async (ctx, { signalIds }) => {
    const identity = await requireIdentity(ctx);

    for (const signalId of signalIds) {
      const signal = await ctx.db.get(signalId);
      if (signal && signal.toUserId === identity.userId) {
        await ctx.db.patch(signalId, {
          processed: true,
        });
      }
    }

    return null;
  },
});

/**
 * Updates WebRTC session state
 */
export const updateSessionState = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    state: webrtcSessionStateV,
    metadata: v.optional(metadataRecordV),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, state, metadata }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    // Use composite index by_user_and_meeting and check sessionId in memory
    const candidateSessions = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_user_and_meeting", (q) =>
        q.eq("userId", participant.userId).eq("meetingId", meetingId),
      )
      .collect();
    const session =
      candidateSessions.find((s) => s.sessionId === sessionId) || null;

    if (!session) {
      throw createError.notFound("WebRTC session not found");
    }

    await ctx.db.patch(session._id, {
      state,
      metadata,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Gets active WebRTC sessions for a meeting
 */
export const getActiveSessions = query({
  args: { meetingId: v.id("meetings") },
  returns: v.array(WebRTCSessionV.withUser),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    await assertMeetingAccess(ctx, meetingId);

    // Use composite index by_meeting_and_state and union acceptable states
    const states: Array<"connecting" | "connected" | "disconnected"> = [
      "connecting",
      "connected",
      "disconnected",
    ];
    const results = await Promise.all(
      states.map((state) =>
        ctx.db
          .query("webrtcSessions")
          .withIndex("by_meeting_and_state", (q) =>
            q.eq("meetingId", meetingId).eq("state", state),
          )
          .collect(),
      ),
    );
    const sessions = results.flat();

    // Enrich with user details
    const enrichedSessions = [];
    for (const session of sessions) {
      const user = await ctx.db.get(session.userId);
      if (user) {
        enrichedSessions.push({
          ...session,
          user: {
            _id: user._id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
          connectionQuality: undefined, // Will be populated by metrics if available
          lastMetricsAt: undefined,
        });
      }
    }

    return enrichedSessions;
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
  returns: v.object({
    token: v.string(),
    provider: v.union(v.literal("webrtc"), v.literal("getstream")),
    roomId: v.string(),
    participantId: v.string(),
    permissions: v.object({
      canRecord: v.boolean(),
      canMute: v.boolean(),
      canKick: v.boolean(),
      canShare: v.boolean(),
    }),
    success: v.boolean(),
  }),
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

    const meeting = await ctx.runQuery(internal.meetings.webrtc.getMeetingDoc, {
      meetingId,
    });
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation(
        "Cannot generate token for inactive meeting",
      );
    }

    // Get room configuration
    const roomConfig = await ctx.runQuery(
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

    // Generate token using provider
    const token = await provider.generateParticipantToken(
      roomConfig.roomId,
      participant.userId,
      participant.role,
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
 * Closes a WebRTC session
 */
export const closeSession = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    const candidateSessions2 = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_user_and_meeting", (q) =>
        q.eq("userId", participant.userId).eq("meetingId", meetingId),
      )
      .collect();
    const session =
      candidateSessions2.find((s) => s.sessionId === sessionId) || null;

    if (session) {
      await ctx.db.patch(session._id, {
        state: "closed",
        updatedAt: Date.now(),
      });
    }

    return null;
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
  returns: v.object({
    success: v.boolean(),
    fallbackProvider: v.optional(
      v.union(v.literal("webrtc"), v.literal("getstream")),
    ),
    retryRecommended: v.boolean(),
  }),
  handler: async (ctx, { meetingId, sessionId, errorType, errorDetails }) => {
    const identity = await requireIdentity(ctx);
    // Verify user is a participant
    const _p1: {
      _id: Id<"meetingParticipants">;
      meetingId: Id<"meetings">;
      userId: Id<"users">;
      role: "host" | "participant" | "observer";
      presence: "invited" | "joined" | "left";
    } = await ctx.runQuery(internal.meetings.webrtc.getParticipantForAccess, {
      meetingId,
    });

    // Log the error for monitoring
    console.error(`WebRTC connection failure: ${errorType}`, {
      meetingId,
      sessionId,
      userId: identity.userId,
      errorDetails,
    });

    // Update session state to failed
    const _updated0: null = await ctx.runMutation(
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
    const roomConfig: {
      _id: Id<"videoRoomConfigs">;
      meetingId: Id<"meetings">;
      roomId: string;
      provider: "webrtc" | "getstream";
      iceServers?: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
      }>;
      features: {
        recording: boolean;
        transcription: boolean;
        maxParticipants: number;
        screenSharing: boolean;
        chat: boolean;
      };
      createdAt: number;
      updatedAt: number;
    } | null = await ctx.runQuery(
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
 * Internal mutation to update session state
 */
export const updateSessionStateInternal = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    state: webrtcSessionStateV,
    metadata: v.optional(metadataRecordV),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, state, metadata }) => {
    const session = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_and_session", (q) =>
        q.eq("meetingId", meetingId).eq("sessionId", sessionId),
      )
      .unique();

    if (session) {
      await ctx.db.patch(session._id, {
        state,
        metadata,
        updatedAt: Date.now(),
      });
    }

    return null;
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
  returns: v.object({
    quality: connectionQualityV,
    recommendations: v.array(v.string()),
    shouldFallback: v.boolean(),
  }),
  handler: async (ctx, { meetingId, sessionId, stats }) => {
    const identity = await requireIdentity(ctx);
    // Verify user is a participant
    const _participant: {
      _id: Id<"meetingParticipants">;
      meetingId: Id<"meetings">;
      userId: Id<"users">;
      role: "host" | "participant" | "observer";
      presence: "invited" | "joined" | "left";
    } = await ctx.runQuery(internal.meetings.webrtc.getParticipantForAccess, {
      meetingId,
    });

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
        userId: identity.userId as Id<"users">,
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
  returns: v.object({
    _id: v.id("meetingParticipants"),
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: v.union(
      v.literal("host"),
      v.literal("participant"),
      v.literal("observer"),
    ),
    presence: v.union(
      v.literal("invited"),
      v.literal("joined"),
      v.literal("left"),
    ),
  }),
  handler: async (ctx, { meetingId }) => {
    const participant = await assertMeetingAccess(ctx as any, meetingId);
    return {
      _id: participant._id,
      meetingId: participant.meetingId,
      userId: participant.userId,
      role: participant.role as any,
      presence: participant.presence,
    };
  },
});

export const getMeetingDoc = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("meetings"),
      organizerId: v.id("users"),
      title: v.string(),
      description: v.optional(v.string()),
      scheduledAt: v.optional(v.number()),
      duration: v.optional(v.number()),
      webrtcEnabled: v.optional(v.boolean()),
      streamRoomId: v.optional(v.string()),
      state: v.union(
        v.literal("scheduled"),
        v.literal("active"),
        v.literal("concluded"),
        v.literal("cancelled"),
      ),
      participantCount: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId }) => {
    const m = await ctx.db.get(meetingId);
    return m ?? null;
  },
});

export const getVideoRoomConfigByMeeting = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("videoRoomConfigs"),
      meetingId: v.id("meetings"),
      roomId: v.string(),
      provider: v.union(v.literal("webrtc"), v.literal("getstream")),
      iceServers: v.optional(
        v.array(
          v.object({
            urls: v.union(v.string(), v.array(v.string())),
            username: v.optional(v.string()),
            credential: v.optional(v.string()),
          }),
        ),
      ),
      features: v.object({
        recording: v.boolean(),
        transcription: v.boolean(),
        maxParticipants: v.number(),
        screenSharing: v.boolean(),
        chat: v.boolean(),
      }),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId }) => {
    return await ctx.db
      .query("videoRoomConfigs")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
  },
});

/**
 * Stores connection quality metrics
 */
export const storeConnectionMetrics = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    quality: connectionQualityV,
    stats: connectionStatsV,
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("connectionMetrics", {
      meetingId: args.meetingId,
      sessionId: args.sessionId,
      userId: args.userId,
      quality: args.quality,
      stats: args.stats,
      timestamp: args.timestamp,
      createdAt: Date.now(),
    });

    return null;
  },
});

/**
 * Cleanup old WebRTC signals and sessions
 */
export const cleanupOldWebRTCData = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
  },
  returns: v.object({
    signalsDeleted: v.number(),
    sessionsDeleted: v.number(),
  }),
  handler: async (ctx, { olderThanMs = 24 * 60 * 60 * 1000 }) => {
    // Default 24 hours
    const cutoff = Date.now() - olderThanMs;

    // Clean up old processed signals
    const oldSignals = await ctx.db
      .query("webrtcSignals")
      .withIndex("by_processed_and_timestamp", (q) =>
        q.eq("processed", true).lt("timestamp", cutoff),
      )
      .collect();

    for (const signal of oldSignals) {
      await ctx.db.delete(signal._id);
    }

    // Clean up old closed/failed sessions
    const [closedSessions, failedSessions] = await Promise.all([
      ctx.db
        .query("webrtcSessions")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", "closed").lt("updatedAt", cutoff),
        )
        .collect(),
      ctx.db
        .query("webrtcSessions")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", "failed").lt("updatedAt", cutoff),
        )
        .collect(),
    ]);
    const oldSessions = [...closedSessions, ...failedSessions];

    for (const session of oldSessions) {
      await ctx.db.delete(session._id);
    }

    return {
      signalsDeleted: oldSignals.length,
      sessionsDeleted: oldSessions.length,
    };
  },
});
