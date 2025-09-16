/**
 * User Entity Validators
 *
 * This module provides Convex validators that correspond to the User entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns with args and returns
 */

import { v } from "convex/values";
import type {
  User,
  UserProfile,
  Interest,
  UserInterest,
  UserPublic,
  UserPublicWithEmail,
  UserSummary,
  UserWithProfile,
  UserWithOrgInfo,
  UserWithInterests,
  UserComplete,
  AuthIdentity,
  OnboardingData,
  OnboardingResult,
  UserSearchFilters,
  UserSearchResult,
  UserStats,
} from "../entities/user";

// Core User validators (matches schema exactly)
export const UserV = {
  // Full user entity
  full: v.object({
    _id: v.id("users"),
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
  }),

  // Public-safe user (no email by default)
  public: v.object({
    _id: v.id("users"),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
  }),

  // Public with email (opt-in for admin/internal UIs)
  publicWithEmail: v.object({
    _id: v.id("users"),
    displayName: v.optional(v.string()),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
  }),

  // User summary for lists and references
  summary: v.object({
    _id: v.id("users"),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }),

  // User with organization info
  withOrgInfo: v.object({
    _id: v.id("users"),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
  }),
} as const;

// User Profile validators (matches schema exactly)
export const UserProfileV = {
  full: v.object({
    _id: v.id("profiles"),
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
  }),
} as const;

// Interest validators (matches schema exactly)
export const InterestV = {
  full: v.object({
    _id: v.id("interests"),
    key: v.string(),
    label: v.string(),
    category: v.string(),
    iconName: v.optional(v.string()),
    // Denormalized field for performance
    usageCount: v.optional(v.number()),
    createdAt: v.number(),
  }),
} as const;

// User Interest validators (matches schema exactly)
export const UserInterestV = {
  full: v.object({
    _id: v.id("userInterests"),
    userId: v.id("users"),
    interestKey: v.string(),
    createdAt: v.number(),
  }),

  // User interest with interest details
  withInterest: v.object({
    _id: v.id("userInterests"),
    userId: v.id("users"),
    interestKey: v.string(),
    createdAt: v.number(),
    interest: InterestV.full,
  }),
} as const;

// Auth Identity validators
export const AuthIdentityV = {
  full: v.object({
    userId: v.id("users"),
    workosUserId: v.string(),
    orgId: v.union(v.string(), v.null()),
    orgRole: v.union(v.string(), v.null()),
    email: v.union(v.string(), v.null()),
    name: v.optional(v.union(v.string(), v.null())),
  }),
} as const;

// Composite type validators
export const UserCompositeV = {
  // User with profile
  withProfile: v.object({
    _id: v.id("users"),
    workosUserId: v.string(),
    email: v.string(),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    lastSeenAt: v.optional(v.number()),
    onboardingComplete: v.optional(v.boolean()),
    onboardingStartedAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    profile: v.optional(UserProfileV.full),
  }),

  // User with interests
  withInterests: v.object({
    _id: v.id("users"),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    interests: v.array(UserInterestV.withInterest),
  }),

  // Complete user data (internal use only)
  complete: v.object({
    _id: v.id("users"),
    workosUserId: v.string(),
    email: v.string(),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    lastSeenAt: v.optional(v.number()),
    onboardingComplete: v.optional(v.boolean()),
    onboardingStartedAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    profile: v.optional(UserProfileV.full),
    interests: v.array(UserInterestV.withInterest),
    orgInfo: v.optional(
      v.object({
        orgId: v.string(),
        orgRole: v.string(),
      }),
    ),
  }),
} as const;

// Onboarding validators
export const OnboardingV = {
  data: v.object({
    basicInfo: v.object({
      displayName: v.string(),
      bio: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
    }),
    professionalInfo: v.object({
      field: v.optional(v.string()),
      jobTitle: v.optional(v.string()),
      company: v.optional(v.string()),
      experience: v.optional(v.string()),
      linkedinUrl: v.optional(v.string()),
    }),
    personalInfo: v.object({
      age: v.optional(v.number()),
      gender: v.optional(
        v.union(
          v.literal("male"),
          v.literal("female"),
          v.literal("non-binary"),
          v.literal("prefer-not-to-say"),
        ),
      ),
      languages: v.array(v.string()),
      goals: v.optional(v.string()),
    }),
    interests: v.array(v.string()), // Interest keys
  }),

  result: v.object({
    userId: v.id("users"),
    profileId: v.id("profiles"),
    interestIds: v.array(v.id("userInterests")),
    completedAt: v.number(),
  }),
} as const;

// Search and filtering validators
export const UserSearchV = {
  filters: v.object({
    orgId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    hasProfile: v.optional(v.boolean()),
    onboardingComplete: v.optional(v.boolean()),
    interests: v.optional(v.array(v.string())),
    lastSeenSince: v.optional(v.number()),
  }),

  result: v.object({
    user: UserV.public,
    relevanceScore: v.number(),
    matchedFields: v.array(v.string()),
    snippet: v.optional(v.string()),
  }),
} as const;

// User statistics validators
export const UserStatsV = {
  full: v.object({
    totalMeetings: v.number(),
    totalConnections: v.number(),
    averageRating: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    profileCompleteness: v.number(), // 0-100 percentage
  }),
} as const;
