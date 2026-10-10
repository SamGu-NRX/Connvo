/**
 * Identity Binding and Tenancy Tests
 *
 * Covers the identity slice:
 * - requireIdentity rejects deactivated accounts and keeps the bootstrap seam
 *   for unknown subjects
 * - upsertUser requires a verified identity and derives fields server-side
 *   (org fields never come from client args; isActive never re-activated)
 * - internalized functions are invoked via the internal tree
 * - getProfileByUserIdPublic is scoped by org / shared meeting / admin
 * - stream participant tokens require meeting membership
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "convex/server";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  createTestEnvironment,
  createCompleteTestUser,
  createTestMeeting,
  addMeetingParticipant,
  resetAllMocks,
  setupTestMocks,
  cleanupTestMocks,
} from "../../test/convex/helpers";

// The stream token path minting is mocked: no GetStream SDK or network is
// touched. Everything else in the module stays real.
vi.mock("@convex/lib/getstreamServer", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@convex/lib/getstreamServer")
  >();
  return {
    ...actual,
    createStreamToken: vi.fn(() => "test-stream-token"),
  };
});

type TestServer = ReturnType<typeof createTestEnvironment>;
type AuthedTestServer = ReturnType<TestServer["withIdentity"]>;

interface TestUser {
  userId: Id<"users">;
  workosUserId: string;
}

function auth(server: TestServer, user: TestUser, extra: Partial<UserIdentity> = {}): AuthedTestServer {
  return server.withIdentity({
    subject: user.workosUserId,
    tokenIdentifier: `test|${user.workosUserId}`,
    ...extra,
  });
}

describe("Identity binding and tenancy", () => {
  let t: TestServer;

  beforeEach(() => {
    t = createTestEnvironment();
    setupTestMocks();
    resetAllMocks();
  });

  afterEach(() => {
    cleanupTestMocks();
  });

  describe("requireIdentity deactivation enforcement", () => {
    it("accepts an active user", async () => {
      const { userId, workosUserId } = await createCompleteTestUser(t, {
        email: "active@example.com",
        displayName: "Active User",
        orgId: "test-org",
        orgRole: "member",
      });

      const authedT = auth(t, { userId, workosUserId }, { email: "active@example.com" });
      const profile = await authedT.query(
        api.profiles.queries.getProfileByUserIdPublic,
        { userId },
      );

      expect(profile).not.toBeNull();
      expect(profile?.userId).toBe(userId);
    });

    it("rejects a deactivated user with Account deactivated", async () => {
      const { userId, workosUserId } = await createCompleteTestUser(t, {
        email: "deactivated@example.com",
        displayName: "Deactivated User",
        orgId: "test-org",
        orgRole: "member",
        isActive: false,
      });

      const authedT = auth(t, { userId, workosUserId }, { email: "deactivated@example.com" });
      await expect(
        authedT.query(api.profiles.queries.getProfileByUserIdPublic, { userId }),
      ).rejects.toThrow("Account deactivated");
    });

    it("still reports unknown subjects as unprovisioned (bootstrap seam untouched)", async () => {
      const authedT = t.withIdentity({
        subject: "no-such-workos-user",
        tokenIdentifier: "test|no-such-workos-user",
        email: "ghost@example.com",
      });

      await expect(
        authedT.query(api.profiles.queries.getProfileByUserIdPublic, {
          userId: await t.run(async (ctx) => {
            const now = Date.now();
            return await ctx.db.insert("users", {
              workosUserId: "someone-else",
              email: "someone@example.com",
              displayName: "Someone",
              isActive: true,
              createdAt: now,
              updatedAt: now,
            });
          }),
        }),
      ).rejects.toThrow("User not provisioned");
    });
  });

  describe("upsertUser verified identity", () => {
    const upsertArgs = (overrides: Record<string, unknown> = {}) => ({
      workosUserId: "jwt-user-1",
      email: "client@example.com",
      displayName: "Client Name",
      orgId: "client-org",
      orgRole: "admin",
      ...overrides,
    });

    it("rejects anonymous calls", async () => {
      await expect(
        t.mutation(api.users.mutations.upsertUser, upsertArgs()),
      ).rejects.toThrow("Authentication required");
    });

    it("rejects a WorkOS ID mismatch with the verified subject", async () => {
      const authedT = t.withIdentity({
        subject: "subject-a",
        tokenIdentifier: "test|subject-a",
        email: "a@example.com",
      });

      await expect(
        authedT.mutation(
          api.users.mutations.upsertUser,
          upsertArgs({ workosUserId: "subject-b" }),
        ),
      ).rejects.toThrow("Cannot create user for different WorkOS ID");
    });

    it("derives fields server-side, ignoring injected org claims", async () => {
      const authedT = t.withIdentity({
        subject: "jwt-user-1",
        tokenIdentifier: "test|jwt-user-1",
        email: "jwt@example.com",
        name: "JWT Name",
        org_id: "jwt-org",
        org_role: "member",
      });

      const userId = await authedT.mutation(
        api.users.mutations.upsertUser,
        upsertArgs(),
      );

      const user = await t.run(async (ctx) => ctx.db.get(userId));
      // Derived from verified JWT claims...
      expect(user?.email).toBe("jwt@example.com");
      expect(user?.displayName).toBe("JWT Name");
      expect(user?.orgId).toBe("jwt-org");
      expect(user?.orgRole).toBe("member");
      // ...never from client args (client claimed admin/client-org)
      expect(user?.orgId).not.toBe("client-org");
      expect(user?.orgRole).not.toBe("admin");
      expect(user?.isActive).toBe(true);
    });

    it("falls back to args only when the JWT lacks claims", async () => {
      const authedT = t.withIdentity({
        subject: "jwt-user-2",
        tokenIdentifier: "test|jwt-user-2",
      });

      const userId = await authedT.mutation(
        api.users.mutations.upsertUser,
        upsertArgs({ workosUserId: "jwt-user-2" }),
      );

      const user = await t.run(async (ctx) => ctx.db.get(userId));
      expect(user?.email).toBe("client@example.com");
      expect(user?.orgId).toBeUndefined();
      expect(user?.orgRole).toBeUndefined();
    });

    it("leaves an existing INACTIVE user deactivated and never takes org fields from client args", async () => {
      const { userId, workosUserId } = await createCompleteTestUser(t, {
        workosUserId: "inactive-user-1",
        email: "old@example.com",
        displayName: "Inactive User",
        orgId: "existing-org",
        orgRole: "member",
        isActive: false,
      });

      // Re-login with a fresh token: no org claims on the JWT, new client
      // args trying to smuggle org fields and a new email.
      const authedT = t.withIdentity({
        subject: workosUserId,
        tokenIdentifier: `test|${workosUserId}`,
        email: "fresh@example.com",
      });

      const upsertedId = await authedT.mutation(
        api.users.mutations.upsertUser,
        upsertArgs({ workosUserId, email: "fresh@example.com" }),
      );

      expect(upsertedId).toBe(userId);
      const user = await t.run(async (ctx) => ctx.db.get(userId));
      // The update branch ran (email refreshed) but never re-activated...
      expect(user?.email).toBe("fresh@example.com");
      expect(user?.isActive).toBe(false);
      // ...and org fields stayed at existing values (JWT had no org claims).
      expect(user?.orgId).toBe("existing-org");
      expect(user?.orgRole).toBe("member");
    });
  });

  describe("internalized functions", () => {
    it("exposes audit logs only through the internal tree", async () => {
      await t.mutation(internal.audit.logging.createAuditLog, {
        resourceType: "user",
        resourceId: "identity-test-resource",
        action: "identity_test",
        category: "auth",
        success: true,
      });

      const page = await t.query(internal.audit.logging.getAuditLogs, {
        resourceType: "user",
        resourceId: "identity-test-resource",
        limit: 10,
      });

      expect(page.logs.length).toBeGreaterThanOrEqual(1);
      expect(page.logs[0].action).toBe("identity_test");
    });

    it("cleanupOldAuditLogs deletes only logs past the cutoff", async () => {
      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.insert("auditLogs", {
          resourceType: "user",
          resourceId: "old",
          action: "old_event",
          metadata: {},
          timestamp: now - 2 * 60 * 1000,
        });
        await ctx.db.insert("auditLogs", {
          resourceType: "user",
          resourceId: "fresh",
          action: "fresh_event",
          metadata: {},
          timestamp: now,
        });
      });

      const result = await t.mutation(internal.audit.logging.cleanupOldAuditLogs, {
        olderThanMs: 60 * 1000,
      });
      expect(result.deleted).toBe(1);

      const page = await t.query(internal.audit.logging.getAuditLogs, {
        limit: 10,
      });
      expect(page.logs).toHaveLength(1);
      expect(page.logs[0].action).toBe("fresh_event");
    });
  });

  describe("getProfileByUserIdPublic scoping", () => {
    let target: TestUser;
    let stranger: TestUser;
    let coparticipant: TestUser;
    let sameOrgUser: TestUser;
    let admin: TestUser;
    let sharedMeetingId: Id<"meetings">;

    beforeEach(async () => {
      target = await createCompleteTestUser(
        t,
        {
          email: "target@example.com",
          displayName: "Target User",
          orgId: "target-org",
          orgRole: "member",
        },
        { linkedinUrl: "https://linkedin.com/in/target" },
      );

      stranger = await createCompleteTestUser(t, {
        email: "stranger@example.com",
        displayName: "Stranger",
        orgId: "stranger-org",
        orgRole: "member",
      });

      coparticipant = await createCompleteTestUser(t, {
        email: "coparticipant@example.com",
        displayName: "Co Participant",
        orgId: "co-org",
        orgRole: "member",
      });

      sameOrgUser = await createCompleteTestUser(t, {
        email: "sameorg@example.com",
        displayName: "Same Org User",
        orgId: "target-org",
        orgRole: "member",
      });

      admin = await createCompleteTestUser(t, {
        email: "admin@example.com",
        displayName: "Admin User",
        orgId: "admin-org",
        orgRole: "admin",
      });

      sharedMeetingId = await createTestMeeting(t, target.userId, {
        title: "Shared Meeting",
      });
      await addMeetingParticipant(t, sharedMeetingId, target.userId, "host");
      await addMeetingParticipant(
        t,
        sharedMeetingId,
        coparticipant.userId,
        "participant",
      );
    });

    it("rejects a stranger with no shared meeting or org", async () => {
      const authedT = auth(t, stranger, { email: "stranger@example.com" });
      await expect(
        authedT.query(api.profiles.queries.getProfileByUserIdPublic, {
          userId: target.userId,
        }),
      ).rejects.toThrow("Profile is not visible to this caller");
    });

    it("allows a co-participant on a shared meeting", async () => {
      const authedT = auth(t, coparticipant, { email: "coparticipant@example.com" });
      const profile = await authedT.query(
        api.profiles.queries.getProfileByUserIdPublic,
        { userId: target.userId },
      );
      expect(profile).not.toBeNull();
      expect(profile?.displayName).toBe("Target User");
    });

    it("allows a same-org caller", async () => {
      const authedT = auth(t, sameOrgUser, { email: "sameorg@example.com" });
      const profile = await authedT.query(
        api.profiles.queries.getProfileByUserIdPublic,
        { userId: target.userId },
      );
      expect(profile).not.toBeNull();
    });

    it("allows an org admin", async () => {
      const authedT = auth(t, admin, { email: "admin@example.com" });
      const profile = await authedT.query(
        api.profiles.queries.getProfileByUserIdPublic,
        { userId: target.userId },
      );
      expect(profile).not.toBeNull();
    });

    it("allows the target to view their own profile", async () => {
      const authedT = auth(t, target, { email: "target@example.com" });
      const profile = await authedT.query(
        api.profiles.queries.getProfileByUserIdPublic,
        { userId: target.userId },
      );
      expect(profile).not.toBeNull();
    });

    it("never returns age, gender, or linkedinUrl", async () => {
      for (const caller of [coparticipant, sameOrgUser, admin, target]) {
        const authedT = t.withIdentity({
          subject: caller.workosUserId,
          tokenIdentifier: `test|${caller.workosUserId}`,
        });
        const profile = await authedT.query(
          api.profiles.queries.getProfileByUserIdPublic,
          { userId: target.userId },
        );
        expect(profile).not.toBeNull();
        expect("age" in (profile as object)).toBe(false);
        expect("gender" in (profile as object)).toBe(false);
        expect("linkedinUrl" in (profile as object)).toBe(false);
      }
    });
  });

  describe("stream participant token gating", () => {
    it("rejects an authenticated non-participant", async () => {
      const organizer = await createCompleteTestUser(t, {
        email: "organizer@example.com",
        displayName: "Organizer",
      });
      const caller = await createCompleteTestUser(t, {
        email: "caller@example.com",
        displayName: "Caller",
      });
      const meetingId = await createTestMeeting(t, organizer.userId, {
        title: "No Stream Room",
      });

      const authedT = auth(t, caller, { email: "caller@example.com" });
      await expect(
        authedT.action(
          api.meetings.stream.index.generateParticipantTokenPublic,
          { meetingId },
        ),
      ).rejects.toThrow("Access denied: Not a meeting participant");
    });

    it("rejects a participant of a terminal meeting", async () => {
      const organizer = await createCompleteTestUser(t, {
        email: "organizer2@example.com",
        displayName: "Organizer 2",
      });
      const caller = await createCompleteTestUser(t, {
        email: "caller2@example.com",
        displayName: "Caller 2",
      });
      const meetingId = await createTestMeeting(t, organizer.userId, {
        title: "Concluded Meeting",
        state: "concluded",
      });
      await addMeetingParticipant(t, meetingId, caller.userId, "participant");

      const authedT = auth(t, caller, { email: "caller2@example.com" });
      await expect(
        authedT.action(
          api.meetings.stream.index.generateParticipantTokenPublic,
          { meetingId },
        ),
      ).rejects.toThrow("concluded or cancelled");
    });

    it("mints a token for a meeting participant", async () => {
      const organizer = await createCompleteTestUser(t, {
        email: "organizer3@example.com",
        displayName: "Organizer 3",
      });
      const caller = await createCompleteTestUser(t, {
        email: "caller3@example.com",
        displayName: "Caller 3",
      });

      const meetingId = await t.run(async (ctx) => {
        const now = Date.now();
        return await ctx.db.insert("meetings", {
          organizerId: organizer.userId,
          title: "Stream Meeting",
          state: "active",
          streamRoomId: "room-identity-test",
          createdAt: now,
          updatedAt: now,
        });
      });
      await addMeetingParticipant(t, meetingId, caller.userId, "participant");

      const authedT = auth(t, caller, { email: "caller3@example.com" });
      const result = await authedT.action(
        api.meetings.stream.index.generateParticipantTokenPublic,
        { meetingId },
      );

      expect(result.success).toBe(true);
      expect(result.token).toBe("test-stream-token");
      expect(result.userId).toBe(caller.workosUserId);
    });
  });
});
