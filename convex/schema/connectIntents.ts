import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * One person's "Connect" tap for one meeting — the half of a connection that
 * stays invisible until the other person taps too. Mirrors stayInTouch: one
 * row per (meeting, user), and nothing about it is ever revealed to anyone
 * before they have made their own choice. When both participants of a
 * meeting have a row here, a connections row exists for the pair.
 */
export const connectIntents = defineTable({
  meetingId: v.id("meetings"),
  userId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_meeting_and_user", ["meetingId", "userId"])
  .index("by_meeting", ["meetingId"])
  .index("by_user", ["userId"]);
