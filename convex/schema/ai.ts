import { defineTable } from "convex/server";
import { v } from "convex/values";
import { metadataRecordV } from "../lib/validators";

export const aiTables = {
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
};
