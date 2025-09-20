/**
 * User Mutations with Authentication Guards
 *
 * This module demonstrates proper usage of authentication guards
 * in Convex mutations with comprehensive error handling.
 *
 * Requirements: 2.3, 2.4, 2.6, 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators and centralized types
 */

import { mutation, internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import { UserV, UserProfileV, InterestV } from "@convex/types/validators/user";
import type { User, UserProfile } from "@convex/types/entities/user";

// Interest input validator for onboarding
const interestInputV = v.object({
  id: v.string(),
  name: v.string(),
  category: v.union(
    v.literal("academic"),
    v.literal("industry"),
    v.literal("skill"),
    v.literal("personal"),
  ),
  iconName: v.optional(v.string()),
});

// Save onboarding result validator
const SaveOnboardingResultV = v.object({
  userId: v.id("users"),
  profileId: v.id("profiles"),
  interestsCount: v.number(),
  onboardingCompleted: v.boolean(),
});

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
  handler: async (ctx, args): Promise<Id<"users">> => {
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
  handler: async (ctx, args): Promise<Id<"profiles">> => {
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
  handler: async (ctx, { userId, interests }): Promise<null> => {
    // Verify user has permission to update interests
    await assertOwnershipOrAdmin(ctx, userId);

    // Validate interests exist using indexed lookups (avoid full table scan)
    const invalidInterests: string[] = [];
    for (const key of interests) {
      const exists = await ctx.db
        .query("interests")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (!exists) invalidInterests.push(key);
    }

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

    return null;
  },
});

/**
 * Deactivate user account
 * Requires ownership or admin access
 */
export const deactivateUser = mutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }): Promise<null> => {
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

    return null;
  },
});

/**
 * Update user's last seen timestamp
 * Used for presence tracking
 */
export const updateLastSeen = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
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

    return null;
  },
});

/**
 * Save onboarding data atomically: profile fields + interests + onboarding flags.
 * Idempotent via idempotencyKeys.
 */
type SaveOnboardingResult = {
  userId: Id<"users">;
  profileId: Id<"profiles">;
  interestsCount: number;
  onboardingCompleted: boolean;
};

