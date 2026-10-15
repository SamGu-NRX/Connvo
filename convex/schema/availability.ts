import { defineTable } from "convex/server";
import { v } from "convex/values";
import { weeklyBlockFields } from "../lib/availability";

/**
 * Recurring weekly free time (cv6-profile-availability).
 *
 * weekday 0-6 (Sunday=0); startMinute/endMinute are minutes from local
 * midnight in the user's own timezone, on 30-minute steps. The slots repeat
 * every week: DST is resolved when a concrete meeting time is chosen, not
 * here. The matcher reads these; only this packet writes them.
 */
export const availabilityBlocks = defineTable({
  userId: v.id("users"),
  ...weeklyBlockFields,
}).index("by_user", ["userId"]);
