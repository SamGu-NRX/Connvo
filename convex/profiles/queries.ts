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
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";

/**
 * Gets profile by user ID (internal use)
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
 * Gets current user's profile
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
 * Gets profile by user ID with authorization
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

    // Scoping policy: the target's profile is visible to the target themself,
    // to callers sharing the target's orgId, to callers sharing at least one
    // meeting (meetingParticipants), and to org admins. Everyone else is
    // rejected so profile discovery stays tenancy-bounded.
    if (identity.userId !== userId) {
      const target = await ctx.db.get(userId);
      const sameOrg =
        !!identity.orgId && !!target && identity.orgId === target.orgId;
      const isOrgAdmin = identity.orgRole === "admin";

      let sharesMeeting = false;
      if (!sameOrg && !isOrgAdmin && target) {
        const targetParticipations = await ctx.db
          .query("meetingParticipants")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        for (const participation of targetParticipations) {
          const shared = await ctx.db
            .query("meetingParticipants")
            .withIndex("by_meeting_and_user", (q) =>
              q
                .eq("meetingId", participation.meetingId)
                .eq("userId", identity.userId),
            )
            .first();
          if (shared) {
            sharesMeeting = true;
            break;
          }
        }
      }

      if (!sameOrg && !isOrgAdmin && !sharesMeeting) {
        throw createError.forbidden("Profile is not visible to this caller");
      }
    }

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
