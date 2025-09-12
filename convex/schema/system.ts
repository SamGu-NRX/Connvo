import { defineTable } from "convex/server";
import { v } from "convex/values";
import { featureFlagValueV, labelsRecordV, metadataRecordV } from "../lib/validators";

export const systemTables = {
  // System Collections
  idempotencyKeys: defineTable({
    key: v.string(),
    scope: v.string(),
    metadata: v.optional(metadataRecordV),
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
    metadata: metadataRecordV,
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
    .index("by_escalation_time", ["escalationTime"])
    .index("by_status_and_created_at", ["status", "createdAt"]),

  performanceMetrics: defineTable({
    name: v.string(),
    value: v.number(),
    unit: v.string(),
    labels: labelsRecordV,
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
    metadata: metadataRecordV,
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
    value: featureFlagValueV,
    environment: v.string(),
    rolloutPercentage: v.number(),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_environment", ["environment"])
    .index("by_key_env", ["key", "environment"]),
};

