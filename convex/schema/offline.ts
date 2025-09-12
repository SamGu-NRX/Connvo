import { defineTable } from "convex/server";
import { v } from "convex/values";

export const offlineTables = {
  // Meeting Recordings
  meetingRecordings: defineTable({
    meetingId: v.id("meetings"),
    recordingId: v.string(),
    // Offline Support for Collaborative Notes
    offlineOperationQueue: defineTable({
      meetingId: v.id("meetings"),
      clientId: v.string(),
      queueId: v.string(),
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
      operationId: v.string(),
      authorId: v.id("users"),
      clientSequence: v.number(),
      timestamp: v.number(),
      queuedAt: v.number(),
      attempts: v.number(),
      lastAttempt: v.optional(v.number()),
      error: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("syncing"),
        v.literal("synced"),
        v.literal("failed"),
      ),
    })
      .index("by_meeting_and_client", ["meetingId", "clientId"])
      .index("by_queue_id", ["queueId"])
      .index("by_status", ["status"])
      .index("by_queued_at", ["queuedAt"])
      .index("by_queue_and_sequence", ["queueId", "clientSequence"])
      .index("by_queue_and_operation", ["queueId", "operationId"])
      .index("by_status_and_queued_at", ["status", "queuedAt"]),
    clientSequence: v.number(),
    timestamp: v.number(),
    queuedAt: v.number(),
    attempts: v.number(),
    lastAttempt: v.optional(v.number()),
    error: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("syncing"),
      v.literal("synced"),
      v.literal("failed"),
    ),
  })
    .index("by_meeting_and_client", ["meetingId", "clientId"])
    .index("by_queue_id", ["queueId"])
    .index("by_status", ["status"])
    .index("by_queued_at", ["queuedAt"]),

  offlineCheckpoints: defineTable({
    checkpointId: v.string(),
    meetingId: v.id("meetings"),
    clientId: v.string(),
    sequence: v.number(),
    version: v.number(),
    contentHash: v.string(),
    timestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_checkpoint_id", ["checkpointId"])
    .index("by_meeting_and_client", ["meetingId", "clientId"])
    .index("by_created_at", ["createdAt"]),
};

