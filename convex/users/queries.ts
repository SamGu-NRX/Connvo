/**
 * User Query Functions
 *
 * This module provides query functions for user data access with
 * proper authorization and performance optimization.
 *
 * Requirements: 2.2, 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns with centralized types
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { Id } from "@convex/_generated/dataModel";
import { UserV } from "@convex/types/validators/user";
import type {
  User,
  UserPublic,
  UserWithOrgInfo,
} from "@convex/types/entities/user";

// Onboarding state validator
const OnboardingStateV = v.object({
  userId: v.id("users"),
  onboardingComplete: v.boolean(),
  profileExists: v.boolean(),
  profileId: v.optional(v.id("profiles")),
  completedAt: v.optional(v.number()),
});

/**
 * Gets user by ID (internal use)
 */
export const getUserByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => {
    return await ctx.db.get(userId);
  },
});

// Public wrapper for tests and non-sensitive usage
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => {
    return await ctx.db.get(userId);
  },
});

/**
 * Gets user by WorkOS ID (internal use)
 */
export const getUserByWorkosId = internalQuery({
  args: { workosUserId: v.string() },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { workosUserId }): Promise<User | null> => {
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
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx): Promise<User | null> => {
    // Return null instead of throwing when unauthenticated so clients can
    // safely subscribe without triggering errors during logged-out states.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const workosUserId: string = identity.subject;

    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();
  },
});

/**
 * Gets user profile by ID (with authorization)
 */
export const getUserProfile = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.withOrgInfo, v.null()),
  handler: async (ctx, { userId }): Promise<UserWithOrgInfo | null> => {
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
  returns: OnboardingStateV,
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

/**
 * List active users in the same organization (with pagination)
 * Uses index-first query pattern per convex_rules.mdc
 */
export const listActiveUsersInOrg = query({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: v.object({
    page: v.array(UserV.public),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const identity = await requireIdentity(ctx);

    // Use index-first query pattern - requires "by_org_and_active" index
    const result = await ctx.db
      .query("users")
      .withIndex("by_org_and_active", (q) =>
        q.eq("orgId", identity.orgId).eq("isActive", true),
      )
      .order("desc")
      .paginate(paginationOpts);

    // Return only public-safe user data
    return {
      page: result.page.map(
        (user): UserPublic => ({
          _id: user._id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isActive: user.isActive,
        }),
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Get users by onboarding completion status (internal use)
 * Uses index-first query pattern per convex_rules.mdc
 */
export const getUsersByOnboardingStatus = internalQuery({
  args: {
    onboardingComplete: v.boolean(),
    limit: v.optional(v.number()),
  },
  returns: v.array(UserV.full),
  handler: async (
    ctx,
    { onboardingComplete, limit = 100 },
  ): Promise<User[]> => {
    // Use index-first query - requires "by_onboarding_complete" index
    return await ctx.db
      .query("users")
      .withIndex("by_onboarding_complete", (q) =>
        q.eq("onboardingComplete", onboardingComplete),
      )
      .order("desc")
      .take(limit);
  },
});
