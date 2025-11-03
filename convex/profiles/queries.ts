/**
 * Profile Query Functions
 *
 * This module provides query functions for user profile data access with
 * proper authorization and performance optimization.
 *
 * Requirements: 3.1, 9.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { Id } from "@convex/_generated/dataModel";

/**
 * @summary Gets profile by user ID (internal use)
 * @description Retrieves a user profile by user ID for internal system operations. This function bypasses authorization checks and should only be called from trusted internal contexts. Returns null if no profile exists for the given user.
 *
 * @example request
 * ```json
 * { "args": { "userId": "jd7xn8q9k2h5m6p3r4t7w8y9" } }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "jh8xp9r2k5n6q7s8v9w0y1z2",
 *     "userId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "displayName": "Alex Chen",
 *     "bio": "Product manager passionate about AI and user experience",
 *     "goals": "Looking to connect with founders and technical leaders",
 *     "languages": ["English", "Mandarin"],
 *     "experience": "8 years in product management",
 *     "age": 32,
 *     "gender": "prefer-not-to-say",
 *     "field": "Product Management",
 *     "jobTitle": "Senior Product Manager",
 *     "company": "TechCorp",
 *     "linkedinUrl": "https://linkedin.com/in/alexchen",
 *     "createdAt": 1704067200000,
 *     "updatedAt": 1704153600000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 */
export const getProfileByUserId = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("profiles"),
      userId: v.id("users"),
      displayName: v.string(),
      bio: v.optional(v.string()),
      goals: v.optional(v.string()),
      languages: v.array(v.string()),
      experience: v.optional(v.string()),
      age: v.optional(v.number()),
      gender: v.optional(
        v.union(
          v.literal("male"),
          v.literal("female"),
          v.literal("non-binary"),
          v.literal("prefer-not-to-say"),
        ),
      ),
      field: v.optional(v.string()),
      jobTitle: v.optional(v.string()),
      company: v.optional(v.string()),
      linkedinUrl: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

/**
 * @summary Gets current user's profile
 * @description Retrieves the authenticated user's profile data. Returns null if the user is not authenticated or if no profile exists. This function is safe to call from unauthenticated contexts as it returns null instead of throwing errors, making it suitable for reactive subscriptions that may be active during login/logout transitions.
 *
 * @example request
 * ```json
 * { "args": {} }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "jh8xp9r2k5n6q7s8v9w0y1z2",
 *     "userId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "displayName": "Alex Chen",
 *     "bio": "Product manager passionate about AI and user experience",
 *     "goals": "Looking to connect with founders and technical leaders",
 *     "languages": ["English", "Mandarin"],
 *     "experience": "8 years in product management",
 *     "age": 32,
 *     "gender": "prefer-not-to-say",
 *     "field": "Product Management",
 *     "jobTitle": "Senior Product Manager",
 *     "company": "TechCorp",
 *     "linkedinUrl": "https://linkedin.com/in/alexchen",
 *     "createdAt": 1704067200000,
 *     "updatedAt": 1704153600000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 */
export const getCurrentUserProfile = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("profiles"),
      userId: v.id("users"),
      displayName: v.string(),
      bio: v.optional(v.string()),
      goals: v.optional(v.string()),
      languages: v.array(v.string()),
      experience: v.optional(v.string()),
      age: v.optional(v.number()),
      gender: v.optional(
        v.union(
          v.literal("male"),
          v.literal("female"),
          v.literal("non-binary"),
          v.literal("prefer-not-to-say"),
        ),
      ),
      field: v.optional(v.string()),
      jobTitle: v.optional(v.string()),
      company: v.optional(v.string()),
      linkedinUrl: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    // Return null instead of throwing when unauthenticated so clients can
    // safely subscribe without triggering errors during logged-out states.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const workosUserId: string = identity.subject;

    // Get the user record to find their userId
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();

    if (!user) return null;

    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
  },
});

/**
 * @summary Gets profile by user ID with authorization
 * @description Retrieves a user profile by user ID with proper authorization checks. Only returns public profile fields, excluding sensitive information like age, gender, and LinkedIn URL. Requires authentication. Returns null if the profile does not exist.
 *
 * @example request
 * ```json
 * { "args": { "userId": "jd7xn8q9k2h5m6p3r4t7w8y9" } }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "jh8xp9r2k5n6q7s8v9w0y1z2",
 *     "userId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "displayName": "Alex Chen",
 *     "bio": "Product manager passionate about AI and user experience",
 *     "goals": "Looking to connect with founders and technical leaders",
 *     "languages": ["English", "Mandarin"],
 *     "experience": "8 years in product management",
 *     "field": "Product Management",
 *     "jobTitle": "Senior Product Manager",
 *     "company": "TechCorp"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "Authentication required"
 *   }
 * }
 * ```
 */
export const getProfileByUserIdPublic = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("profiles"),
      userId: v.id("users"),
      displayName: v.string(),
      bio: v.optional(v.string()),
      goals: v.optional(v.string()),
      languages: v.array(v.string()),
      experience: v.optional(v.string()),
      field: v.optional(v.string()),
      jobTitle: v.optional(v.string()),
      company: v.optional(v.string()),
      // Sensitive fields excluded for privacy
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    const identity = await requireIdentity(ctx);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) {
      return null;
    }

    // Return public fields only (exclude age, gender, linkedinUrl)
    return {
      _id: profile._id,
      userId: profile.userId,
      displayName: profile.displayName,
      bio: profile.bio,
      goals: profile.goals,
      languages: profile.languages,
      experience: profile.experience,
      field: profile.field,
      jobTitle: profile.jobTitle,
      company: profile.company,
    };
  },
});
