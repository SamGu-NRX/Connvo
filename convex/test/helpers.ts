/**
 * Test Helper Utilities for Convex Functions
 *
 * This module provides standardized test utilities for creating test data,
 * mocking authentication contexts, and setting up test environments.
 *
 * Requirements: 3.1, 3.2, 3.4, 5.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { convexTest } from "convex-test";
import { Id } from "@convex/_generated/dataModel";
import schema from "../../convex/schema.js";
import { modules as testModules } from "./setup";

/**
 * Creates a standardized test environment with proper module resolution
 */
export function createTestEnvironment() {
  return convexTest(schema, testModules);
}

/**
 * Test user data interface
 */
export interface TestUserData {
  workosUserId?: string;
  email?: string;
  displayName?: string;
  orgId?: string;
  orgRole?: "admin" | "member";
  isActive?: boolean;
}

/**
 * Test meeting data interface
 */
export interface TestMeetingData {
  title?: string;
  description?: string;
  scheduledAt?: number;
  duration?: number;
  state?: "scheduled" | "active" | "concluded" | "cancelled";
}

/**
 * Test profile data interface
 */
export interface TestProfileData {
  displayName?: string;
  bio?: string;
  age?: number;
  gender?: "male" | "female" | "non-binary" | "prefer-not-to-say";
  field?: string;
  jobTitle?: string;
  company?: string;
  linkedinUrl?: string;
}

/**
 * Creates a test user with default values
 */
export async function createTestUser(
  t: ReturnType<typeof createTestEnvironment>,
  userData: TestUserData = {},
): Promise<Id<"users">> {
  const defaultData = {
    workosUserId: `test-workos-${Date.now()}-${Math.random()}`,
    email: `test-${Date.now()}@example.com`,
    displayName: "Test User",
    orgId: "test-org",
    orgRole: "member" as const,
    isActive: true,
    ...userData,
  };

  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      workosUserId: defaultData.workosUserId,
      email: defaultData.email,
      displayName: defaultData.displayName,
      orgId: defaultData.orgId,
      orgRole: defaultData.orgRole,
      isActive: defaultData.isActive,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Creates a test meeting with default values
 */
export async function createTestMeeting(
  t: ReturnType<typeof createTestEnvironment>,
  organizerId: Id<"users">,
  meetingData: TestMeetingData = {},
): Promise<Id<"meetings">> {
  const defaultData = {
    title: "Test Meeting",
    description: "A test meeting",
    scheduledAt: Date.now() + 3600000, // 1 hour from now
    duration: 1800, // 30 minutes
    state: "scheduled" as const,
    ...meetingData,
  };

  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("meetings", {
      organizerId,
      title: defaultData.title,
      description: defaultData.description,
      scheduledAt: defaultData.scheduledAt,
      duration: defaultData.duration,
      state: defaultData.state,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Creates a test profile for a user
 */
export async function createTestProfile(
  t: ReturnType<typeof createTestEnvironment>,
  userId: Id<"users">,
  profileData: TestProfileData = {},
): Promise<Id<"profiles">> {
  const defaultData = {
    displayName: "Test User",
    bio: "This is a test user profile for testing purposes.",
    age: 30,
    gender: "prefer-not-to-say" as const,
    field: "Technology",
    jobTitle: "Software Engineer",
    company: "Test Company",
    ...profileData,
  };

  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("profiles", {
      userId,
      displayName: defaultData.displayName,
      bio: defaultData.bio,
      goals: undefined,
      languages: [],
      experience: undefined,
      age: defaultData.age,
      gender: defaultData.gender,
      field: defaultData.field,
      jobTitle: defaultData.jobTitle,
      company: defaultData.company,
      linkedinUrl: defaultData.linkedinUrl,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Adds a user as a participant to a meeting
 */
export async function addMeetingParticipant(
  t: ReturnType<typeof createTestEnvironment>,
  meetingId: Id<"meetings">,
  userId: Id<"users">,
  role: "host" | "participant" | "observer" = "participant",
  presence: "invited" | "joined" | "left" = "invited",
): Promise<Id<"meetingParticipants">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId,
      role,
      joinedAt: presence === "joined" ? now : undefined,
      leftAt: presence === "left" ? now : undefined,
      presence,
      createdAt: now,
    });
  });
}

/**
 * Creates a test interest
 */
export async function createTestInterest(
  t: ReturnType<typeof createTestEnvironment>,
  key: string,
  label: string,
  category: "academic" | "industry" | "skill" | "personal" | "custom" = "skill",
): Promise<Id<"interests">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("interests", {
      key,
      label,
      category,
      usageCount: 0,
      createdAt: now,
    });
  });
}