export const saveOnboarding = mutation({
  args: {
    age: v.number(),
    gender: v.union(
      v.literal("male"),
      v.literal("female"),
      v.literal("non-binary"),
      v.literal("prefer-not-to-say"),
    ),
    field: v.string(),
    jobTitle: v.string(),
    company: v.string(),
    linkedinUrl: v.optional(v.string()),
    bio: v.string(),
    interests: v.array(interestInputV),
    idempotencyKey: v.optional(v.string()),
  },
  returns: SaveOnboardingResultV,
  handler: async (ctx, args): Promise<SaveOnboardingResult> => {
    console.log("saveOnboarding args:", args);
    const identity = await requireIdentity(ctx);

    if (args.age < 13 || args.age > 120) {
      throw createError.validation("Invalid age");
    }
    console.log("bio length:", args.bio.length);
    if (args.bio.length < 10 || args.bio.length > 1000) {
      throw createError.validation(
        "Bio must be between 10 and 1000 characters",
      );
    }

    const scope = "users.onboarding.saveOnboarding" as const;
    const now = Date.now();
    const derivedKey =
      args.idempotencyKey ||
      JSON.stringify({ userId: identity.userId, ...args }).slice(0, 512);

    type IdempotencyKeyReturn = {
      _id: Id<"idempotencyKeys">;
      key: string;
      scope: string;
      createdAt: number;
      metadata?: unknown;
    } | null;

    const { internal } = await import("@convex/_generated/api");
    const existingKey: IdempotencyKeyReturn = await ctx.runQuery(
      internal.system.idempotency.getKey,
      {
        key: derivedKey,
        scope,
      },
    );
    type CompletedMeta = {
      status: "completed";
      userId: string;
      profileId: string;
      interestsCount?: number;
      completedAt?: number;
    };
    const isCompletedMeta = (m: unknown): m is CompletedMeta => {
      if (!m || typeof m !== "object") return false;
      const mm = m as Record<string, unknown>;
      return (
        mm["status"] === "completed" &&
        typeof mm["userId"] === "string" &&
        typeof mm["profileId"] === "string"
      );
    };
    if (existingKey && isCompletedMeta(existingKey.metadata)) {
      return {
        userId: existingKey.metadata.userId as Id<"users">,
        profileId: existingKey.metadata.profileId as Id<"profiles">,
        interestsCount: existingKey.metadata.interestsCount ?? 0,
        onboardingCompleted: true,
      };
    }
    if (!existingKey) {
      await ctx.runMutation(internal.system.idempotency.createKey, {
        key: derivedKey,
        scope,
        createdAt: now,
        metadata: { status: "started" as const },
      });
    }

    // Validate/resolve interests to canonical keys
    const interestKeys: string[] = [];
    const perUserCustomLimit = 5;
    let customCount = 0;
    for (const item of args.interests) {
      const candidateKey = item.id.trim();
      const found = await ctx.db
        .query("interests")
        .withIndex("by_key", (q) => q.eq("key", candidateKey))
        .unique();
      if (found) {
        interestKeys.push(found.key);
        continue;
      }
      if (item.category === "personal") {
        if (customCount >= perUserCustomLimit) {
          throw createError.validation(
            `Too many custom interests (max ${perUserCustomLimit})`,
            "interests",
          );
        }
        const label = item.name.trim().slice(0, 48);
        if (label.length < 2) {
          throw createError.validation(
            "Custom interest too short",
            "interests",
          );
        }
        const slug = label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        const customKey = `custom:${slug}`;
        const existingCustom = await ctx.db
          .query("interests")
          .withIndex("by_key", (q) => q.eq("key", customKey))
          .unique();
        if (!existingCustom) {
          await ctx.db.insert("interests", {
            key: customKey,
            label,
            category: "custom",
            usageCount: 0,
            createdAt: now,
          });
        }
        interestKeys.push(customKey);
        customCount += 1;
        continue;
      }
      throw createError.validation(
        `Invalid interest key: ${candidateKey}`,
        "interests",
      );
    }

    // Upsert profile
    const existingProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();
    let profileId = existingProfile?._id as Id<"profiles"> | undefined;
    if (existingProfile) {
      await ctx.db.patch(existingProfile._id, {
        bio: args.bio,
        age: args.age,
        gender: args.gender,
        field: args.field,
        jobTitle: args.jobTitle,
        company: args.company,
        linkedinUrl: args.linkedinUrl,
        updatedAt: now,
      });
      profileId = existingProfile._id;
    } else {
      const displayName =
        (await ctx.db.get(identity.userId))?.displayName || args.jobTitle;
      profileId = await ctx.db.insert("profiles", {
        userId: identity.userId,
        displayName,
        bio: args.bio,
        goals: undefined,
        languages: [],
        experience: undefined,
        age: args.age,
        gender: args.gender,
        field: args.field,
        jobTitle: args.jobTitle,
        company: args.company,
        linkedinUrl: args.linkedinUrl,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Replace user interests
    const existingInterests = await ctx.db
      .query("userInterests")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .collect();
    for (const row of existingInterests) await ctx.db.delete(row._id);
    for (const key of interestKeys) {
      await ctx.db.insert("userInterests", {
        userId: identity.userId,
        interestKey: key,
        createdAt: now,
      });
    }

    // Mark onboarding complete
    await ctx.db.patch(identity.userId, {
      onboardingComplete: true,
      onboardingCompletedAt: now,
      onboardingStartedAt:
        (await ctx.db.get(identity.userId))?.onboardingStartedAt ?? now,
      updatedAt: now,
    });

    // Increment usage counts
    for (const key of interestKeys) {
      const entry = await ctx.db
        .query("interests")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (entry)
        await ctx.db.patch(entry._id, {
          usageCount: (entry.usageCount || 0) + 1,
        });
    }

    // Audit
    await ctx.runMutation(internal.audit.logging.createAuditLog, {
      actorUserId: identity.userId,
      resourceType: "user",
      resourceId: String(identity.userId),
      action: "onboarding.save",
      category: "auth",
      success: true,
      metadata: { profileId, interestsCount: interestKeys.length },
    });

    // Complete idempotency
    const doneMeta = {
      status: "completed" as const,
      userId: String(identity.userId),
      profileId: String(profileId),
      interestsCount: interestKeys.length,
      completedAt: now,
    };
    const keyDoc: IdempotencyKeyReturn = await ctx.runQuery(
      internal.system.idempotency.getKey,
      { key: derivedKey, scope },
    );
    if (keyDoc)
      await ctx.runMutation(internal.system.idempotency.patchKey, {
        id: keyDoc._id,
        metadata: doneMeta,
      });

    return {
      userId: identity.userId,
      profileId: profileId!,
      interestsCount: interestKeys.length,
      onboardingCompleted: true,
    };
  },
});
/**
 * Internal helper mutation for creating users in tests and seed scripts.
 */
export const createUser = internalMutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    const now = Date.now();

    // If a user with this WorkOS ID already exists, update it to keep the helper idempotent.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", args.workosUserId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        displayName: args.displayName,
        orgId: args.orgId ?? existing.orgId,
        orgRole: args.orgRole ?? existing.orgRole,
        isActive: args.isActive ?? existing.isActive ?? true,
        updatedAt: now,
        lastSeenAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      workosUserId: args.workosUserId,
      email: args.email,
      displayName: args.displayName,
      orgId: args.orgId ?? undefined,
      orgRole: args.orgRole ?? undefined,
      isActive: args.isActive ?? true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});
