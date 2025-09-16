import { defineTable } from "convex/server";
import { v } from "convex/values";

export const userTables = {
  // User Management
  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
    // Denormalized for performance
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    lastSeenAt: v.optional(v.number()),
    // Onboarding state
    onboardingComplete: v.optional(v.boolean()),
    onboardingStartedAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workos_id", ["workosUserId"])
    .index("by_org_and_active", ["orgId", "isActive"])
    .index("by_email", ["email"])
    .index("by_last_seen", ["lastSeenAt"])
    .index("by_org_and_role", ["orgId", "orgRole"])
    .index("by_onboarding_complete", ["onboardingComplete"]),

  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    goals: v.optional(v.string()),
    languages: v.array(v.string()),
    experience: v.optional(v.string()),
    // Onboarding fields (structured)
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
  })
    .index("by_user", ["userId"])
    .index("by_updated", ["updatedAt"]),
};
