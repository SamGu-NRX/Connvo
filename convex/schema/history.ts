import { defineTable } from "convex/server";
import { v } from "convex/values";

export const historyTables = {
  // After-call stay-in-touch opt-ins. One row per (meeting, user); records a
  // user's wish to stay in touch. Nothing is ever sent to anyone from here.
  stayInTouch: defineTable({
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_meeting_and_user", ["meetingId", "userId"])
    .index("by_user", ["userId"])
    .index("by_meeting", ["meetingId"]),
};
