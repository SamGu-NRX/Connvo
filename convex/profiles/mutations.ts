/**
 * Profile Mutation Functions
 *
 * This module provides mutation functions for profile data management with
 * proper authorization and validation.
 *
 * Requirements: 3.1, 9.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

import { mutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "@convex/auth/guards";

/**
 * Update current user's profile
 */
export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    goals: v.optional(v.string()),
    languages: v.optional(v.array(v.string())),
    experience: v.optional(v.string()),
    field: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    company: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    age: v.optional(v.number()),
    gender: v.optional(
      v.union(
        v.literal("male"),
        v.literal("female"),
        v.literal("non-binary"),
        v.literal("prefer-not-to-say")
      )
    ),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    
    const now = Date.now();
    
    // Get existing profile
    const existingProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();
    
    if (existingProfile) {
      // Prepare update object - only include defined fields
      const updateData: Record<string, any> = {
        updatedAt: now,
      };
      
      if (args.displayName !== undefined) updateData.displayName = args.displayName;
      if (args.bio !== undefined) updateData.bio = args.bio;
      if (args.goals !== undefined) updateData.goals = args.goals;
      if (args.languages !== undefined) updateData.languages = args.languages;
      if (args.experience !== undefined) updateData.experience = args.experience;
      if (args.field !== undefined) updateData.field = args.field;
      if (args.jobTitle !== undefined) updateData.jobTitle = args.jobTitle;
      if (args.company !== undefined) updateData.company = args.company;
      if (args.linkedinUrl !== undefined) updateData.linkedinUrl = args.linkedinUrl;
      if (args.age !== undefined) updateData.age = args.age;
      if (args.gender !== undefined) updateData.gender = args.gender;
      
      // Update profile
      await ctx.db.patch(existingProfile._id, updateData);
      
      return existingProfile._id;
    } else {
      // Auto-create profile if it doesn't exist
      // Get user's email for fallback displayName
      const user = await ctx.db.get(identity.userId);
      const fallbackDisplayName = user?.email?.split('@')[0] || 'User';
      
      const profileId = await ctx.db.insert("profiles", {
        userId: identity.userId,
        displayName: args.displayName || fallbackDisplayName,
        bio: args.bio,
        goals: args.goals,
        languages: args.languages || [],
        experience: args.experience,
        field: args.field,
        jobTitle: args.jobTitle,
        company: args.company,
        linkedinUrl: args.linkedinUrl,
        age: args.age,
        gender: args.gender,
        createdAt: now,
        updatedAt: now,
      });
      
      return profileId;
    }
  },
});

/**
 * Create initial profile for new user (called during onboarding)
 */
export const createProfile = mutation({
  args: {
    displayName: v.string(),
    bio: v.optional(v.string()),
    goals: v.optional(v.string()),
    languages: v.optional(v.array(v.string())),
    experience: v.optional(v.string()),
    field: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    company: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    age: v.optional(v.number()),
    gender: v.optional(
      v.union(
        v.literal("male"),
        v.literal("female"),
        v.literal("non-binary"),
        v.literal("prefer-not-to-say")
      )
    ),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    
    // Check if profile already exists
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();
    
    if (existing) {
      // Update existing profile instead
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    
    // Create new profile
    const profileId = await ctx.db.insert("profiles", {
      userId: identity.userId,
      displayName: args.displayName,
      bio: args.bio,
      goals: args.goals,
      languages: args.languages || [],
      experience: args.experience,
      field: args.field,
      jobTitle: args.jobTitle,
      company: args.company,
      linkedinUrl: args.linkedinUrl,
      age: args.age,
      gender: args.gender,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    return profileId;
  },
});