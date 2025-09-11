/**
 * Convex Database Schema
 *
 * This schema defines all collections for the LinkedUp application migration
 * from Drizzle ORM + PostgreSQL/Supabase to Convex.
 *
 * Requirements: 3.1, 3.2, 3.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex schema patterns
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // User Management
  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
    // Denormalized for performance
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    lastSeenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workos_id", ["workosUserId"])
    .index("by_org_and_active", ["orgId", "isActive"])
    .index("by_email", ["email"])
    .index("by_last_seen", ["lastSeenAt"])
    .index("by_org_and_role", ["orgId", "orgRole"]),

  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    goals: v.optional(v.string()),
    languages: v.array(v.string()),
    experience: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_updated", ["updatedAt"]),

  interests: defineTable({
    key: v.string(),
    label: v.string(),
    category: v.string(),
    // Denormalized field for performance
    usageCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_category", ["category"])
    .index("by_usage_count", ["usageCount"])
    .index("by_category_and_usage", ["category", "usageCount"]),

  userInterests: defineTable({
    userId: v.id("users"),
    interestKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_interest", ["interestKey"]),

  // Meeting System
  meetings: defineTable({
    organizerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    // WebRTC doesn't need external room IDs - signaling is handled internally
    webrtcEnabled: v.optional(v.boolean()),
    // GetStream room identifier when using paid provider
    streamRoomId: v.optional(v.string()),
    state: v.union(
      v.literal("scheduled"),
      v.literal("active"),
      v.literal("concluded"),
      v.literal("cancelled"),
    ),
    // Denormalized fields for performance
    participantCount: v.optional(v.number()),
    averageRating: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizer", ["organizerId"])
    .index("by_state", ["state"])
    .index("by_scheduled", ["scheduledAt"])
    .index("by_state_and_scheduled", ["state", "scheduledAt"])
    .index("by_organizer_and_state", ["organizerId", "state"])
    .index("by_stream_room_id", ["streamRoomId"]),

  meetingParticipants: defineTable({
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: v.union(
      v.literal("host"),
      v.literal("participant"),
      v.literal("observer"),
    ),
    joinedAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
    presence: v.union(
      v.literal("invited"),
      v.literal("joined"),
      v.literal("left"),
    ),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_meeting_and_user", ["meetingId", "userId"]),

  meetingState: defineTable({
    meetingId: v.id("meetings"),
    active: v.boolean(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    speakingStats: v.optional(v.any()),
    lullState: v.optional(
      v.object({
        detected: v.boolean(),
        lastActivity: v.number(),
        duration: v.number(),
      }),
    ),
    topics: v.array(v.string()),
    recordingEnabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_active", ["active"]),

  // Collaborative Notes
  meetingNotes: defineTable({
    meetingId: v.id("meetings"),
    content: v.string(),
    version: v.number(),
    lastRebasedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["meetingId"],
    }),

  noteOps: defineTable({
    meetingId: v.id("meetings"),
    sequence: v.number(),
    authorId: v.id("users"),
    operation: v.object({
      type: v.union(
        v.literal("insert"),
        v.literal("delete"),
        v.literal("retain"),
      ),
      position: v.number(),
      content: v.optional(v.string()),
      length: v.optional(v.number()),
    }),
    timestamp: v.number(),
    applied: v.boolean(),
  })
    .index("by_meeting_sequence", ["meetingId", "sequence"])
    .index("by_meeting_timestamp", ["meetingId", "timestamp"]),

  // Transcription System
  transcripts: defineTable({
    meetingId: v.id("meetings"),
    // Sharding key: time bucket (5-minute windows) to prevent hot partitions
    bucketMs: v.number(), // Math.floor(timestamp / 300000) * 300000
    sequence: v.number(),
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startMs: v.number(),
    endMs: v.number(),
    // Denormalized for performance
    wordCount: v.number(),
    language: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_meeting_bucket", ["meetingId", "bucketMs"])
    .index("by_meeting_bucket_seq", ["meetingId", "bucketMs", "sequence"])
    .index("by_meeting_time_range", ["meetingId", "startMs"])
    .index("by_bucket_global", ["bucketMs"]), // For cleanup jobs

  transcriptionSessions: defineTable({
    meetingId: v.id("meetings"),
    provider: v.union(
      v.literal("whisper"),
      v.literal("assemblyai"),
      v.literal("getstream"),
    ),
    status: v.union(
      v.literal("initializing"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_status", ["status"])
    .index("by_provider", ["provider"]),

  transcriptSegments: defineTable({
    meetingId: v.id("meetings"),
    startMs: v.number(),
    endMs: v.number(),
    speakers: v.array(v.string()),
    text: v.string(),
    topics: v.array(v.string()),
    sentiment: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_time", ["meetingId", "startMs"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["meetingId"],
    }),

  // AI Prompts and Insights
  prompts: defineTable({
    meetingId: v.id("meetings"),
    type: v.union(v.literal("precall"), v.literal("incall")),
    content: v.string(),
    tags: v.array(v.string()),
    relevance: v.number(),
    usedAt: v.optional(v.number()),
    feedback: v.optional(
      v.union(v.literal("used"), v.literal("dismissed"), v.literal("upvoted")),
    ),
    createdAt: v.number(),
  })
    .index("by_meeting_type", ["meetingId", "type"])
    .index("by_meeting_relevance", ["meetingId", "relevance"]),

  insights: defineTable({
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(
      v.object({
        type: v.string(),
        content: v.string(),
        confidence: v.number(),
      }),
    ),
    links: v.array(
      v.object({
        type: v.string(),
        url: v.string(),
        title: v.string(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_meeting", ["meetingId"])
    .index("by_user_meeting", ["userId", "meetingId"]),

  // Matching System
  matchingQueue: defineTable({
    userId: v.id("users"),
    availableFrom: v.number(),
    availableTo: v.number(),
    constraints: v.object({
      interests: v.array(v.string()),
      roles: v.array(v.string()),
      orgConstraints: v.optional(v.string()),
    }),
    status: v.union(
      v.literal("waiting"),
      v.literal("matched"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    matchedWith: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_availability", ["availableFrom", "availableTo"]),

  matchingAnalytics: defineTable({
    userId: v.id("users"),
    matchId: v.string(),
    outcome: v.union(
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("completed"),
    ),
    feedback: v.optional(
      v.object({
        rating: v.number(),
        comments: v.optional(v.string()),
      }),
    ),
    features: v.any(),
    weights: v.any(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_match", ["matchId"])
    .index("by_outcome", ["outcome"]),

  // Vector Embeddings
  embeddings: defineTable({
    sourceType: v.union(
      v.literal("user"),
      v.literal("profile"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("transcriptSegment"),
    ),
    sourceId: v.string(),
    vector: v.array(v.float64()),
    model: v.string(),
    dimensions: v.number(),
    version: v.string(),
    metadata: v.any(),
    createdAt: v.number(),
  })
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_model", ["model"])
    .index("by_created", ["createdAt"])
    .vectorIndex("by_vector", {
      vectorField: "vector",
      dimensions: 1536, // OpenAI embedding dimensions
      filterFields: ["sourceType", "model"],
    }),

  vectorIndexMeta: defineTable({
    provider: v.string(),
    indexName: v.string(),
    config: v.any(),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("migrating"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_provider", ["provider"])
    .index("by_status", ["status"]),

  // Messages and Chat
  messages: defineTable({
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    content: v.string(),
    attachments: v.optional(v.array(v.any())),
    timestamp: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_time", ["meetingId", "timestamp"]),

  // Video Room Configuration (Hybrid Architecture)
  videoRoomConfigs: defineTable({
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
  })
    .index("by_meeting", ["meetingId"])
    .index("by_room_id", ["roomId"])
    .index("by_provider", ["provider"]),

  // WebRTC Signaling
  webrtcSessions: defineTable({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    state: v.union(
      v.literal("connecting"),
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("failed"),
      v.literal("closed"),
    ),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_user_and_meeting", ["userId", "meetingId"]) 
    .index("by_meeting_and_session", ["meetingId", "sessionId"])
    .index("by_state", ["state"]),

  webrtcSignals: defineTable({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    fromUserId: v.id("users"),
    toUserId: v.optional(v.id("users")), // null for broadcast signals
    type: v.union(v.literal("sdp"), v.literal("ice")),
    data: v.any(), // SDP or ICE candidate data
    timestamp: v.number(),
    processed: v.boolean(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_session", ["sessionId"])
    .index("by_meeting_and_target", ["meetingId", "toUserId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_processed", ["processed"]),

  // Connection Quality Metrics
  connectionMetrics: defineTable({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    userId: v.id("users"),
    quality: v.union(
      v.literal("excellent"),
      v.literal("good"),
      v.literal("fair"),
      v.literal("poor"),
    ),
    stats: v.object({
      bitrate: v.number(),
      packetLoss: v.number(),
      latency: v.number(),
      jitter: v.number(),
    }),
    timestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_session", ["sessionId"])
    .index("by_user", ["userId"])
    .index("by_quality", ["quality"])
    .index("by_timestamp", ["timestamp"]),

  // System Collections
  idempotencyKeys: defineTable({
    key: v.string(),
    scope: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_key_scope", ["key", "scope"])
    .index("by_created_at", ["createdAt"]),

  // Alerting and Monitoring
  alerts: defineTable({
    alertId: v.string(),
    severity: v.union(
      v.literal("critical"),
      v.literal("error"),
      v.literal("warning"),
      v.literal("info"),
    ),
    category: v.union(
      v.literal("meeting_lifecycle"),
      v.literal("video_provider"),
      v.literal("transcription"),
      v.literal("authentication"),
      v.literal("performance"),
      v.literal("security"),
      v.literal("system"),
    ),
    title: v.string(),
    message: v.string(),
    metadata: v.any(),
    actionable: v.boolean(),
    status: v.union(
      v.literal("active"),
      v.literal("acknowledged"),
      v.literal("resolved"),
    ),
    escalationTime: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_severity", ["severity"])
    .index("by_category", ["category"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"])
    .index("by_escalation_time", ["escalationTime"]),

  performanceMetrics: defineTable({
    name: v.string(),
    value: v.number(),
    unit: v.string(),
    labels: v.any(),
    threshold: v.optional(
      v.object({
        warning: v.number(),
        critical: v.number(),
      }),
    ),
    timestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_timestamp", ["timestamp"])
    .index("by_name_and_timestamp", ["name", "timestamp"]),

  meetingEvents: defineTable({
    meetingId: v.id("meetings"),
    event: v.string(),
    userId: v.optional(v.id("users")),
    duration: v.optional(v.number()),
    success: v.boolean(),
    error: v.optional(v.string()),
    metadata: v.any(),
    timestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_event", ["event"])
    .index("by_success", ["success"])
    .index("by_timestamp", ["timestamp"])
    .index("by_meeting_and_event", ["meetingId", "event"]),

  rateLimits: defineTable({
    userId: v.id("users"),
    action: v.string(),
    windowStartMs: v.number(),
    count: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_action_window", ["userId", "action", "windowStartMs"]),

  auditLogs: defineTable({
    actorUserId: v.optional(v.id("users")),
    resourceType: v.string(),
    resourceId: v.string(),
    action: v.string(),
    metadata: v.any(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_actor", ["actorUserId"])
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_action", ["action"]),

  featureFlags: defineTable({
    key: v.string(),
    value: v.any(),
    environment: v.string(),
    rolloutPercentage: v.number(),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_environment", ["environment"])
    .index("by_key_env", ["key", "environment"]),

  // Meeting Recordings
  meetingRecordings: defineTable({
    meetingId: v.id("meetings"),
    recordingId: v.string(),
    recordingUrl: v.optional(v.string()),
    provider: v.union(v.literal("getstream"), v.literal("custom")),
    status: v.union(
      v.literal("recording"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    duration: v.optional(v.number()),
    fileSize: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_recording_id", ["recordingId"])
    .index("by_provider", ["provider"])
    .index("by_status", ["status"]),

  // Legacy Support (for migration)
  connections: defineTable({
    requesterId: v.id("users"),
    addresseeId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requester", ["requesterId"])
    .index("by_addressee", ["addresseeId"])
    .index("by_status", ["status"]),
});
