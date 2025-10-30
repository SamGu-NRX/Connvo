/**
 * Settings Mutation Functions
 *
 * This module provides mutation functions for user settings/preferences with
 * proper authorization and upsert logic.
 *
 * Requirements: 9.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "@convex/auth/guards";

/**
 * Update user settings (creates if doesn't exist)
 * Uses upsert pattern for seamless first-time and subsequent updates
 */
export const updateSettings = mutation({
  args: {
    emailNotifications: v.optional(v.boolean()),
    pushNotifications: v.optional(v.boolean()),
    smsNotifications: v.optional(v.boolean()),
    profileVisibility: v.optional(v.boolean()),
    dataSharing: v.optional(v.boolean()),
    activityTracking: v.optional(v.boolean()),
  },
  returns: v.id("userSettings"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    
    // Get existing settings
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();
    
    if (existing) {
      // Update existing settings
      const updateData: Record<string, any> = {
        updatedAt: Date.now(),
      };
      
      if (args.emailNotifications !== undefined) updateData.emailNotifications = args.emailNotifications;
      if (args.pushNotifications !== undefined) updateData.pushNotifications = args.pushNotifications;
      if (args.smsNotifications !== undefined) updateData.smsNotifications = args.smsNotifications;
      if (args.profileVisibility !== undefined) updateData.profileVisibility = args.profileVisibility;
      if (args.dataSharing !== undefined) updateData.dataSharing = args.dataSharing;
      if (args.activityTracking !== undefined) updateData.activityTracking = args.activityTracking;
      
      await ctx.db.patch(existing._id, updateData);
      return existing._id;
    } else {
      // Create new settings with provided values or defaults
      const settingsId = await ctx.db.insert("userSettings", {
        userId: identity.userId,
        emailNotifications: args.emailNotifications ?? true,
        pushNotifications: args.pushNotifications ?? true,
        smsNotifications: args.smsNotifications ?? false,
        profileVisibility: args.profileVisibility ?? true,
        dataSharing: args.dataSharing ?? false,
        activityTracking: args.activityTracking ?? true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return settingsId;
    }
  },
});