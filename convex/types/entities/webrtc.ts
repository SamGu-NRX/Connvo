/**
 * WebRTC Entity Type Definitions
 *
 * This module defines all WebRTC-related entity types for real-time communication,
 * signaling, and connection quality monitoring.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling for real-time systems
 */

import type { Id } from "@convex/_generated/dataModel";

// WebRTC session states (matches schema exactly)
export type WebRTCSessionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

// WebRTC signal types (matches schema exactly)
export type WebRTCSignalType = "sdp" | "ice";

// Connection quality levels (matches schema exactly)
export type ConnectionQuality = "excellent" | "good" | "fair" | "poor";

// WebRTC session entity (matches convex/schema/webrtc.ts exactly)
export interface WebRTCSession {
  _id: Id<"webrtcSessions">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  state: WebRTCSessionState;
  metadata?: Record<string, string | number | boolean>;
  createdAt: number;
  updatedAt: number;
}

// SDP data structure (matches schema exactly)
export interface SDPData {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
}

// ICE candidate data structure (matches schema exactly)
export interface ICEData {
  candidate: string;
  sdpMLineIndex?: number;
  sdpMid?: string;
  usernameFragment?: string;
}

// WebRTC signal entity (matches schema exactly)
export interface WebRTCSignal {
  _id: Id<"webrtcSignals">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  sessionId: string;
  fromUserId: Id<"users">;
  toUserId?: Id<"users">; // null for broadcast signals
  type: WebRTCSignalType;
  // SDP or ICE candidate data
  data: SDPData | ICEData;
  timestamp: number;
  processed: boolean;
}

// Connection quality metrics (matches schema exactly)
export interface ConnectionMetrics {
  _id: Id<"connectionMetrics">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  quality: ConnectionQuality;
  stats: {
    bitrate: number;
    packetLoss: number;
    latency: number;
    jitter: number;
  };
  timestamp: number;
  createdAt: number;
}

// Derived types for API responses

// WebRTC session with user details
export interface WebRTCSessionWithUser extends WebRTCSession {
  user: {
    _id: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
  };
  connectionQuality?: ConnectionQuality;
  lastMetricsAt?: number;
}

// WebRTC signal with user details
export interface WebRTCSignalWithUsers extends WebRTCSignal {
  fromUser: {
    _id: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
  };
  toUser?: {
    _id: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
  };
}

// Connection metrics summary
export interface ConnectionMetricsSummary {
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  averageQuality: ConnectionQuality;
  qualityHistory: Array<{
    quality: ConnectionQuality;
    timestamp: number;
    duration: number;
  }>;
  currentStats: ConnectionMetrics["stats"];
  trends: {
    bitrateChange: number;
    packetLossChange: number;
    latencyChange: number;
    jitterChange: number;
  };
}

// WebRTC room status
export interface WebRTCRoomStatus {
  meetingId: Id<"meetings">;
  totalSessions: number;
  connectedSessions: number;
  averageQuality: ConnectionQuality;
  activeSpeakers: string[];
  networkIssues: {
    highLatency: number;
    packetLoss: number;
    connectionDrops: number;
  };
  lastUpdated: number;
}

// Real-time WebRTC events
export interface WebRTCEvent {
  type:
    | "session_state_change"
    | "signal_received"
    | "quality_update"
    | "connection_issue";
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  data: any;
  timestamp: number;
}

// WebRTC diagnostics
export interface WebRTCDiagnostics {
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  issues: Array<{
    type: "audio" | "video" | "connection" | "signaling";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    timestamp: number;
    resolved?: boolean;
    resolvedAt?: number;
  }>;
  recommendations: string[];
  systemInfo: {
    browser: string;
    os: string;
    networkType?: string;
    bandwidth?: number;
  };
}

// Advanced WebRTC signaling types for complex scenarios

// Peer connection state tracking
export interface PeerConnectionState {
  sessionId: string;
  connectionState:
    | "new"
    | "connecting"
    | "connected"
    | "disconnected"
    | "failed"
    | "closed";
  iceConnectionState:
    | "new"
    | "checking"
    | "connected"
    | "completed"
    | "failed"
    | "disconnected"
    | "closed";
  iceGatheringState: "new" | "gathering" | "complete";
  signalingState:
    | "stable"
    | "have-local-offer"
    | "have-remote-offer"
    | "have-local-pranswer"
    | "have-remote-pranswer"
    | "closed";
  lastStateChange: number;
  stateHistory: Array<{
    state: string;
    timestamp: number;
    reason?: string;
  }>;
}

// ICE candidate with extended information
export interface ExtendedICECandidate extends ICEData {
  foundation: string;
  component: number;
  protocol: "udp" | "tcp";
  priority: number;
  address: string;
  port: number;
  type: "host" | "srflx" | "prflx" | "relay";
  relatedAddress?: string;
  relatedPort?: number;
  tcpType?: "active" | "passive" | "so";
}

// SDP with parsing and analysis
export interface ExtendedSDPData extends SDPData {
  parsed: {
    version: number;
    origin: {
      username: string;
      sessionId: string;
      sessionVersion: number;
      netType: string;
      addrType: string;
      unicastAddress: string;
    };
    sessionName: string;
    mediaDescriptions: Array<{
      type: "audio" | "video" | "application";
      port: number;
      protocol: string;
      formats: string[];
      attributes: Record<string, string>;
    }>;
    attributes: Record<string, string>;
  };
  fingerprint?: string;
  iceUfrag?: string;
  icePwd?: string;
}