/**
 * Adds interests to a user
 */
export async function addUserInterests(
  t: ReturnType<typeof createTestEnvironment>,
  userId: Id<"users">,
  interestKeys: string[],
): Promise<void> {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (const interestKey of interestKeys) {
      await ctx.db.insert("userInterests", {
        userId,
        interestKey,
        createdAt: now,
      });
    }
  });
}

/**
 * Creates a complete test user with profile and interests
 */
export async function createCompleteTestUser(
  t: ReturnType<typeof createTestEnvironment>,
  userData: TestUserData = {},
  profileData: TestProfileData = {},
  interestKeys: string[] = [],
): Promise<{
  userId: Id<"users">;
  profileId: Id<"profiles">;
  workosUserId: string;
}> {
  const workosUserId =
    userData.workosUserId || `test-workos-${Date.now()}-${Math.random()}`;

  const userId = await createTestUser(t, { ...userData, workosUserId });
  const profileId = await createTestProfile(t, userId, profileData);

  if (interestKeys.length > 0) {
    await addUserInterests(t, userId, interestKeys);
  }

  return { userId, profileId, workosUserId };
}

/**
 * Creates a test meeting with participants
 */
export async function createTestMeetingWithParticipants(
  t: ReturnType<typeof createTestEnvironment>,
  organizerData: TestUserData = {},
  participantCount: number = 2,
  meetingData: TestMeetingData = {},
  options: {
    organizerOverride?: {
      userId: Id<"users">;
      workosUserId: string;
    };
  } = {},
): Promise<{
  meetingId: Id<"meetings">;
  organizerId: Id<"users">;
  participantIds: Id<"users">[];
  organizerWorkosId: string;
  participantWorkosIds: string[];
}> {
  // Create organizer
  let organizerId: Id<"users">;
  let organizerWorkosId: string;
  if (options.organizerOverride) {
    organizerId = options.organizerOverride.userId;
    organizerWorkosId = options.organizerOverride.workosUserId;
  } else {
    const organizerResult = await createCompleteTestUser(t, organizerData);
    organizerId = organizerResult.userId;
    organizerWorkosId = organizerResult.workosUserId;
  }

  // Create meeting
  const meetingId = await createTestMeeting(t, organizerId, meetingData);

  // Add organizer as host
  await addMeetingParticipant(t, meetingId, organizerId, "host", "joined");

  // Create and add participants
  const participantIds: Id<"users">[] = [];
  const participantWorkosIds: string[] = [];
  for (let i = 0; i < participantCount; i++) {
    const { userId: participantId, workosUserId: participantWorkosId } =
      await createCompleteTestUser(t, {
        email: `participant-${i}@example.com`,
        displayName: `Participant ${i + 1}`,
      });
    await addMeetingParticipant(
      t,
      meetingId,
      participantId,
      "participant",
      "invited",
    );
    participantIds.push(participantId);
    participantWorkosIds.push(participantWorkosId);
  }

  return {
    meetingId,
    organizerId,
    participantIds,
    organizerWorkosId,
    participantWorkosIds,
  };
}

/**
 * Cleans up test data (useful for integration tests)
 */
export async function cleanupTestData(
  t: ReturnType<typeof createTestEnvironment>,
  userIds: Id<"users">[],
): Promise<void> {
  await t.run(async (ctx) => {
    // Clean up in reverse dependency order
    for (const userId of userIds) {
      // Remove user interests
      const userInterests = await ctx.db
        .query("userInterests")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const interest of userInterests) {
        await ctx.db.delete(interest._id);
      }

      // Remove profiles
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (profile) {
        await ctx.db.delete(profile._id);
      }

      // Remove meeting participants
      const participations = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const participation of participations) {
        await ctx.db.delete(participation._id);
      }

      // Remove meetings organized by user
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_organizer", (q) => q.eq("organizerId", userId))
        .collect();
      for (const meeting of meetings) {
        await ctx.db.delete(meeting._id);
      }

      // Finally, remove user
      await ctx.db.delete(userId);
    }
  });
}

/**
 * Waits for a condition to be true (useful for async operations)
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
/**
 * Re-export mock functions for convenience
 */
export { resetAllMocks, setupTestMocks, cleanupTestMocks } from "./mocks";
export { modules as convexFunctionModules } from "./setup";
