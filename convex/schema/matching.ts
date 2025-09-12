import { defineTable } from "convex/server";
import { v } from "convex/values";
import { numericMapV } from "../lib/validators";

export const matchingTables = {
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

