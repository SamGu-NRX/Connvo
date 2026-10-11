/**
 * Legacy organization/role claim quarantine tests.
 *
 * Covers the legacy-claims slice:
 * - requireIdentity trusts orgId/orgRole from the users record ONLY when the
 *   record carries verified provenance (orgClaimsVerified === true). A legacy
 *   forged admin record plus a current token WITHOUT organization claims must
 *   gain no admin trust.
 * - upsertUser writes verified provenance when the verified JWT carries org
 *   claims, and CLEARS/quarantines stored org values when it does not
 *   (forged-record, valid-claim, and removal transitions, all exercised
 *   through registered functions).
 * - Client-supplied org arguments can never create provenance.
 *
 * Red-first: the forged-record and removal assertions fail on the pre-fix
 * baseline, where requireIdentity read orgId/orgRole straight from the user
 * row regardless of provenance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  cleanupTestMocks,
  createCompleteTestUser,
  createTestEnvironment,
  createTestMeeting,
  resetAllMocks,
  setupTestMocks,
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

interface TestUser {
  userId: Id<"users">;
  workosUserId: string;
}

describe("Legacy organization/role claim quarantine", () => {
  let t: TestServer;
  let target: TestUser;
  let targetInsightId: Id<"insights">;

  beforeEach(async () => {
    t = createTestEnvironment();
    setupTestMocks();
    resetAllMocks();

    // A legitimate user in a different org, with an insight a forged admin
    // would be able to touch if unproven admin values granted trust.
    target = await createCompleteTestUser(t, {
      email: "target@example.com",
      displayName: "Target User",
      orgId: "target-org",
      orgRole: "member",
    });
    const meetingId = await createTestMeeting(t, target.userId, {
      title: "Target Meeting",
    });
    targetInsightId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("insights", {
        userId: target.userId,
        meetingId,
        summary: "Target insight",
        actionItems: [],
        recommendations: [
          { type: "tip", content: "content", confidence: 0.9 },
        ],
        links: [],
        createdAt: now,
      });
    });
  });

  afterEach(() => {
    cleanupTestMocks();
  });

  /** A legacy forged admin record: org values present, NO verified provenance. */
  async function forgeLegacyAdmin(workosUserId: string): Promise<Id<"users">> {
    return await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("users", {
        workosUserId,
        email: `${workosUserId}@example.com`,
        displayName: "Forged Admin",
        orgId: "forged-org",
        orgRole: "admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  /** Token WITHOUT organization claims (the forged admin's current session). */
  function claimsFreeAuth(workosUserId: string) {
    return t.withIdentity({
      subject: workosUserId,
      tokenIdentifier: `test|${workosUserId}`,
      email: `${workosUserId}@example.com`,
    });
  }

  it("a legacy forged admin record gains no admin trust from a claims-free token", async () => {
    await forgeLegacyAdmin("legacy-forged-admin");

    // Admin branch of profile visibility must not fire.
    await expect(
      claimsFreeAuth("legacy-forged-admin").query(
        api.profiles.queries.getProfileByUserIdPublic,
        { userId: target.userId },
      ),
    ).rejects.toThrow("Profile is not visible to this caller");

    // Ownership-or-admin gate on a registered insights query must not let
    // the forged record administer someone else's insight.
    await expect(
      claimsFreeAuth("legacy-forged-admin").query(
        api.insights.queries.getInsightById,
        { insightId: targetInsightId },
      ),
    ).rejects.toThrow();
  });

  it("a verified-claims token provisions provenance and grants admin trust", async () => {
    const authedT = t.withIdentity({
      subject: "claims-admin-1",
      tokenIdentifier: "test|claims-admin-1",
      email: "claims-admin@example.com",
      org_id: "real-org",
      org_role: "admin",
    });

    const userId = await authedT.mutation(api.users.mutations.upsertUser, {
      workosUserId: "claims-admin-1",
      email: "client-arg@example.com",
      orgId: "client-org",
      orgRole: "admin",
    });

    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user?.orgId).toBe("real-org");
    expect(user?.orgRole).toBe("admin");
    expect(user?.orgClaimsVerified).toBe(true);

    // Admin trust now flows through registered functions.
    const profile = await authedT.query(
      api.profiles.queries.getProfileByUserIdPublic,
      { userId: target.userId },
    );
    expect(profile).not.toBeNull();
    const insight = await authedT.query(api.insights.queries.getInsightById, {
      insightId: targetInsightId,
    });
    expect(insight?.summary).toBe("Target insight");
  });

  it("a claims-free re-login clears previously verified org claims (removal transition)", async () => {
    // First login: verified org claims present.
    const verifiedT = t.withIdentity({
      subject: "transient-admin-1",
      tokenIdentifier: "test|transient-admin-1",
      email: "transient@example.com",
      org_id: "real-org",
      org_role: "admin",
    });
    const userId = await verifiedT.mutation(api.users.mutations.upsertUser, {
      workosUserId: "transient-admin-1",
      email: "transient@example.com",
    });
    expect(
      (await t.run(async (ctx) => ctx.db.get(userId)))?.orgClaimsVerified,
    ).toBe(true);

    // Re-login: the current token carries NO organization claims. The stored
    // org values are unproven now — they are cleared and lose provenance.
    const removedT = claimsFreeAuth("transient-admin-1");
    await removedT.mutation(api.users.mutations.upsertUser, {
      workosUserId: "transient-admin-1",
      email: "transient@example.com",
    });

    const after = await t.run(async (ctx) => ctx.db.get(userId));
    expect(after?.orgId).toBeUndefined();
    expect(after?.orgRole).toBeUndefined();
    expect(after?.orgClaimsVerified).toBe(false);

    // And the admin trust is gone from registered functions.
    await expect(
      removedT.query(api.profiles.queries.getProfileByUserIdPublic, {
        userId: target.userId,
      }),
    ).rejects.toThrow("Profile is not visible to this caller");
    await expect(
      removedT.query(api.insights.queries.getInsightById, {
        insightId: targetInsightId,
      }),
    ).rejects.toThrow();
  });

  it("client-supplied org arguments never create provenance (control)", async () => {
    const authedT = claimsFreeAuth("claims-free-forger");
    const userId = await authedT.mutation(api.users.mutations.upsertUser, {
      workosUserId: "claims-free-forger",
      email: "forger@example.com",
      orgId: "client-org",
      orgRole: "admin",
    });

    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user?.orgId).toBeUndefined();
    expect(user?.orgRole).toBeUndefined();
    expect(user?.orgClaimsVerified).toBe(false);

    await expect(
      authedT.query(api.profiles.queries.getProfileByUserIdPublic, {
        userId: target.userId,
      }),
    ).rejects.toThrow("Profile is not visible to this caller");
  });
});
