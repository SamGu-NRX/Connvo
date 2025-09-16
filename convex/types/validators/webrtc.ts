/**
 * WebRTC Entity Validators
 *
 * This module provides Convex validators that correspond to the WebRTC entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns for real-time systems
 */

import { v } from "convex/values";
import type {
  WebRTCSession,
  WebRTCSignal,
  ConnectionMetrics,
  WebRTCSessionWithUser,
  WebRTCSignalWithUsers,
  ConnectionMetricsSummary,
  WebRTCRoomStatus,
  WebRTCEvent,
  WebRTCDiagnostics,
  SDPData,
  ICEData,
} from "../entities/webrtc";

// WebRTC session state validator
const webrtcSessionStateV = v.union(
  v.literal("connecting"),
  v.literal("connected"),
  v.literal("disconnected"),
  v.literal("failed"),
  v.literal("closed"),
);

// WebRTC signal type validator
const webrtcSignalTypeV = v.union(v.literal("sdp"), v.literal("ice"));

// Connection quality validator
const connectionQualityV = v.union(
  v.literal("excellent"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("poor"),
);

// Metadata validator (matches lib/validators.ts)
const metadataRecordV = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

// SDP data validator
const sdpDataV = v.object({
  type: v.union(
    v.literal("offer"),
    v.literal("answer"),
    v.literal("pranswer"),
    v.literal("rollback"),
  ),
  sdp: v.string(),
});

// ICE data validator
const iceDataV = v.object({
  candidate: v.string(),
  sdpMLineIndex: v.optional(v.number()),
  sdpMid: v.optional(v.string()),
  usernameFragment: v.optional(v.string()),
});

// Connection stats validator
const connectionStatsV = v.object({
  bitrate: v.number(),
  packetLoss: v.number(),
  latency: v.number(),
  jitter: v.number(),
});

// Core WebRTC Session validators (matches schema exactly)
export const WebRTCSessionV = {
  // Full session entity
  full: v.object({
    _id: v.id("webrtcSessions"),
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    state: webrtcSessionStateV,
    metadata: v.optional(metadataRecordV),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  // Session with user details
  withUser: v.object({
    _id: v.id("webrtcSessions"),
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    state: webrtcSessionStateV,
    metadata: v.optional(metadataRecordV),
    createdAt: v.number(),
    updatedAt: v.number(),
    user: v.object({
      _id: v.id("users"),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
    }),
    connectionQuality: v.optional(connectionQualityV),
    lastMetricsAt: v.optional(v.number()),
  }),
} as const;

// WebRTC Signal validators (matches schema exactly with discriminated unions)
export const WebRTCSignalV = {
  // Full signal entity with discriminated union for signal data
  full: v.object({
    _id: v.id("webrtcSignals"),
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    fromUserId: v.id("users"),
    toUserId: v.optional(v.id("users")), // null for broadcast signals
    type: webrtcSignalTypeV,
    // Discriminated union: SDP or ICE candidate data based on type
    data: v.union(
      // SDP signal
      v.object({
        type: v.union(
          v.literal("offer"),
          v.literal("answer"),
          v.literal("pranswer"),
          v.literal("rollback"),
        ),
        sdp: v.string(),
      }),
      // ICE signal
      v.object({
        candidate: v.string(),
        sdpMLineIndex: v.optional(v.number()),
        sdpMid: v.optional(v.string()),
        usernameFragment: v.optional(v.string()),
      }),
    ),
    timestamp: v.number(),
    processed: v.boolean(),
  }),

  // Signal with user details
  withUsers: v.object({
    _id: v.id("webrtcSignals"),
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    fromUserId: v.id("users"),
    toUserId: v.optional(v.id("users")),
    type: webrtcSignalTypeV,
    data: v.union(sdpDataV, iceDataV),
    timestamp: v.number(),
    processed: v.boolean(),
    fromUser: v.object({
      _id: v.id("users"),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
    }),
    toUser: v.optional(
      v.object({
        _id: v.id("users"),
        displayName: v.optional(v.string()),
        avatarUrl: v.optional(v.string()),
      }),
    ),
  }),
} as const;

// Connection Metrics validators (matches schema exactly)
export const ConnectionMetricsV = {
  // Full metrics entity
  full: v.object({
    _id: v.id("connectionMetrics"),
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    quality: connectionQualityV,
    stats: connectionStatsV,
    timestamp: v.number(),
    createdAt: v.number(),
  }),

  // Metrics summary
  summary: v.object({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    averageQuality: connectionQualityV,
    qualityHistory: v.array(
      v.object({
        quality: connectionQualityV,
        timestamp: v.number(),
        duration: v.number(),
      }),
    ),
    currentStats: connectionStatsV,
    trends: v.object({
      bitrateChange: v.number(),
      packetLossChange: v.number(),
      latencyChange: v.number(),
      jitterChange: v.number(),
    }),
  }),
} as const;

// WebRTC Room Status validators
export const WebRTCRoomStatusV = {
  full: v.object({
    meetingId: v.id("meetings"),
    totalSessions: v.number(),
    connectedSessions: v.number(),
    averageQuality: connectionQualityV,
    activeSpeakers: v.array(v.string()),
    networkIssues: v.object({
      highLatency: v.number(),
      packetLoss: v.number(),
      connectionDrops: v.number(),
    }),
    lastUpdated: v.number(),
  }),
} as const;

// WebRTC Event validators
export const WebRTCEventV = {
  full: v.object({
    type: v.union(
      v.literal("session_state_change"),
      v.literal("signal_received"),
      v.literal("quality_update"),
      v.literal("connection_issue"),
    ),
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    data: v.any(),
    timestamp: v.number(),
  }),
} as const;

// WebRTC Diagnostics validators
export const WebRTCDiagnosticsV = {
  full: v.object({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    issues: v.array(
      v.object({
        type: v.union(
          v.literal("audio"),
          v.literal("video"),
          v.literal("connection"),
          v.literal("signaling"),
        ),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical"),
        ),
        description: v.string(),
        timestamp: v.number(),
        resolved: v.optional(v.boolean()),
        resolvedAt: v.optional(v.number()),
      }),
    ),
    recommendations: v.array(v.string()),
    systemInfo: v.object({
      browser: v.string(),
      os: v.string(),
      networkType: v.optional(v.string()),
      bandwidth: v.optional(v.number()),
    }),
  }),
} as const;

// Advanced WebRTC validators for complex signaling scenarios

// Peer Connection State validators
export const PeerConnectionStateV = {
  full: v.object({
    sessionId: v.string(),
    connectionState: v.union(
      v.literal("new"),
      v.literal("connecting"),
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("failed"),
      v.literal("closed"),
    ),
    iceConnectionState: v.union(
      v.literal("new"),
      v.literal("checking"),
      v.literal("connected"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("disconnected"),
      v.literal("closed"),
    ),
    iceGatheringState: v.union(
      v.literal("new"),
      v.literal("gathering"),
      v.literal("complete"),
    ),
    signalingState: v.union(
      v.literal("stable"),
      v.literal("have-local-offer"),
      v.literal("have-remote-offer"),
      v.literal("have-local-pranswer"),
      v.literal("have-remote-pranswer"),
      v.literal("closed"),
    ),
    lastStateChange: v.number(),
    stateHistory: v.array(
      v.object({
        state: v.string(),
        timestamp: v.number(),
        reason: v.optional(v.string()),
      }),
    ),
  }),
} as const;

// Extended ICE Candidate validators
export const ExtendedICECandidateV = {
  full: v.object({
    candidate: v.string(),
    sdpMLineIndex: v.optional(v.number()),
    sdpMid: v.optional(v.string()),
    usernameFragment: v.optional(v.string()),
    foundation: v.string(),
    component: v.number(),
    protocol: v.union(v.literal("udp"), v.literal("tcp")),
    priority: v.number(),
    address: v.string(),
    port: v.number(),
    type: v.union(
      v.literal("host"),
      v.literal("srflx"),
      v.literal("prflx"),
      v.literal("relay"),
    ),
    relatedAddress: v.optional(v.string()),
    relatedPort: v.optional(v.number()),
    tcpType: v.optional(
      v.union(v.literal("active"), v.literal("passive"), v.literal("so")),
    ),
  }),
} as const;

// Extended SDP Data validators
export const ExtendedSDPDataV = {
  full: v.object({
    type: v.union(
      v.literal("offer"),
      v.literal("answer"),
      v.literal("pranswer"),
      v.literal("rollback"),
    ),
    sdp: v.string(),
    parsed: v.object({
      version: v.number(),
      origin: v.object({
        username: v.string(),
        sessionId: v.string(),
        sessionVersion: v.number(),
        netType: v.string(),
        addrType: v.string(),
        unicastAddress: v.string(),
      }),
      sessionName: v.string(),
      mediaDescriptions: v.array(
        v.object({
          type: v.union(
            v.literal("audio"),
            v.literal("video"),
            v.literal("application"),
          ),
          port: v.number(),
          protocol: v.string(),
          formats: v.array(v.string()),
          attributes: v.record(v.string(), v.string()),
        }),
      ),
      attributes: v.record(v.string(), v.string()),
    }),
    fingerprint: v.optional(v.string()),
    iceUfrag: v.optional(v.string()),
    icePwd: v.optional(v.string()),
  }),
} as const;

// Signaling Flow validators
export const SignalingFlowV = {
  full: v.object({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    participants: v.array(v.id("users")),
    flowType: v.union(
      v.literal("offer_answer"),
      v.literal("renegotiation"),
      v.literal("ice_restart"),
    ),
    initiator: v.id("users"),
    steps: v.array(
      v.object({
        stepId: v.string(),
        type: v.union(
          v.literal("offer"),
          v.literal("answer"),
          v.literal("ice_candidate"),
          v.literal("ice_complete"),
        ),
        fromUser: v.id("users"),
        toUser: v.optional(v.id("users")),
        timestamp: v.number(),
        processed: v.boolean(),
        processingTime: v.optional(v.number()),
        error: v.optional(v.string()),
      }),
    ),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("timeout"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    duration: v.optional(v.number()),
  }),
} as const;

// Network Topology validators
export const NetworkTopologyV = {
  full: v.object({
    meetingId: v.id("meetings"),
    participants: v.array(
      v.object({
        userId: v.id("users"),
        sessionId: v.string(),
        publicIP: v.string(),
        localIPs: v.array(v.string()),
        natType: v.union(
          v.literal("none"),
          v.literal("full_cone"),
          v.literal("restricted"),
          v.literal("port_restricted"),
          v.literal("symmetric"),
        ),
        stunServers: v.array(v.string()),
        turnServers: v.array(v.string()),
        selectedCandidatePair: v.optional(
          v.object({
            local: ExtendedICECandidateV.full,
            remote: ExtendedICECandidateV.full,
            state: v.union(
              v.literal("waiting"),
              v.literal("in_progress"),
              v.literal("succeeded"),
              v.literal("failed"),
            ),
          }),
        ),
      }),
    ),
    connections: v.array(
      v.object({
        from: v.id("users"),
        to: v.id("users"),
        connectionType: v.union(
          v.literal("direct"),
          v.literal("relay"),
          v.literal("turn"),
        ),
        latency: v.number(),
        bandwidth: v.number(),
        packetLoss: v.number(),
        established: v.boolean(),
      }),
    ),
    lastUpdated: v.number(),
  }),
} as const;

// Bandwidth Management validators
export const BandwidthManagementV = {
  full: v.object({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    constraints: v.object({
      maxBitrate: v.number(),
      minBitrate: v.number(),
      targetBitrate: v.number(),
      adaptationEnabled: v.boolean(),
    }),
    currentUsage: v.object({
      audioBitrate: v.number(),
      videoBitrate: v.number(),
      totalBitrate: v.number(),
      timestamp: v.number(),
    }),
    adaptationHistory: v.array(
      v.object({
        timestamp: v.number(),
        reason: v.union(
          v.literal("network_congestion"),
          v.literal("cpu_limitation"),
          v.literal("manual_adjustment"),
        ),
        oldBitrate: v.number(),
        newBitrate: v.number(),
        quality: connectionQualityV,
      }),
    ),
    networkConditions: v.object({
      availableBandwidth: v.number(),
      rtt: v.number(),
      packetLoss: v.number(),
      jitter: v.number(),
      lastMeasured: v.number(),
    }),
  }),
} as const;

// Media Stream Config validators
export const MediaStreamConfigV = {
  full: v.object({
    sessionId: v.string(),
    userId: v.id("users"),
    audio: v.object({
      enabled: v.boolean(),
      codec: v.string(),
      sampleRate: v.number(),
      channels: v.number(),
      bitrate: v.number(),
      echoCancellation: v.boolean(),
      noiseSuppression: v.boolean(),
      autoGainControl: v.boolean(),
    }),
    video: v.object({
      enabled: v.boolean(),
      codec: v.string(),
      resolution: v.object({
        width: v.number(),
        height: v.number(),
      }),
      frameRate: v.number(),
      bitrate: v.number(),
      keyFrameInterval: v.number(),
    }),
    screen: v.optional(
      v.object({
        enabled: v.boolean(),
        resolution: v.object({
          width: v.number(),
          height: v.number(),
        }),
        frameRate: v.number(),
        bitrate: v.number(),
      }),
    ),
    lastUpdated: v.number(),
  }),
} as const;

// WebRTC Security validators
export const WebRTCSecurityV = {
  full: v.object({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    encryption: v.object({
      dtlsFingerprint: v.string(),
      srtpCipher: v.string(),
      srtcpCipher: v.string(),
      keyExchangeMethod: v.union(v.literal("DTLS-SRTP"), v.literal("SDES")),
    }),
    certificates: v.array(
      v.object({
        fingerprint: v.string(),
        algorithm: v.union(
          v.literal("sha-1"),
          v.literal("sha-224"),
          v.literal("sha-256"),
          v.literal("sha-384"),
          v.literal("sha-512"),
        ),
        expires: v.number(),
        selfSigned: v.boolean(),
      }),
    ),
    securityEvents: v.array(
      v.object({
        type: v.union(
          v.literal("certificate_verification"),
          v.literal("dtls_handshake"),
          v.literal("srtp_key_exchange"),
        ),
        status: v.union(
          v.literal("success"),
          v.literal("failure"),
          v.literal("warning"),
        ),
        timestamp: v.number(),
        details: v.optional(v.string()),
      }),
    ),
  }),
} as const;

// WebRTC Stats validators
export const WebRTCStatsV = {
  full: v.object({
    sessionId: v.string(),
    userId: v.id("users"),
    timestamp: v.number(),
    inbound: v.object({
      audio: v.object({
        packetsReceived: v.number(),
        bytesReceived: v.number(),
        packetsLost: v.number(),
        jitter: v.number(),
        audioLevel: v.number(),
      }),
      video: v.object({
        packetsReceived: v.number(),
        bytesReceived: v.number(),
        packetsLost: v.number(),
        framesReceived: v.number(),
        framesDropped: v.number(),
        frameWidth: v.number(),
        frameHeight: v.number(),
      }),
    }),
    outbound: v.object({
      audio: v.object({
        packetsSent: v.number(),
        bytesSent: v.number(),
        audioLevel: v.number(),
      }),
      video: v.object({
        packetsSent: v.number(),
        bytesSent: v.number(),
        framesSent: v.number(),
        frameWidth: v.number(),
        frameHeight: v.number(),
        qualityLimitationReason: v.optional(
          v.union(
            v.literal("none"),
            v.literal("cpu"),
            v.literal("bandwidth"),
            v.literal("other"),
          ),
        ),
      }),
    }),
    connection: v.object({
      availableOutgoingBitrate: v.number(),
      availableIncomingBitrate: v.number(),
      currentRoundTripTime: v.number(),
      totalRoundTripTime: v.number(),
      responsesSent: v.number(),
      responsesReceived: v.number(),
    }),
  }),
} as const;

// WebRTC Error validators
export const WebRTCErrorV = {
  full: v.object({
    sessionId: v.string(),
    userId: v.id("users"),
    errorType: v.union(
      v.literal("ice_failure"),
      v.literal("dtls_failure"),
      v.literal("media_failure"),
      v.literal("signaling_timeout"),
      v.literal("network_error"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    message: v.string(),
    stack: v.optional(v.string()),
    context: v.object({
      connectionState: v.string(),
      iceConnectionState: v.string(),
      signalingState: v.string(),
      timestamp: v.number(),
    }),
    recovery: v.object({
      attempted: v.boolean(),
      strategy: v.optional(
        v.union(
          v.literal("ice_restart"),
          v.literal("reconnect"),
          v.literal("fallback_to_turn"),
        ),
      ),
      success: v.optional(v.boolean()),
      recoveryTime: v.optional(v.number()),
    }),
    metadata: v.record(v.string(), v.any()),
  }),
} as const;
