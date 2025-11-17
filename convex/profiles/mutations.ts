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
 * @summary Updates the authenticated user's profile fields
 * @description Applies partial updates to the caller's profile, creating a new
 * profile automatically if one does not already exist. Only fields provided in
 * the request are mutated, making the endpoint safe for granular profile edits.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "displayName": "Avery Johnson",
 *     "bio": "Product manager focused on real-time collaboration tools.",
 *     "languages": ["en", "es"],
 *     "company": "Connvo Inc."
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": "profile_84c0example"
 * }
 * ```
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
 * @summary Creates or upserts the caller's profile during onboarding
 * @description Initializes the user's profile with onboarding data, or patches
 * an existing profile if one already exists. Ensures deterministic timestamps
 * and defaults for optional arrays such as languages.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "displayName": "Jordan Riley",
 *     "bio": "Engineering leader passionate about inclusive meeting rooms.",
 *     "goals": "Connect with product-minded peers",
 *     "languages": ["en"],
 *     "experience": "10+ years",
 *     "field": "Engineering",
 *     "jobTitle": "Head of Platform",
 *     "company": "Connvo Inc.",
 *     "linkedinUrl": "https://www.linkedin.com/in/jordan-riley",
 *     "age": 34,
 *     "gender": "prefer-not-to-say"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": "profile_84c0example"
 * }
 * ```
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
