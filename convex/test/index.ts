/**
 * Test Setup and Utilities
 *
 * This file provides test setup utilities and helpers for Convex testing.
 * It handles the convex-test library initialization and provides common
 * test utilities.
 */

import { convexTest } from "convex-test";
import schema from "../schema";

/**
 * Create a test environment with proper schema initialization
 * Uses the edge-runtime environment which supports import.meta.glob
 */
export function createTestEnvironment() {
  return convexTest(schema);
}

/**
 * Create a test user for testing purposes
 */
export async function createTestUser(
  t: any,
  userData: Partial<{
    workosUserId: string;
    email: string;
    displayName: string;
    orgId: string;
    orgRole: string;
  }> = {},
) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      workosUserId: userData.workosUserId || "test-user-id",
      email: userData.email || "test@example.com",
      displayName: userData.displayName || "Test User",
      orgId: userData.orgId || "test-org",
      orgRole: userData.orgRole || "member",
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

/**
 * Create a test meeting for testing purposes
 */
export async function createTestMeeting(
  t: any,
  organizerId: any,
  meetingData: Partial<{
    title: string;
    description: string;
    scheduledAt: number;
    duration: number;
  }> = {},
) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("meetings", {
      organizerId,
      title: meetingData.title || "Test Meeting",
      description: meetingData.description || "A test meeting",
      scheduledAt: meetingData.scheduledAt || Date.now() + 3600000,
      duration: meetingData.duration || 1800,
      state: "scheduled",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

/**
 * Mock authentication context for testing
 */
export const mockAuthContext = {
  getUserIdentity: (userId?: string) => ({
    subject: userId || "test-user-id",
    email: "test@example.com",
    name: "Test User",
    org_id: "test-org",
    org_role: "member",
  }),
};

/**
 * Mock external services for testing
 */
export const mockServices = {
  workos: {
    getUserIdentity: () => mockAuthContext.getUserIdentity(),
  },
  getstream: {
    createRoom: () => Promise.resolve({ roomId: "test-room-id" }),
    generateToken: () => Promise.resolve("test-token"),
  },
  webrtc: {
    createRoom: () =>
      Promise.resolve({
        roomId: "webrtc-room-id",
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      }),
  },
  ai: {
    generateEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
    generateInsights: () =>
      Promise.resolve({
        summary: "Test summary",
        actionItems: ["Test action"],
      }),
  },
};
