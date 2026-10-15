import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A report about another person, optionally tied to the meeting it happened
 * in (cv6-profile-availability). Only the reporter and trust-and-safety
 * views read these; the reported person has no way to list them.
 */
export const reports = defineTable({
  reporterId: v.id("users"),
  reportedId: v.id("users"),
  meetingId: v.optional(v.id("meetings")),
  reason: v.string(),
  createdAt: v.number(),
})
  .index("by_reporter", ["reporterId"])
  .index("by_reported", ["reportedId"])
  .index("by_meeting", ["meetingId"]);
