import { defineTable } from "convex/server";
import { v } from "convex/values";

export const interestTables = {
  interests: defineTable({
    key: v.string(),
    label: v.string(),
    category: v.string(),
    iconName: v.optional(v.string()),
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
};
