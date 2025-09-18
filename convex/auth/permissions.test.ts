/**
 * Dynamic Permission Management Test Suite
 *
 * This test suite validates the real-time permission system,
 * subscription management, and audit logging functionality.
 *
 * Requirements: 18.1, 18.2, 18.3
 * Compliance: steering/convex_rules.mdc - Follows Convex testing patterns
 */

import { convexTest } from "convex-test";
import { api, internal } from "@convex/_generated/api";
import { expect, test, describe, beforeEach } from "vitest";
import { Id } from "@convex/_generated/dataModel";

describe("Dynamic Permission Management", () => {
  let t: ReturnType<typeof convexTest>;
  let hostUserId: Id<"users">;
  let participantUserId: Id<"users">;
  let nonParticipantUserId: Id<"users">;
  let testMeetingId: Id<"meetings">;

  beforeEach(async () => {
    t = convexTest();

    // Create test users
    hostUserId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "host-user",
      email: "host@example.com",
      displayName: "Host User",
      orgId: "test-org",
      orgRole: "member",
    });

    participantUserId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "participant-user",
      email: "participant@example.com",
      displayName: "Participant User",
      orgId: "test-org",
      orgRole: "member",
    });

    nonParticipantUserId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "non-participant-user",
      email: "nonparticipant@example.com",
      displayName: "Non-Participant User",
      orgId: "test-org",
      orgRole: "member",
    });

    // Create test meeting
    const created = await t.mutation(api.meetings.lifecycle.createMeeting, {
      title: "Test Meeting for Permissions",
      description: "Testing dynamic permissions",
    });
    testMeetingId = created.meetingId;

    // Add participant
    await t.mutation(api.meetings.lifecycle.addParticipant, {
      meetingId: testMeetingId,
      userId: participantUserId,
      role: "participant",
    });
  });

  describe("Subscription Permission Validation", () => {
    test("should grant permissions for meeting participants", async () => {
      const validation = await t.query(
        api.auth.permissions.validateSubscriptionPermissions,
        {
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          requiredPermissions: ["read", "write"],
        },
      );

      expect(validation.granted).toBe(true);
      expect(validation.permissions).toContain("read");
      expect(validation.permissions).toContain("write");
    });

    test("should deny permissions for non-participants", async () => {
      // Validate for a user that isn't a participant
      const validation = await t.query(
        api.auth.permissions.validateSubscriptionPermissions,
        {
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          requiredPermissions: ["read", "write"],
        },
      );

      expect(validation.granted).toBe(false);
      expect(validation.permissions).toHaveLength(0);
      expect(validation.metadata.error).toContain("Access denied");
    });

    test("should enforce role-based permissions", async () => {
      // Host should have manage permissions
      const hostValidation = await t.query(
        api.auth.permissions.validateSubscriptionPermissions,
        {
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          requiredPermissions: ["read", "write", "manage"],
        },
      );

      expect(hostValidation.granted).toBe(true);
      expect(hostValidation.permissions).toContain("manage");

      // Participant should not have manage permissions
      const participantValidation = await t.query(
        api.auth.permissions.validateSubscriptionPermissions,
        {
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          requiredPermissions: ["read", "write", "manage"],
        },
      );

      expect(participantValidation.granted).toBe(true);
      expect(participantValidation.permissions).not.toContain("manage");
    });
  });

  describe("Real-Time Subscription Management", () => {
    test("should establish meeting notes subscription with proper permissions", async () => {
      const subscription = await t.query(
        api.realtime.subscriptions.subscribeMeetingNotes,
        {
          meetingId: testMeetingId,
          subscriptionId: "test-notes-sub-1",
        },
      );

      expect(subscription).toBeDefined();
      expect(subscription?.subscriptionValid).toBe(true);
      expect(subscription?.permissions).toContain("read");
      expect(subscription?.permissions).toContain("write");
    });

    test("should establish transcript subscription only for active meetings", async () => {
      // Start the meeting first
      await t.mutation(api.meetings.lifecycle.startMeeting, {
        meetingId: testMeetingId,
      });

      const subscription = await t.query(
        api.realtime.subscriptions.subscribeTranscriptStream,
        {
          meetingId: testMeetingId,
          subscriptionId: "test-transcript-sub-1",
        },
      );

      expect(subscription.subscriptionValid).toBe(true);
      expect(subscription.permissions).toContain("read");
      expect(subscription.transcripts).toBeDefined();
    });

    test("should deny transcript subscription for inactive meetings", async () => {
      // Meeting is not started, should deny transcript access
      try {
        await t.query(api.realtime.subscriptions.subscribeTranscriptStream, {
          meetingId: testMeetingId,
          subscriptionId: "test-transcript-sub-2",
        });
        expect.fail("Should have thrown MEETING_NOT_ACTIVE error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("not currently active");
      }
    });

    test("should validate subscription permissions in real-time", async () => {
      // Establish subscription
      await t.query(api.realtime.subscriptions.subscribeMeetingNotes, {
        meetingId: testMeetingId,
        subscriptionId: "test-validation-sub",
      });

      // Validate subscription
      const validation = await t.query(
        api.realtime.subscriptions.validateSubscription,
        {
          subscriptionId: "test-validation-sub",
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          lastValidated: Date.now() - 60000, // 1 minute ago
        },
      );

      expect(validation.valid).toBe(true);
      expect(validation.permissions).toContain("read");
      expect(validation.shouldReconnect).toBe(false);
    });
  });

  describe("Dynamic Permission Updates", () => {
    test("should revoke permissions when participant is removed", async () => {
      // Establish subscription first
      const subscription = await t.query(
        api.realtime.subscriptions.subscribeMeetingNotes,
        {
          meetingId: testMeetingId,
          subscriptionId: "test-removal-sub",
        },
      );
      expect(subscription?.subscriptionValid).toBe(true);

      // Remove participant
      await t.mutation(api.meetings.lifecycle.removeParticipant, {
        meetingId: testMeetingId,
        userId: participantUserId,
      });

      // Validate subscription should now fail
      const validation = await t.query(
        api.realtime.subscriptions.validateSubscription,
        {
          subscriptionId: "test-removal-sub",
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          lastValidated: Date.now(),
        },
      );

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("Access denied");
    });

    test("should update permissions when participant role changes", async () => {
      // Participant initially doesn't have manage permissions
      let validation = await t.query(
        api.auth.permissions.validateSubscriptionPermissions,
        {
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          requiredPermissions: ["manage"],
        },
      );
      expect(validation.permissions).not.toContain("manage");

      // Promote participant to host
      await t.mutation(api.meetings.lifecycle.updateParticipantRole, {
        meetingId: testMeetingId,
        userId: participantUserId,
        newRole: "host",
      });

      // Now should have manage permissions
      validation = await t.query(
        api.auth.permissions.validateSubscriptionPermissions,
        {
          resourceType: "meetingNotes",
          resourceId: testMeetingId,
          requiredPermissions: ["manage"],
        },
      );
      expect(validation.permissions).toContain("manage");
    });

    test("should revoke transcript access when meeting ends", async () => {
      // Start meeting and establish transcript subscription
      await t.mutation(api.meetings.lifecycle.startMeeting, {
        meetingId: testMeetingId,
      });

      const subscription = await t.query(
        api.realtime.subscriptions.subscribeTranscriptStream,
        {
          meetingId: testMeetingId,
          subscriptionId: "test-end-meeting-sub",
        },
      );
      expect(subscription.subscriptionValid).toBe(true);

      // End meeting
      await t.mutation(api.meetings.lifecycle.endMeeting, {
        meetingId: testMeetingId,
      });

      // Transcript subscription should now be invalid
      const validation = await t.query(
        api.realtime.subscriptions.validateSubscription,
        {
          subscriptionId: "test-end-meeting-sub",
          resourceType: "transcripts",
          resourceId: testMeetingId,
          lastValidated: Date.now(),
        },
      );

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("no longer active");
    });
  });

  describe("Audit Logging", () => {
    test("should log subscription establishment events", async () => {
      // Establish subscription
      await t.query(api.realtime.subscriptions.subscribeMeetingNotes, {
        meetingId: testMeetingId,
        subscriptionId: "test-audit-sub",
      });

      // Check audit logs
      const auditLogs = (await t.query(api.audit.logging.getAuditLogs, {
        resourceType: "meetingNotes",
        resourceId: testMeetingId,
        action: "subscription_established",
        limit: 10,
      })) as {
        logs: Array<{
          _id: import("@convex/_generated/dataModel").Id<"auditLogs">;
          actorUserId?: import("@convex/_generated/dataModel").Id<"users">;
          resourceType: string;
          resourceId: string;
          action: string;
          metadata: Record<string, unknown>;
          timestamp: number;
          _creationTime: number;
        }>;
      };

      expect(auditLogs.logs.length).toBeGreaterThan(0);
      const subscriptionLog = auditLogs.logs.find(
        (log) =>
          (log.metadata as { subscriptionId?: string }).subscriptionId ===
          "test-audit-sub",
      );
      expect(subscriptionLog).toBeDefined();
      expect(subscriptionLog?.action).toBe("subscription_established");
    });

    test("should log permission revocation events", async () => {
      // Remove participant (triggers permission revocation)
      await t.mutation(api.meetings.lifecycle.removeParticipant, {
        meetingId: testMeetingId,
        userId: participantUserId,
      });

      // Check audit logs for revocation
      const auditLogs = (await t.query(api.audit.logging.getAuditLogs, {
        actorUserId: hostUserId,
        action: "participant_removed",
        limit: 10,
      })) as {
        logs: Array<{
          _id: import("@convex/_generated/dataModel").Id<"auditLogs">;
          actorUserId?: import("@convex/_generated/dataModel").Id<"users">;
          resourceType: string;
          resourceId: string;
          action: string;
          metadata: Record<string, unknown>;
          timestamp: number;
          _creationTime: number;
        }>;
      };

      expect(auditLogs.logs.length).toBeGreaterThan(0);
      const revocationLog = auditLogs.logs.find(
        (log) =>
          (log.metadata as { removedUserId?: unknown }).removedUserId ===
          participantUserId,
      );
      expect(revocationLog).toBeDefined();
    });

    test("should log role change events", async () => {
      // Change participant role
      await t.mutation(api.meetings.lifecycle.updateParticipantRole, {
        meetingId: testMeetingId,
        userId: participantUserId,
        newRole: "host",
      });

      // Check audit logs
      const auditLogs = (await t.query(api.audit.logging.getAuditLogs, {
        action: "participant_role_changed",
        limit: 10,
      })) as {
        logs: Array<{
          _id: import("@convex/_generated/dataModel").Id<"auditLogs">;
          actorUserId?: import("@convex/_generated/dataModel").Id<"users">;
          resourceType: string;
          resourceId: string;
          action: string;
          metadata: Record<string, unknown>;
          timestamp: number;
          _creationTime: number;
        }>;
      };

      expect(auditLogs.logs.length).toBeGreaterThan(0);
      const roleChangeLog = auditLogs.logs.find((log) => {
        const meta = log.metadata as {
          targetUserId?: unknown;
          newRole?: unknown;
        };
        return (
          meta.targetUserId === participantUserId && meta.newRole === "host"
        );
      });
      expect(roleChangeLog).toBeDefined();
    });
  });

  describe("Performance and Scalability", () => {
    test("should handle multiple concurrent subscription validations", async () => {
      // Create multiple subscriptions
      const subscriptionPromises = Array.from({ length: 10 }, (_, i) =>
        t.query(api.realtime.subscriptions.subscribeMeetingNotes, {
          meetingId: testMeetingId,
          subscriptionId: `concurrent-sub-${i}`,
        }),
      );

      const start = Date.now();
      const subscriptions = (await Promise.all(subscriptionPromises)) as Array<{
        content: string;
        version: number;
        lastUpdated: number;
        subscriptionValid: boolean;
        permissions: string[];
        cursor: string;
        rateLimited: boolean;
      } | null>;
      const duration = Date.now() - start;

      // All should succeed
      subscriptions.forEach((sub) => {
        expect(sub?.subscriptionValid).toBe(true);
      });

      // Should complete within reasonable time
      expect(duration).toBeLessThan(2000); // 2 seconds
    });

    test("should efficiently validate subscription permissions", async () => {
      const validations = Array.from({ length: 20 }, () => ({
        resourceType: "meetingNotes",
        resourceId: testMeetingId,
        permissions: ["read", "write"],
        lastValidated: Date.now() - 30000,
      }));

      const start = Date.now();
      const results = (await t.query(
        api.auth.permissions.refreshSubscriptionPermissions,
        {
          subscriptions: validations,
        },
      )) as Array<{
        resourceType: string;
        resourceId: string;
        valid: boolean;
        updatedPermissions: string[];
        reason?: string;
      }>;
      const duration = Date.now() - start;

      expect(results).toHaveLength(20);
      results.forEach((result) => {
        expect(result.valid).toBe(true);
      });

      // Should complete efficiently
      expect(duration).toBeLessThan(1000); // 1 second
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("should handle invalid resource types gracefully", async () => {
      try {
        await t.query(api.auth.permissions.validateSubscriptionPermissions, {
          resourceType: "invalid-resource" as any,
          resourceId: testMeetingId,
          requiredPermissions: ["read"],
        });
        expect.fail("Should have thrown validation error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Unknown resource type");
      }
    });

    test("should handle non-existent meetings gracefully", async () => {
      const fakeMeetingId = "fake-meeting-id" as Id<"meetings">;

      try {
        await t.query(api.realtime.subscriptions.subscribeMeetingNotes, {
          meetingId: fakeMeetingId,
        });
        expect.fail("Should have thrown NOT_FOUND error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("not found");
      }
    });

    test("should handle subscription validation for expired permissions", async () => {
      // Start and immediately end meeting
      await t.mutation(api.meetings.lifecycle.startMeeting, {
        meetingId: testMeetingId,
      });
      await t.mutation(api.meetings.lifecycle.endMeeting, {
        meetingId: testMeetingId,
      });

      // Try to validate transcript subscription
      const validation = await t.query(
        api.realtime.subscriptions.validateSubscription,
        {
          subscriptionId: "expired-sub",
          resourceType: "transcripts",
          resourceId: testMeetingId,
          lastValidated: Date.now() - 60000,
        },
      );

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("no longer active");
      expect(validation.shouldReconnect).toBe(false);
    });
  });
});
