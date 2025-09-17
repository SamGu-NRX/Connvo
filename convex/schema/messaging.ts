import { defineTable } from "convex/server";
import { v } from "convex/values";
import { attachmentV } from "@convex/lib/validators";

export const messagingTables = {
  // Messages and Chat
  messages: defineTable({
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    content: v.string(),
    attachments: v.optional(v.array(attachmentV)),
    timestamp: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_time", ["meetingId", "timestamp"]),
};
