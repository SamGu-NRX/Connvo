/**
 * Settings Query Functions
 *
 * This module provides query functions for user settings/preferences with
 * proper authorization and default values.
 *
 * Requirements: 9.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "@convex/auth/guards";

/**
 * Get current user's settings
 * Returns null if no settings exist yet (first time user)
 */
export const getCurrentUserSettings = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("userSettings"),
      userId: v.id("users"),
      emailNotifications: v.boolean(),
      pushNotifications: v.boolean(),
      smsNotifications: v.boolean(),
      profileVisibility: v.boolean(),
      dataSharing: v.boolean(),
      activityTracking: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();
    
    return settings;
  },
});