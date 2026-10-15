import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A person another person never wants to meet again
 * (cv6-profile-availability).
 *
 * A blocked person must never see the blocker again: wherever later code
 * pairs or lists people, it asks
 * convex/profiles/moderation.isBlockedEither first.
 */
export const blocks = defineTable({
  blockerId: v.id("users"),
  blockedId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_blocker_blocked", ["blockerId", "blockedId"])
  .index("by_blocked", ["blockedId"]);
