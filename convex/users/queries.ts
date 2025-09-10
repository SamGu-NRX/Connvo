import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, getUserFromAuth } from "../auth/guards";

export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      isActive: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    try {
      const user = await getUserFromAuth(ctx);
      return user;
    } catch (error) {
      // User not found or not authenticated
      return null;
    }
  },
});

export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      isActive: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    // Basic access control - only return active users
    const user = await ctx.db.get(userId);

    if (!user || !user.isActive) {
      return null;
    }

    return user;
  },
});
