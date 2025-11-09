/**
 * Debug helper to check user and profile status
 * Run this from the Convex dashboard to diagnose profile issues
 */

import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Check if a user has a profile
 */
export const checkUserProfile = query({
  args: { workosUserId: v.string() },
  handler: async (ctx, { workosUserId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();

    if (!user) {
      return { status: "error", message: "User not found" };
    }

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    return {
      status: "success",
      user: {
        _id: user._id,
        email: user.email,
        displayName: user.displayName,
        workosUserId: user.workosUserId,
      },
      profile: profile ? {
        _id: profile._id,
        displayName: profile.displayName,
        bio: profile.bio,
        languages: profile.languages,
      } : null,
      hasProfile: !!profile,
    };
  },
});

/**
 * List all users and their profile status
 */
export const listUsersWithProfiles = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    
    const results = await Promise.all(
      users.map(async (user) => {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();
        
        return {
          userId: user._id,
          email: user.email,
          displayName: user.displayName,
          hasProfile: !!profile,
          profileId: profile?._id,
        };
      })
    );
    
    return {
      totalUsers: results.length,
      usersWithProfiles: results.filter(r => r.hasProfile).length,
      usersWithoutProfiles: results.filter(r => !r.hasProfile).length,
      users: results,
    };
  },
});