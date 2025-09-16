/**
 * User Entity Type Definitions
 *
 * This module defines all user-related entity types including User, UserProfile,
 * and AuthIdentity with their derived types for different use cases.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling
 */

import type { Id } from "../../_generated/dataModel";

// Core User entity (matches convex/schema/users.ts exactly)
export interface User {
  _id: Id<"users">;
  _creationTime: number; // Convex system field
  workosUserId: string;
  email: string;
  orgId?: string;
  orgRole?: string;
  // Denormalized for performance
  displayName?: string;
  avatarUrl?: string;
  isActive: boolean;
  lastSeenAt?: number;
  // Onboarding state
  onboardingComplete?: boolean;
  onboardingStartedAt?: number;
  onboardingCompletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// User profile entity (matches convex/schema/users.ts exactly)
export interface UserProfile {
  _id: Id<"profiles">;
  userId: Id<"users">;
  displayName: string;
  bio?: string;
  goals?: string;
  languages: string[];
  experience?: string;
  // Onboarding fields (structured)
  age?: number;
  gender?: "male" | "female" | "non-binary" | "prefer-not-to-say";
  field?: string;
  jobTitle?: string;
  company?: string;
  linkedinUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// Interest entity (matches convex/schema/interests.ts)
export interface Interest {
  _id: Id<"interests">;
  key: string;
  label: string;
  category: string;
  iconName?: string;
  // Denormalized field for performance
  usageCount?: number;
  createdAt: number;
}

// User interest relationship (matches convex/schema/interests.ts)
export interface UserInterest {
  _id: Id<"userInterests">;
  userId: Id<"users">;
  interestKey: string;
  createdAt: number;
}

// Authentication identity (for WorkOS integration)
export interface AuthIdentity {
  userId: Id<"users">;
  workosUserId: string;
  orgId: string | null;
  orgRole: string | null;
  email: string | null;
  name?: string | null;
}

// Derived types for different use cases

// Public-safe: No email by default for privacy unless explicitly needed
export type UserPublic = Pick<
  User,
  "_id" | "displayName" | "avatarUrl" | "isActive"
>;

// Public with email (opt-in, e.g., admin/internal UIs)
export type UserPublicWithEmail = UserPublic & Pick<User, "email">;

// User summary for lists and references
export type UserSummary = Pick<User, "_id" | "displayName" | "avatarUrl">;

// User with profile joined
export type UserWithProfile = User & { profile?: UserProfile };

// User with organization info
export type UserWithOrgInfo = UserPublic & Pick<User, "orgId" | "orgRole">;

// User with interests
export type UserWithInterests = UserPublic & {
  interests: Array<UserInterest & { interest: Interest }>;
};

// Complete user data (internal use only)
export type UserComplete = User & {
  profile?: UserProfile;
  interests: Array<UserInterest & { interest: Interest }>;
  orgInfo?: {
    orgId: string;
    orgRole: string;
  };
};

// Onboarding-specific types
export interface OnboardingData {
  basicInfo: {
    displayName: string;
    bio?: string;
    avatarUrl?: string;
  };
  professionalInfo: {
    field?: string;
    jobTitle?: string;
    company?: string;
    experience?: string;
    linkedinUrl?: string;
  };
  personalInfo: {
    age?: number;
    gender?: UserProfile["gender"];
    languages: string[];
    goals?: string;
  };
  interests: string[]; // Interest keys
}

export interface OnboardingResult {
  userId: Id<"users">;
  profileId: Id<"profiles">;
  interestIds: Id<"userInterests">[];
  completedAt: number;
}

// User search and filtering types
export interface UserSearchFilters {
  orgId?: string;
  isActive?: boolean;
  hasProfile?: boolean;
  onboardingComplete?: boolean;
  interests?: string[];
  lastSeenSince?: number;
}

export interface UserSearchResult {
  user: UserPublic;
  relevanceScore: number;
  matchedFields: string[];
  snippet?: string;
}

// User statistics and analytics
export interface UserStats {
  totalMeetings: number;
  totalConnections: number;
  averageRating?: number;
  lastActivityAt?: number;
  onboardingCompletedAt?: number;
  profileCompleteness: number; // 0-100 percentage
}
