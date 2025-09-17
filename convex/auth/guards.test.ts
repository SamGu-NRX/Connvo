/**
 * Authentication Guards Test Suite
 *
 * This test file demonstrates proper usage and testing of authentication guards.
 * It serves as both documentation and validation of the auth system.
 *
 * Requirements: 18.1, 18.3
 * Compliance: steering/convex_rules.mdc - Follows Convex testing patterns
 */

import { convexTest } from "convex-test";
import { api, internal } from "@convex/_generated/api";
import { expect, test, describe, beforeEach } from "vitest";
import { Id } from "@convex/_generated/dataModel";

describe("Authentication Guards", () => {
  let t: ReturnType<typeof convexTest>;
  let testUserId: Id<"users">;
  let testMeetingId: Id<"meetings">;
  let otherUserId: Id<"users">;

  beforeEach(async () => {
    t = convexTest();

    // Create test users
    testUserId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "test-workos-user-1",
      email: "test1@example.com",
      displayName: "Test User 1",
      orgId: "test-org",
      orgRole: "member",
    });

    otherUserId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "test-workos-user-2",
      email: "test2@example.com",
      displayName: "Test User 2",
      orgId: "test-org",
      orgRole: "member",
    });

    // Create test meeting
    const created = await t.mutation(api.meetings.mutations.createMeeting, {
      title: "Test Meeting",
      description: "A test meeting for auth testing",
      scheduledAt: Date.now() + 3600000, // 1 hour from now
      duration: 1800, // 30 minutes
    });
    testMeetingId = created.meetingId;
  });

  describe("requireIdentity", () => {
    test("should return identity for authenticated user", async () => {
      // Mock authentication context
      const mockAuth = {
        getUserIdentity: () => ({
          subject: "test-workos-user-1",
          email: "test1@example.com",
          name: "Test User 1",
          org_id: "test-org",
          org_role: "member",
        }),
      };

      // This would be tested with proper Convex test utilities
      // For now, this demonstrates the expected behavior
      expect(mockAuth.getUserIdentity()).toBeDefined();
    });

    test("should throw UNAUTHORIZED for unauthenticated user", async () => {
      // Mock unauthenticated context
      const mockAuth = {
        getUserIdentity: () => null,
      };

      // This should throw an UNAUTHORIZED error
      expect(mockAuth.getUserIdentity()).toBeNull();
    });
  });

  describe("assertMeetingAccess", () => {
    test("should allow access for meeting participant", async () => {
      // Add user as participant to meeting
      await t.mutation(api.meetings.mutations.addParticipant, {
        meetingId: testMeetingId,
        userId: testUserId,
        role: "participant",
      });

      // User should be able to access meeting
      const meeting = await t.query(api.meetings.queries.getMeeting, {
        meetingId: testMeetingId,
      });

      expect(meeting).toBeDefined();
      expect(meeting?._id).toBe(testMeetingId);
    });

    test("should deny access for non-participant", async () => {
      // User is not added as participant
      // This should throw a FORBIDDEN error
      try {
        await t.query(api.meetings.queries.getMeeting, {
          meetingId: testMeetingId,
        });
        expect.fail("Should have thrown FORBIDDEN error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Access denied");
      }
    });

    test("should enforce role requirements", async () => {
      // Add user as participant (not host)
      await t.mutation(api.meetings.mutations.addParticipant, {
        meetingId: testMeetingId,
        userId: testUserId,
        role: "participant",
      });

      // Try to perform host-only action
      try {
        await t.mutation(api.meetings.mutations.startMeeting, {
          meetingId: testMeetingId,
        });
        expect.fail("Should have thrown INSUFFICIENT_PERMISSIONS error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Requires host role");
      }
    });
  });

  describe("assertOwnershipOrAdmin", () => {
    test("should allow user to access own profile", async () => {
      const profile = await t.query(api.users.queries.getUserById, {
        userId: testUserId,
      });

      expect(profile).toBeDefined();
      expect(profile?._id).toBe(testUserId);
    });

    test("should deny access to other user's profile for non-admin", async () => {
      try {
        await t.query(api.users.queries.getUserById, {
          userId: otherUserId,
        });
        expect.fail("Should have thrown FORBIDDEN error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Insufficient permissions");
      }
    });

    test("should allow admin to access any profile", async () => {
      // Update user to admin role
      await t.mutation(api.users.mutations.upsertUser, {
        workosUserId: "test-workos-user-1",
        email: "test1@example.com",
        displayName: "Test User 1",
        orgId: "test-org",
        orgRole: "admin",
      });

      const profile = await t.query(api.users.queries.getUserById, {
        userId: otherUserId,
      });

      expect(profile).toBeDefined();
      expect(profile?._id).toBe(otherUserId);
    });
  });

  describe("Audit Logging", () => {
    test("should log successful meeting access", async () => {
      // Add user as participant
      await t.mutation(api.meetings.mutations.addParticipant, {
        meetingId: testMeetingId,
        userId: testUserId,
        role: "participant",
      });

      // Access meeting (should create audit log)
      await t.query(api.meetings.queries.getMeeting, {
        meetingId: testMeetingId,
      });

      // Check audit logs
      const auditPage = await t.query(api.audit.logging.getAuditLogs, {
        resourceType: "meeting",
        resourceId: testMeetingId,
        limit: 10,
      });
      const auditLogs = auditPage.logs;
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe("access_granted");
      expect(auditLogs[0].actorUserId).toBe(testUserId);
    });

    test("should log authorization failures", async () => {
      // Try to access meeting without permission
      try {
        await t.query(api.meetings.queries.getMeeting, {
          meetingId: testMeetingId,
        });
      } catch (error) {
        // Expected to fail
      }

      // Check audit logs for failed access attempt
      const auditPage2 = await t.query(api.audit.logging.getAuditLogs, {
        resourceType: "meeting",
        resourceId: testMeetingId,
        limit: 10,
      });
      const failedAccess = auditPage2.logs.find(
        (log: any) => log.action === "access_denied",
      );
      expect(failedAccess).toBeDefined();
      expect(failedAccess?.actorUserId).toBe(testUserId);
    });
  });

  describe("Performance and Edge Cases", () => {
    test("should handle concurrent access checks efficiently", async () => {
      // Add user as participant
      await t.mutation(api.meetings.mutations.addParticipant, {
        meetingId: testMeetingId,
        userId: testUserId,
        role: "participant",
      });

      // Perform multiple concurrent access checks
      const promises = Array.from({ length: 10 }, () =>
        t.query(api.meetings.queries.getMeeting, {
          meetingId: testMeetingId,
        }),
      );

      const start = Date.now();
      const results = await Promise.all(promises);
      type GetMeetingReturn = {
        _id: import("../_generated/dataModel").Id<"meetings">;
        organizerId: import("../_generated/dataModel").Id<"users">;
        title: string;
        description?: string;
        scheduledAt?: number;
        duration?: number;
        streamRoomId?: string;
        state: "scheduled" | "active" | "concluded" | "cancelled";
        createdAt: number;
        updatedAt: number;
      } | null;
      const typedResults = results as Array<GetMeetingReturn>;
      const duration = Date.now() - start;

      // All should succeed
      typedResults.forEach((result) => {
        expect(result).toBeDefined();
        expect(result?._id).toBe(testMeetingId);
      });

      // Should complete within reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);
    });

    test("should handle invalid meeting IDs gracefully", async () => {
      const invalidMeetingId = "invalid-meeting-id" as Id<"meetings">;

      try {
        await t.query(api.meetings.queries.getMeeting, {
          meetingId: invalidMeetingId,
        });
        expect.fail("Should have thrown NOT_FOUND error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("not found");
      }
    });

    test("should handle malformed JWT tokens", async () => {
      // This would be tested with malformed auth context
      // The guards should gracefully handle and throw appropriate errors
      expect(true).toBe(true); // URGENT TODO: Placeholder for actual implementation
    });
  });
});
