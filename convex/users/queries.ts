/**
 * User Query Functions
 *
 * This module provides query functions for user data access with
 * proper authorization and performance optimization.
 *
 * Requirements: 2.2, 3.1
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns
 */

import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "../auth/guards";
import { Id } from "../_generated/dataModel";

/**
 * Gets user by ID (internal use)
 */
export const getUserByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      isActive: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

// Public wrapper for tests and non-sensitive usage
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      isActive: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

/**
 * Gets user by WorkOS ID (internal use)
 */
export const getUserByWorkosId = internalQuery({
  args: { workosUserId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      isActive: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { workosUserId }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();
  },
});

/**
 * Gets current user profile
 */
export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      isActive: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) =>
        q.eq("workosUserId", identity.workosUserId),
      )
      .unique();
  },
});

/**
 * Gets user profile by ID (with authorization)
 */
export const getUserProfile = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      displayName: v.optional(v.string()),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
      isActive: v.boolean(),
      // Only include org info if same org or admin
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db.get(userId);

    if (!user) {
      return null;
    }

    // Check if user can see full profile (same org or admin)
    const canSeeOrgInfo =
      identity.orgId === user.orgId || identity.orgRole === "admin";

    return {
      _id: user._id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      orgId: canSeeOrgInfo ? user.orgId : undefined,
      orgRole: canSeeOrgInfo ? user.orgRole : undefined,
    };
  },
});

/**
 * Get onboarding state for the current user.
 */
export const getOnboardingState = query({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    onboardingComplete: v.boolean(),
    profileExists: v.boolean(),
    profileId: v.optional(v.id("profiles")),
    completedAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db.get(identity.userId);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();

    return {
      userId: identity.userId,
      onboardingComplete: user?.onboardingComplete ?? false,
      profileExists: !!profile,
      profileId: profile?._id,
      completedAt: user?.onboardingCompletedAt,
    };
  },
});
