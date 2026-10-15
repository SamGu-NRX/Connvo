import { defineTable } from "convex/server";
import { v } from "convex/values";

export const livePromptTables = {
  livePromptSessions: defineTable({
    meetingId: v.id("meetings"),
    currentPromptId: v.optional(v.id("prompts")),
    shown: v.array(v.string()),
    lastPickAt: v.number(),
    lastAutoRequestAt: v.optional(v.number()),
    requestCount: v.optional(v.number()),
    manualRequests: v.array(v.number()),
    autoPaused: v.boolean(),
    reservation: v.optional(
      v.object({
        id: v.string(),
        at: v.number(),
        automatic: v.boolean(),
        notesUpdatedAt: v.number(),
      }),
    ),
  }).index("by_meeting", ["meetingId"]),
};
