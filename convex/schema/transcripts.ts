import { defineTable } from "convex/server";
import { v } from "convex/values";
import { metadataRecordV } from "../lib/validators";

export const transcriptTables = {
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
    // Whether this chunk is an interim hypothesis from the provider
    isInterim: v.optional(v.boolean()),
    // Denormalized for performance
    wordCount: v.number(),
    language: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_meeting_bucket", ["meetingId", "bucketMs"]) 
    .index("by_meeting_sequence", ["meetingId", "sequence"]) 
    .index("by_meeting_bucket_seq", ["meetingId", "bucketMs", "sequence"])
    .index("by_meeting_time_range", ["meetingId", "startMs"])
    .index("by_created_at", ["createdAt"]) 
    .index("by_meeting_and_created_at", ["meetingId", "createdAt"]) 
    .index("by_bucket_global", ["bucketMs"]) // For cleanup jobs
    .index("by_meeting_and_speaker", ["meetingId", "speakerId"]) // For speaker-specific queries
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["meetingId"],
    }),

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
    metadata: v.optional(metadataRecordV),
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
    .index("by_created_at", ["createdAt"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["meetingId"],
    }),
};

