/**
 * One-time migration to create profiles for existing users
 * Run this from the Convex dashboard to fix users without profiles
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Creates profiles for all users that don't have one
 */
export const createMissingProfiles = internalMutation({
  args: {},
  returns: v.object({
    processedUsers: v.number(),
    profilesCreated: v.number(),
    alreadyHadProfiles: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const now = Date.now();
    
    let profilesCreated = 0;
    let alreadyHadProfiles = 0;
    const errors: string[] = [];
    
    console.log(`Processing ${users.length} users...`);
    
    for (const user of users) {
      try {
        // Check if profile already exists
        const existingProfile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();
        
        if (existingProfile) {
          alreadyHadProfiles++;
          console.log(`User ${user.email} already has profile ${existingProfile._id}`);
          continue;
        }
        
        // Create default profile
        const displayName = user.displayName || user.email.split('@')[0];
        const profileId = await ctx.db.insert("profiles", {
          userId: user._id,
          displayName,
          languages: [],
          createdAt: now,
          updatedAt: now,
        });
        
        profilesCreated++;
        console.log(`Created profile ${profileId} for user ${user.email}`);
        
      } catch (error) {
        const errorMsg = `Failed to create profile for user ${user.email}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }
    
    const result = {
      processedUsers: users.length,
      profilesCreated,
      alreadyHadProfiles,
      errors,
    };
    
    console.log("Migration complete:", result);
    return result;
  },
});