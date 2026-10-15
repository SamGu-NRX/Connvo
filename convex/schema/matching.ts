import { defineTable } from "convex/server";
import { v } from "convex/values";
import { numericMapV } from "../lib/validators";
import { callQueueTypeV, callQueueNoticeV } from "../types/validators/matching";

export const matchingTables = {
  // Separate from the legacy scheduler, which has no acceptance or meeting lifecycle.
  callQueueEntries: defineTable({
    userId: v.id("users"),
    queueType: callQueueTypeV,
    state: v.union(
      v.literal("idle"),
      v.literal("waiting"),
      v.literal("matched"),
      v.literal("ready"),
      v.literal("expired"),
    ),
    joinedAt: v.number(),
    expiresAt: v.number(),
    matchId: v.optional(v.id("callQueueMatches")),
    blockedUserIds: v.array(v.id("users")),
    notice: v.optional(callQueueNoticeV),
  })
    .index("by_user", ["userId"])
    .index("by_queue_state", ["queueType", "state"]),
  callQueueMatches: defineTable({
    user1Id: v.id("users"),
    user2Id: v.id("users"),
    entry1Id: v.id("callQueueEntries"),
    entry2Id: v.id("callQueueEntries"),
    state: v.union(
      v.literal("pending"),
      v.literal("declined"),
      v.literal("expired"),
      v.literal("ready"),
    ),
    user1Accepted: v.boolean(),
    user2Accepted: v.boolean(),
    reasons: v.array(v.string()),
    score: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    meetingId: v.optional(v.id("meetings")),
  }),
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
    features: numericMapV,
    weights: numericMapV,
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_match", ["matchId"])
    .index("by_outcome", ["outcome"]),
};
