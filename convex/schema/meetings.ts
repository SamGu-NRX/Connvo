import { defineTable } from "convex/server";
import { v } from "convex/values";
import { speakingStatsV, metadataRecordV } from "../lib/validators";

export const meetingTables = {
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
    .index("by_meeting_and_user", ["meetingId", "userId"])
    .index("by_meeting_and_role", ["meetingId", "role"]),

  meetingState: defineTable({
    meetingId: v.id("meetings"),
    active: v.boolean(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    speakingStats: v.optional(speakingStatsV),
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
    // Additive operation identity (notes-ledger F1). Written in the same
    // transaction as the text change so an ack can be trusted (persist-before-ack).
    // Legacy rows and legacy callers leave these fields absent.
    // `clientSequence` is the OT basis (the server-history watermark the client
    // had incorporated when the op was created), not a per-client counter.
    clientId: v.optional(v.string()),
    clientOpId: v.optional(v.string()),
    clientSequence: v.optional(v.number()),
  })
    .index("by_meeting_sequence", ["meetingId", "sequence"])
    .index("by_meeting_timestamp", ["meetingId", "timestamp"])
    // Identity lookup for acks: a client's ops in sequence order. Rows without
    // identity are excluded from this index automatically by Convex.
    .index("by_meeting_client", ["meetingId", "clientId", "sequence"])
    // Dedupe identity. Uniqueness of (meetingId, clientId, clientOpId) is
    // enforced transactionally by the check-then-insert in notes/mutations.ts
    // (Convex serializes mutations, so the check cannot race).
    .index("by_meeting_client_op", ["meetingId", "clientId", "clientOpId"]),

  // Per-meeting atomic counters (e.g., transcript sequence allocation)
  meetingCounters: defineTable({
    meetingId: v.id("meetings"),
    lastSequence: v.number(),
    updatedAt: v.number(),
  }).index("by_meeting", ["meetingId"]),

  meetingEvents: defineTable({
    meetingId: v.id("meetings"),
    event: v.string(),
    userId: v.optional(v.id("users")),
    duration: v.optional(v.number()),
    success: v.boolean(),
    error: v.optional(v.string()),
    metadata: metadataRecordV,
    timestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_event", ["event"])
    .index("by_success", ["success"])
    .index("by_timestamp", ["timestamp"])
    .index("by_meeting_and_event", ["meetingId", "event"]),

  // Meeting Recordings
  meetingRecordings: defineTable({
    meetingId: v.id("meetings"),
    recordingId: v.string(),
    recordingUrl: v.optional(v.string()),
    provider: v.union(v.literal("webrtc"), v.literal("getstream")),
    status: v.union(
      v.literal("pending"),
      v.literal("recording"),
      v.literal("syncing"),
      v.literal("synced"),
      v.literal("failed"),
      v.literal("ready"),
    ),
    error: v.optional(v.string()),
    lastAttempt: v.optional(v.number()),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_recording_id", ["recordingId"])
    .index("by_status", ["status"])
    .index("by_provider", ["provider"]),

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
};
