import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A "Connect" that went both ways after a meeting: the row exists only when
 * both people tapped Connect for the same meeting (docs/plan/MATCHING-PLAN.md,
 * after the call), like stay-in-touch it is mutual. userLow/userHigh are the
 * pair's user ids in id-string order, so one row per pair is enough and the
 * row is readable from either side (by_user_low, by_user_high).
 */
export const connections = defineTable({
  userLow: v.id("users"),
  userHigh: v.id("users"),
  createdAt: v.number(),
})
  .index("by_pair", ["userLow", "userHigh"])
  .index("by_user_low", ["userLow"])
  .index("by_user_high", ["userHigh"]);
