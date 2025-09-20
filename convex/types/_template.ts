/**
 * Template Function - Convex Compliance Example
 *
 * This template demonstrates the proper patterns for Convex functions
 * following all compliance requirements from steering/convex_rules.mdc
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 * Compliance: steering/convex_rules.mdc - All best practices
 */

import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  action,
  internalAction,
} from "@convex/_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { api, internal } from "@convex/_generated/api";
import { PaginationResultV, UserV } from "./validators";
import type { User, UserPublic } from "./entities";
import type { PaginationResult } from "./api/pagination";

// ✅ Example Query - Index-first with proper validators
export const listActiveUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    onboardingComplete: v.boolean(),
  },
  returns: PaginationResultV(UserV.public),
  handler: async (
    ctx,
    { paginationOpts, onboardingComplete },
  ): Promise<PaginationResult<UserPublic>> => {
    // ✅ Index-first query - assumes "by_isActive" index exists in schema
    const result = await ctx.db
      .query("users")
      .withIndex("by_onboarding_complete", (q) =>
        q.eq("onboardingComplete", onboardingComplete),
      )
      .order("desc")
      .paginate(paginationOpts);

    return result;
  },
});

// ✅ Example Mutation - Proper validation and return types
export const updateUserProfile = mutation({
  args: {
    userId: v.id("users"),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: v.union(UserV.public, v.null()),
  handler: async (
    ctx,
    { userId, displayName, avatarUrl },
  ): Promise<UserPublic | null> => {
    const existing = await ctx.db.get(userId);
    if (!existing) return null;

    const updatedUser = await ctx.db.patch(userId, {
      displayName,
      avatarUrl,
      updatedAt: Date.now(),
    });

    const updated = await ctx.db.get(userId);
    if (!updated) return null;

    return {
      _id: updated._id,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      isActive: updated.isActive,
    };
  },
});

// ✅ Example Internal Query - Private function
export const getUserByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => ctx.db.get(userId),
});

// ✅ Example Internal Mutation - Private function
export const createUserInternal = internalMutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
  },
  returns: UserV.full,
  handler: async (ctx, { workosUserId, email, displayName }): Promise<User> => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      workosUserId,
      email,
      displayName,
      isActive: true,
      onboardingComplete: false,
      createdAt: now,
      updatedAt: now,
    });

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Failed to create user");
    return user;
  },
});

// ✅ Example Action - Calls queries/mutations via ctx.run*
export const processUserOnboarding = action({
  args: {
    userId: v.id("users"),
    onboardingData: v.record(v.string(), v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, { userId, onboardingData }) => {
    try {
      const user = await ctx.runQuery(
        internal.users.queries.getUserByIdInternal,
        {
          userId,
        },
      );
      if (!user) {
        return { success: false, message: "User not found" };
      }

      const response = await fetch("https://api.example.com/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, data: onboardingData }),
      });

      if (!response.ok) {
        return { success: false, message: "External API failed" };
      }

      await ctx.runMutation(api.users.mutations.updateUserProfile, {
        userId,
        displayName: onboardingData.displayName,
      });

      return { success: true, message: "Onboarding completed" };
    } catch (error) {
      return { success: false, message: `Error: ${error}` };
    }
  },
});

// ✅ Example Internal Action - Private background task
export const syncUserDataInternal = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.runQuery(
      internal.users.queries.getUserByIdInternal,
      {
        userId,
      },
    );
    if (!user) return null;

    console.log(`Syncing user ${userId}`);
    return null;
  },
});

// ✅ Function calling example demonstrating type annotations
export const getUserWithStats = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      user: UserV.public,
      stats: v.object({
        meetingCount: v.number(),
        connectionCount: v.number(),
      }),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    const user = await ctx.runQuery(
      internal.users.queries.getUserByIdInternal,
      {
        userId,
      },
    );
    if (!user) return null;

    const publicUser: UserPublic = {
      _id: user._id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
    };

    return {
      user: publicUser,
      stats: {
        meetingCount: 0,
        connectionCount: 0,
      },
    };
  },
});
