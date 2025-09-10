/**
 * User Queries with Authentication Guards
 *
 * This module demonstrates proper usage of authentication guards
 * in Convex queries with WorkOS integration.
 *
 * Requirements: 2.3, 2.4
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "../auth/guards";

/**
 * Get current user profile
 * Requires authentication but no additional permissions
 */
export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      displayName: v.optional(v.string()),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      isActive: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) =>
        q.eq("workosUserId", identity.workosUserId),
      )
      .unique();

    return user;
  },
});

/**
 * Get user profile by ID
 * Requires ownership or admin access
 */
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      displayName: v.optional(v.string()),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      isActive: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    // Verify user has permission to access this profile
    await assertOwnershipOrAdmin(ctx, userId);

    const user = await ctx.db.get(userId);
    return user;
  },
});

/**
 * Get user's extended profile information
 * Requires authentication and ownership/admin access
 */
export const getUserProfile = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      user: v.object({
        _id: v.id("users"),
        workosUserId: v.string(),
        email: v.string(),
        displayName: v.optional(v.string()),
        orgId: v.optional(v.string()),
        orgRole: v.optional(v.string()),
        isActive: v.boolean(),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      profile: v.optional(
        v.object({
          _id: v.id("profiles"),
          userId: v.id("users"),
          displayName: v.string(),
          bio: v.optional(v.string()),
          goals: v.optional(v.string()),
          languages: v.array(v.string()),
          experience: v.optional(v.string()),
          createdAt: v.number(),
          updatedAt: v.number(),
        }),
      ),
      interests: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    // Verify access permissions
    await assertOwnershipOrAdmin(ctx, userId);

    // Get user data
    const user = await ctx.db.get(userId);
    if (!user) return null;

    // Get profile data
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    // Get user interests
    const userInterests = await ctx.db
      .query("userInterests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const interests = userInterests.map((ui) => ui.interestKey);

    const result = {
      user,
      interests,
    } as {
      user: typeof user;
      interests: string[];
      profile?: NonNullable<typeof profile>;
    };
    if (profile) result.profile = profile;
    return result;
  },
});

/**
 * List users in the same organization
 * Requires authentication and organization membership
 */
export const getOrgUsers = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    users: v.array(
      v.object({
        _id: v.id("users"),
        workosUserId: v.string(),
        email: v.string(),
        displayName: v.optional(v.string()),
        orgRole: v.optional(v.string()),
        isActive: v.boolean(),
        lastSeenAt: v.optional(v.number()),
      }),
    ),
    nextCursor: v.optional(v.string()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { limit = 50, cursor }) => {
    const identity = await requireIdentity(ctx);

    if (!identity.orgId) {
      return { users: [], nextCursor: undefined, hasMore: false };
    }

    // Query users in the same organization
    let query = ctx.db
      .query("users")
      .withIndex("by_org_and_active", (q) =>
        q.eq("orgId", identity.orgId!).eq("isActive", true),
      );

    // Apply pagination if cursor provided
    if (cursor) {
      query = query.filter((q) =>
        q.gt(q.field("_creationTime"), parseInt(cursor)),
      );
    }

    const users = await query.take(limit + 1);
    const hasMore = users.length > limit;
    const resultUsers = hasMore ? users.slice(0, -1) : users;
    const nextCursor = hasMore
      ? users[users.length - 1]._creationTime.toString()
      : undefined;

    return {
      users: resultUsers,
      nextCursor,
      hasMore,
    };
  },
});