// WebRTC signaling flow tracking
export interface SignalingFlow {
  meetingId: Id<"meetings">;
  sessionId: string;
  participants: Id<"users">[];
  flowType: "offer_answer" | "renegotiation" | "ice_restart";
  initiator: Id<"users">;
  steps: Array<{
    stepId: string;
    type: "offer" | "answer" | "ice_candidate" | "ice_complete";
    fromUser: Id<"users">;
    toUser?: Id<"users">;
    timestamp: number;
    processed: boolean;
    processingTime?: number;
    error?: string;
  }>;
  status: "in_progress" | "completed" | "failed" | "timeout";
  startedAt: number;
  completedAt?: number;
  duration?: number;
}

// Network topology and routing
export interface NetworkTopology {
  meetingId: Id<"meetings">;
  participants: Array<{
    userId: Id<"users">;
    sessionId: string;
    publicIP: string;
    localIPs: string[];
    natType:
      | "none"
      | "full_cone"
      | "restricted"
      | "port_restricted"
      | "symmetric";
    stunServers: string[];
    turnServers: string[];
    selectedCandidatePair?: {
      local: ExtendedICECandidate;
      remote: ExtendedICECandidate;
      state: "waiting" | "in_progress" | "succeeded" | "failed";
    };
  }>;
  connections: Array<{
    from: Id<"users">;
    to: Id<"users">;
    connectionType: "direct" | "relay" | "turn";
    latency: number;
    bandwidth: number;
    packetLoss: number;
    established: boolean;
  }>;
  lastUpdated: number;
}

// Bandwidth management and adaptation
export interface BandwidthManagement {
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  constraints: {
    maxBitrate: number;
    minBitrate: number;
    targetBitrate: number;
    adaptationEnabled: boolean;
  };
  currentUsage: {
    audioBitrate: number;
    videoBitrate: number;
    totalBitrate: number;
    timestamp: number;
  };
  adaptationHistory: Array<{
    timestamp: number;
    reason: "network_congestion" | "cpu_limitation" | "manual_adjustment";
    oldBitrate: number;
    newBitrate: number;
    quality: ConnectionQuality;
  }>;
  networkConditions: {
    availableBandwidth: number;
    rtt: number;
    packetLoss: number;
    jitter: number;
    lastMeasured: number;
  };
}

// Media stream configuration
export interface MediaStreamConfig {
  sessionId: string;
  userId: Id<"users">;
  audio: {
    enabled: boolean;
    codec: string;
    sampleRate: number;
    channels: number;
    bitrate: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
  video: {
    enabled: boolean;
    codec: string;
    resolution: {
      width: number;
      height: number;
    };
    frameRate: number;
    bitrate: number;
    keyFrameInterval: number;
  };
  screen?: {
    enabled: boolean;
    resolution: {
      width: number;
      height: number;
    };
    frameRate: number;
    bitrate: number;
  };
  lastUpdated: number;
}

// WebRTC security and encryption
export interface WebRTCSecurity {
  meetingId: Id<"meetings">;
  sessionId: string;
  encryption: {
    dtlsFingerprint: string;
    srtpCipher: string;
    srtcpCipher: string;
    keyExchangeMethod: "DTLS-SRTP" | "SDES";
  };
  certificates: Array<{
    fingerprint: string;
    algorithm: "sha-1" | "sha-224" | "sha-256" | "sha-384" | "sha-512";
    expires: number;
    selfSigned: boolean;
  }>;
  securityEvents: Array<{
    type: "certificate_verification" | "dtls_handshake" | "srtp_key_exchange";
    status: "success" | "failure" | "warning";
    timestamp: number;
    details?: string;
  }>;
}

// Real-time statistics and monitoring
export interface WebRTCStats {
  sessionId: string;
  userId: Id<"users">;
  timestamp: number;
  inbound: {
    audio: {
      packetsReceived: number;
      bytesReceived: number;
      packetsLost: number;
      jitter: number;
      audioLevel: number;
    };
    video: {
      packetsReceived: number;
      bytesReceived: number;
      packetsLost: number;
      framesReceived: number;
      framesDropped: number;
      frameWidth: number;
      frameHeight: number;
    };
  };
  outbound: {
    audio: {
      packetsSent: number;
      bytesSent: number;
      audioLevel: number;
    };
    video: {
      packetsSent: number;
      bytesSent: number;
      framesSent: number;
      frameWidth: number;
      frameHeight: number;
      qualityLimitationReason?: "none" | "cpu" | "bandwidth" | "other";
    };
  };
  connection: {
    availableOutgoingBitrate: number;
    availableIncomingBitrate: number;
    currentRoundTripTime: number;
    totalRoundTripTime: number;
    responsesSent: number;
    responsesReceived: number;
  };
}

// WebRTC error tracking and recovery
export interface WebRTCError {
  sessionId: string;
  userId: Id<"users">;
  errorType:
    | "ice_failure"
    | "dtls_failure"
    | "media_failure"
    | "signaling_timeout"
    | "network_error";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  stack?: string;
  context: {
    connectionState: string;
    iceConnectionState: string;
    signalingState: string;
    timestamp: number;
  };
  recovery: {
    attempted: boolean;
    strategy?: "ice_restart" | "reconnect" | "fallback_to_turn";
    success?: boolean;
    recoveryTime?: number;
  };
  metadata: Record<string, any>;
}
