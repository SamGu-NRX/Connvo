/**
 * Deactivation lifecycle tests.
 *
 * These tests assert the FIXED behavior. On the pre-fix baseline they fail,
 * reproducing the defects:
 *  - deactivation leaving waiting matching-queue rows live (the user keeps
 *    being paired),
 *  - deactivation leaving future scheduled meetings orphaned,
 *  - no audit trail for the deactivation.
 *
 * The pairing-path guard is proven end-to-end: even when a stale waiting row
 * survives deactivation, the matching selection skips deactivated users so
 * they can never be paired.
 */

import { api, internal } from "@convex/_generated/api";
import { beforeEach, describe, expect, it } from "vitest";
import type { UserIdentity } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";

const HOURS = 60 * 60 * 1000;

type TestServer = ReturnType<typeof createTestEnvironment>;
type AuthedTestServer = ReturnType<TestServer["withIdentity"]>;

interface UserContext {
  id: Id<"users">;
  identity: Partial<UserIdentity>;
  auth: AuthedTestServer;
}

async function createUserContext(
  test: TestServer,
  options: {
    workosUserId: string;
    email: string;
    displayName: string;
    interests: string[];
  },
): Promise<UserContext> {
  const now = Date.now();
  const id = await test.run(async (ctx) => {
    return await ctx.db.insert("users", {
      workosUserId: options.workosUserId,
      email: options.email,
      displayName: options.displayName,
      isActive: true,
      lastSeenAt: now,
      onboardingComplete: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  await test.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: id,
      displayName: options.displayName,
      bio: "Test profile",
      goals: "Connect with peers",
      languages: ["English"],
      experience: "senior",
      createdAt: now,
      updatedAt: now,
    });

    for (const interest of options.interests) {
      await ctx.db.insert("userInterests", {
        userId: id,
        interestKey: interest,
        createdAt: now,
      });
    }
  });

  const identity: Partial<UserIdentity> = {
    subject: options.workosUserId,
    tokenIdentifier: `test|${options.workosUserId}`,
    email: options.email,
    name: options.displayName,
    issuer: "https://example.com",
  };

  return { id, identity, auth: test.withIdentity(identity) };
}

describe("Deactivation lifecycle", () => {
  let t: TestServer;
  let userA: UserContext;
  let userB: UserContext;

  beforeEach(async () => {
    t = createTestEnvironment();

    userA = await createUserContext(t, {
      workosUserId: "deactivating-user-1",
      email: "user1@example.com",
      displayName: "Test User 1",
      interests: ["technology", "ai", "startups"],
    });

    userB = await createUserContext(t, {
      workosUserId: "deactivating-user-2",
      email: "user2@example.com",
      displayName: "Test User 2",
      interests: ["technology", "ml", "business"],
    });
  });

  it("cancels the deactivated user's waiting matching-queue entries", async () => {
    const now = Date.now();
    await userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
      availableFrom: now + 60_000,
      availableTo: now + HOURS,
      constraints: {
        interests: ["technology", "ai"],
        roles: ["mentor"],
        orgConstraints: "any",
      },
    });

    await userA.auth.mutation(api.users.mutations.deactivateUser, {
      userId: userA.id,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("matchingQueue")
        .withIndex("by_user", (q) => q.eq("userId", userA.id))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("cancelled");
  });

  it("cancels the deactivated user's future scheduled meetings and preserves history", async () => {
    const now = Date.now();
    const futureMeetingId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        organizerId: userA.id,
        title: "Future 1:1",
        scheduledAt: now + HOURS,
        duration: 1800,
        state: "scheduled" as const,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const concludedMeetingId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        organizerId: userA.id,
        title: "Past 1:1",
        scheduledAt: now - 2 * HOURS,
        duration: 1800,
        state: "concluded" as const,
        createdAt: now - 3 * HOURS,
        updatedAt: now - 2 * HOURS,
      }),
    );

    await userA.auth.mutation(api.users.mutations.deactivateUser, {
      userId: userA.id,
    });

    const futureMeeting = await t.run(async (ctx) =>
      ctx.db.get(futureMeetingId),
    );
    expect(futureMeeting?.state).toBe("cancelled");

    // History is preserved: concluded meetings must not be touched.
    const concludedMeeting = await t.run(async (ctx) =>
      ctx.db.get(concludedMeetingId),
    );
    expect(concludedMeeting?.state).toBe("concluded");
  });

  it("leaves an audit entry for the deactivation", async () => {
    await userA.auth.mutation(api.users.mutations.deactivateUser, {
      userId: userA.id,
    });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_actor", (q) => q.eq("actorUserId", userA.id))
        .filter((q) => q.eq(q.field("action"), "user_deactivated"))
        .collect(),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].resourceType).toBe("user");
  });

  it("deactivated user cannot be re-paired even if a stale waiting queue row exists", async () => {
    const now = Date.now();
    await userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
      availableFrom: now + 60_000,
      availableTo: now + HOURS,
      constraints: {
        interests: ["technology", "ai"],
        roles: ["mentor"],
        orgConstraints: "any",
      },
    });
    await userB.auth.mutation(api.matching.queue.enterMatchingQueue, {
      availableFrom: now + 30_000,
      availableTo: now + HOURS,
      constraints: {
        interests: ["technology", "ml"],
        roles: ["mentee"],
      },
    });

    await userA.auth.mutation(api.users.mutations.deactivateUser, {
      userId: userA.id,
    });

    // Simulate a stale row that survived deactivation: user A is deactivated
    // but has a waiting queue row again.
    await t.run(async (ctx) => {
      await ctx.db.insert("matchingQueue", {
        userId: userA.id,
        availableFrom: now + 60_000,
        availableTo: now + HOURS,
        constraints: {
          interests: ["technology", "ai"],
          roles: ["mentor"],
          orgConstraints: "any",
        },
        status: "waiting" as const,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Pairing selection must skip the deactivated user's stale row.
    const shardEntries = await t.query(
      internal.matching.engine.getShardQueueEntries,
      { shard: 0, shardCount: 1, limit: 50 },
    );
    expect(
      shardEntries.filter((entry) => entry.userId === userA.id),
    ).toHaveLength(0);
    expect(
      shardEntries.filter((entry) => entry.userId === userB.id),
    ).toHaveLength(1);

    // End-to-end: the matching cycle must not pair the deactivated user.
    const result = await t.action(internal.matching.engine.runMatchingCycle, {
      shardCount: 1,
      minScore: 0.2,
      maxMatches: 10,
    });
    expect(result.totalMatches).toBe(0);

    const userBRows = await t.run(async (ctx) =>
      ctx.db
        .query("matchingQueue")
        .withIndex("by_user", (q) => q.eq("userId", userB.id))
        .collect(),
    );
    expect(userBRows[0].status).toBe("waiting");
  });
});
