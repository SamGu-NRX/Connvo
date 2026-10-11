/**
 * Identity / tenancy reproduction tests.
 *
 * These tests assert the FIXED behavior. On the pre-fix baseline they fail,
 * reproducing the defects:
 *  - anonymous upsertUser provisioning (identity forgery),
 *  - client-supplied org role/org id being trusted (role forgery),
 *  - anonymous reads of audit logs (private read exposure),
 *  - deactivated accounts resolving through valid sessions.
 *
 * The "control" test passes before AND after the fix and pins the legitimate
 * flow that must keep working.
 */

import { api } from "@convex/_generated/api";
import { describe, expect, it, beforeEach } from "vitest";
import { getAuditLogs } from "../audit/logging";
import {
  createTestEnvironment,
  createTestUser,
} from "../../test/convex/helpers";

describe("Identity tenancy (verified sessions)", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  it("control: an authenticated caller can upsert their own user record", async () => {
    const subject = "real-new-user-subject";
    const authT = t.withIdentity({
      subject,
      email: "new@example.com",
      name: "New User",
      org_id: "org-1",
      org_role: "member",
    });

    const userId = await authT.mutation(api.users.mutations.upsertUser, {
      workosUserId: subject,
      email: "new@example.com",
      displayName: "New User",
      orgId: "org-1",
      orgRole: "member",
    });

    expect(userId).toBeDefined();
    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user?.workosUserId).toBe(subject);
  });

  it("rejects anonymous upsertUser instead of provisioning users for unauthenticated callers", async () => {
    await expect(
      t.mutation(api.users.mutations.upsertUser, {
        workosUserId: "attacker-subject",
        email: "attacker@example.com",
        displayName: "Attacker",
        orgId: "attacker-org",
        orgRole: "admin",
      }),
    ).rejects.toThrow(/authentication|unauthorized|identity/i);
  });

  it("does not trust client-supplied org role or org id", async () => {
    const subject = "victim-user-subject";
    // Identity carries NO org claims (org_id / org_role omitted).
    const authT = t.withIdentity({
      subject,
      email: "real@example.com",
      name: "Real User",
    });

    await authT.mutation(api.users.mutations.upsertUser, {
      workosUserId: subject,
      email: "real@example.com",
      displayName: "Real User",
      orgId: "attacker-org",
      orgRole: "admin",
    });

    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
        .unique(),
    );
    expect(user).toBeDefined();
    expect(user?.orgRole).not.toBe("admin");
    expect(user?.orgId ?? null).not.toBe("attacker-org");
  });

  it("registers audit log reads internal-only so anonymous clients cannot reach them", async () => {
    // Offline proof: convex-test does not enforce public/internal visibility,
    // and the committed _generated tree is stale, so we pin the SOURCE-level
    // registration. Production codegen derives the public api tree from this.
    expect((getAuditLogs as any).isInternal).toBe(true);
    expect((getAuditLogs as any).isQuery).toBe(true);
  });

  it("rejects deactivated users even with valid sessions", async () => {
    const subject = "deactivated-user-subject";
    const targetId = await createTestUser(t, {
      workosUserId: subject,
      isActive: false,
    });

    const authT = t.withIdentity({
      subject,
      email: "deactivated@example.com",
      name: "Deactivated User",
      org_id: "test-org",
      org_role: "member",
    });

    // getCurrentUser is the logged-out probe: it deliberately resolves to null
    // (the client shows a signed-out state) instead of throwing. The hard
    // boundary is requireIdentity, which every privileged function shares:
    // a guarded read must reject the deactivated session outright.
    expect(await authT.query(api.users.queries.getCurrentUser)).toBeNull();

    await expect(
      authT.query(api.profiles.queries.getProfileByUserIdPublic, {
        userId: targetId,
      }),
    ).rejects.toThrow(/deactivat|forbidden|permission/i);
  });
});
