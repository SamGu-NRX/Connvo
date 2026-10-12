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
    // Call mesh (convex/meetings/webrtc/mesh.ts): presence heartbeat, the
    // participant's announced mic/camera state, and why a session closed.
    lastHeartbeatAt: v.optional(v.number()),
    micOn: v.optional(v.boolean()),
    cameraOn: v.optional(v.boolean()),
    closedReason: v.optional(
      v.union(v.literal("left"), v.literal("replaced"), v.literal("expired")),
    ),
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
    toUserId: v.optional(v.id("users")), // legacy; the call mesh always sets both targets
    // The receiving session. Addressing a session, not a user, keeps a
    // reloaded tab from receiving offers meant for the tab it replaced.
    toSessionId: v.optional(v.string()),
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
    .index("by_target_session_and_processed", ["toSessionId", "processed"])
    .index("by_meeting_target_and_processed", [
      "meetingId",
      "toUserId",
      "processed",
    ]),

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
