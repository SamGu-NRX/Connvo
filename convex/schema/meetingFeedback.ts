import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The "Would you talk again?" answer a person gives after one of their
 * meetings (docs/plan/MATCHING-PLAN.md, after the call). One row per
 * (meeting, user): the answer is private to the person who gave it and is
 * the training signal for matching. Nothing here is ever shown to the other
 * person.
 */
export const meetingFeedback = defineTable({
  meetingId: v.id("meetings"),
  userId: v.id("users"),
  talkAgain: v.boolean(),
  // Optional reason chips; only meaningful with talkAgain: false.
  reasons: v.array(v.string()),
  createdAt: v.number(),
})
  .index("by_meeting_and_user", ["meetingId", "userId"])
  .index("by_user", ["userId"])
  .index("by_meeting", ["meetingId"]);
