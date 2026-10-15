import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * No-shows and strikes for scheduled match meetings
 * (docs/plan/MATCHING-PLAN.md, step 4).
 *
 * The `meetings` table's state union has no no-show state: a reported no-show
 * concludes the meeting, and the report lives here. One report per meeting
 * (enforced transactionally by the check-then-insert in
 * convex/matching/noshow.ts). Each report gives the absent person one strike;
 * two strikes in 30 days pause their matching until the window ages out.
 */
export const noShowTables = {
  noShowReports: defineTable({
    meetingId: v.id("meetings"),
    // The person who was there and reported it.
    reporterId: v.id("users"),
    // The person the report says did not show.
    absentUserId: v.id("users"),
    // What the reporter saw: never_joined, joined_late, or left_early.
    reason: v.optional(
      v.union(
        v.literal("never_joined"),
        v.literal("joined_late"),
        v.literal("left_early"),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_reporter", ["reporterId"])
    .index("by_absent_user", ["absentUserId"]),

  matchingStrikes: defineTable({
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"]),
};
