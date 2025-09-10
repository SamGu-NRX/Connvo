import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, getUserFromAuth } from "../auth/guards";

export const createOrUpdateUser = mutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
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
        avatarUrl: args.avatarUrl,
        orgId: args.orgId,
        orgRole: args.orgRole,
        isActive: true,
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
        avatarUrl: args.avatarUrl,
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

export const updateUserActivity = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getUserFromAuth(ctx);

    await ctx.db.patch(user._id, {
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const syncUserFromWorkOS = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const identity = requireIdentity(ctx);

    // Try to find existing user
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) =>
        q.eq("workosUserId", identity.workosUserId),
      )
      .unique();

    const now = Date.now();
    const displayName =
      identity.firstName && identity.lastName
        ? `${identity.firstName} ${identity.lastName}`
        : identity.firstName || identity.email || "Unknown User";

    if (existingUser) {
      // Update existing user with latest WorkOS data
      await ctx.db.patch(existingUser._id, {
        email: identity.email || existingUser.email,
        displayName: displayName,
        orgId: identity.orgId || undefined,
        orgRole: identity.orgRole || undefined,
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      });
      return existingUser._id;
    } else {
      // Create new user
      return await ctx.db.insert("users", {
        workosUserId: identity.workosUserId,
        email: identity.email || "",
        displayName: displayName,
        orgId: identity.orgId || undefined,
        orgRole: identity.orgRole || undefined,
        isActive: true,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
