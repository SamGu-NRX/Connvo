import { defineTable } from "convex/server";
import { v } from "convex/values";
import { metadataRecordV } from "../lib/validators";

export const webrtcTables = {
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
    metadata: v.optional(metadataRecordV),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_user_and_meeting", ["userId", "meetingId"])
    .index("by_meeting_and_session", ["meetingId", "sessionId"])
    .index("by_meeting_and_state", ["meetingId", "state"])
    .index("by_state", ["state"])
    // Composite index for cleanup queries on state + updatedAt
    .index("by_state_and_updatedAt", ["state", "updatedAt"]),

  webrtcSignals: defineTable({
    meetingId: v.id("meetings"),
    sessionId: v.string(),
    fromUserId: v.id("users"),
    toUserId: v.optional(v.id("users")), // null for broadcast signals
    type: v.union(v.literal("sdp"), v.literal("ice")),
    // SDP or ICE candidate data
    data: v.union(
      v.object({
        type: v.union(
          v.literal("offer"),
          v.literal("answer"),
          v.literal("pranswer"),
          v.literal("rollback"),
        ),
        sdp: v.string(),
      }),
      v.object({
        candidate: v.string(),
        sdpMLineIndex: v.optional(v.number()),
        sdpMid: v.optional(v.string()),
        usernameFragment: v.optional(v.string()),
      }),
    ),
    timestamp: v.number(),
    processed: v.boolean(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_session", ["sessionId"])
    .index("by_meeting_and_target", ["meetingId", "toUserId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_processed", ["processed"])
    .index("by_processed_and_timestamp", ["processed", "timestamp"])
    // Session-scoped recipient query: getPendingSignals fetches one
    // session's pending signals for one caller directly from this index,
    // so unrelated sessions can never fill the batch and push the wanted
    // signals out of reach. toUserId equality supports both the direct
    // (caller) and broadcast (undefined) ranges.
    .index("by_meeting_session_target_and_processed", [
      "meetingId",
      "sessionId",
      "toUserId",
      "processed",
    ])
    .index("by_meeting_target_and_processed", [
      "meetingId",
      "toUserId",
      "processed",
    ]),

  // Per-caller acknowledgements of broadcast signals. A broadcast signal
  // (no toUserId) is never flipped to processed=true — that would hide it
  // from every other participant — so each caller's ack is recorded here
  // and delivery filters it out per caller instead.
  webrtcSignalAcks: defineTable({
    meetingId: v.id("meetings"),
    signalId: v.id("webrtcSignals"),
    userId: v.id("users"),
    ackedAt: v.number(),
  })
    .index("by_signal_and_user", ["signalId", "userId"])
    .index("by_meeting_and_user", ["meetingId", "userId"]),

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
};
