/**
 * User Mutations with Authentication Guards
 *
 * This module demonstrates proper usage of authentication guards
 * in Convex mutations with comprehensive error handling.
 *
 * Requirements: 2.3, 2.4, 2.6
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "../auth/guards";
import { createError } from "../lib/errors";

/**
 * Create or update user profile from WorkOS authentication
 * This is typically called after successful WorkOS authentication
 */
export const upsertUser = mutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    // Verify the authenticated user matches the WorkOS user ID
    const identity = await requireIdentity(ctx);
    if (identity.workosUserId !== args.workosUserId) {
      throw createError.forbidden("Cannot create user for different WorkOS ID");
    }

    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", args.workosUserId))
      .unique();

    const now = Date.now();

    if (existingUser) {
      // Update existing user
      await ctx.db.patch(existingUser._id, {
        email: args.email,
        displayName: args.displayName,
        orgId: args.orgId,
        orgRole: args.orgRole,
        lastSeenAt: now,
        updatedAt: now,
      });
      return existingUser._id;
    } else {
      // Create new user
      return await ctx.db.insert("users", {
        workosUserId: args.workosUserId,
        email: args.email,
        displayName: args.displayName,
        orgId: args.orgId,
        orgRole: args.orgRole,
        isActive: true,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Update user profile information
 * Requires ownership or admin access
 */
export const updateUserProfile = mutation({
  args: {
    userId: v.id("users"),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    goals: v.optional(v.string()),
    languages: v.optional(v.array(v.string())),
    experience: v.optional(v.string()),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    // Verify user has permission to update this profile
    await assertOwnershipOrAdmin(ctx, args.userId);

    // Validate input
    if (args.displayName && args.displayName.trim().length === 0) {
      throw createError.validation("Display name cannot be empty");
    }

    if (args.bio && args.bio.length > 1000) {
      throw createError.validation("Bio cannot exceed 1000 characters");
    }

    const now = Date.now();

    // Check if profile exists
    const existingProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (existingProfile) {
      // Update existing profile
      await ctx.db.patch(existingProfile._id, {
        ...(args.displayName !== undefined && {
          displayName: args.displayName,
        }),
        ...(args.bio !== undefined && { bio: args.bio }),
        ...(args.goals !== undefined && { goals: args.goals }),
        ...(args.languages !== undefined && { languages: args.languages }),
        ...(args.experience !== undefined && { experience: args.experience }),
        updatedAt: now,
      });
      return existingProfile._id;
    } else {
      // Create new profile
      if (!args.displayName) {
        throw createError.validation(
          "Display name is required for new profiles",
        );
      }

      return await ctx.db.insert("profiles", {
        userId: args.userId,
        displayName: args.displayName,
        bio: args.bio,
        goals: args.goals,
        languages: args.languages || [],
        experience: args.experience,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Update user interests
 * Requires ownership or admin access
 */
export const updateUserInterests = mutation({
  args: {
    userId: v.id("users"),
    interests: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, interests }) => {
    // Verify user has permission to update interests
    await assertOwnershipOrAdmin(ctx, userId);

    // Validate interests exist
    const validInterests = await ctx.db.query("interests").collect();

    const validInterestKeys = new Set(validInterests.map((i) => i.key));
    const invalidInterests = interests.filter(
      (key) => !validInterestKeys.has(key),
    );

    if (invalidInterests.length > 0) {
      throw createError.validation(
        `Invalid interests: ${invalidInterests.join(", ")}`,
        "interests",
      );
    }

    // Remove existing interests
    const existingInterests = await ctx.db
      .query("userInterests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const userInterest of existingInterests) {
      await ctx.db.delete(userInterest._id);
    }

    // Add new interests
    const now = Date.now();
    for (const interestKey of interests) {
      await ctx.db.insert("userInterests", {
        userId,
        interestKey,
        createdAt: now,
      });
    }
  },
});

/**
 * Deactivate user account
 * Requires ownership or admin access
 */
export const deactivateUser = mutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    // Verify user has permission to deactivate this account
    await assertOwnershipOrAdmin(ctx, userId);

    const user = await ctx.db.get(userId);
    if (!user) {
      throw createError.notFound("User", userId);
    }

    if (!user.isActive) {
      throw createError.validation("User is already deactivated");
    }

    // Deactivate user
    await ctx.db.patch(userId, {
      isActive: false,
      updatedAt: Date.now(),
    });

    // TODO: In a complete implementation, we would also:
    // - Cancel any active meetings
    // - Remove from matching queues
    // - Clean up active sessions
  },
});

/**
 * Update user's last seen timestamp
 * Used for presence tracking
 */
export const updateLastSeen = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) =>
        q.eq("workosUserId", identity.workosUserId),
      )
      .unique();

    if (user) {
      await ctx.db.patch(user._id, {
        lastSeenAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});
