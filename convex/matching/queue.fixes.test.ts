/**
 * Regression tests for convex/matching/queue.ts
 *
 * Pins the behavior documented in the queue.ts docstrings during the matching-module
 * documentation pass: entry validation and dedup rules, the FIFO position and wait-time
 * heuristic in getQueueStatus, cancel ownership and status handling, the unauthenticated
 * public surfaces (getActiveQueueEntries, updateQueueStatus), and cleanupExpiredEntries.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { UserIdentity } from "convex/server";
import { api, internal } from "@convex/_generated/api";
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

  const identity: Partial<UserIdentity> = {
    subject: options.workosUserId,
    tokenIdentifier: `test|${options.workosUserId}`,
    email: options.email,
    name: options.displayName,
    issuer: "https://example.com",
  };

  return { id, identity, auth: test.withIdentity(identity) };
}

async function seedQueueEntry(
  test: TestServer,
  opts: {
    userId: Id<"users">;
    createdAt?: number;
    status?: "waiting" | "matched" | "expired" | "cancelled";
    matchedWith?: Id<"users">;
    availableFrom?: number;
    availableTo?: number;
  },
): Promise<Id<"matchingQueue">> {
  const now = Date.now();
  return await test.run(async (ctx) => {
    return await ctx.db.insert("matchingQueue", {
      userId: opts.userId,
      availableFrom: opts.availableFrom ?? now - 60_000,
      availableTo: opts.availableTo ?? now + HOURS,
      constraints: { interests: ["technology"], roles: ["mentor"] },
      status: opts.status ?? "waiting",
      ...(opts.matchedWith ? { matchedWith: opts.matchedWith } : {}),
      createdAt: opts.createdAt ?? now,
      updatedAt: opts.createdAt ?? now,
    });
  });
}

describe("Matching queue regression", () => {
  let t: TestServer;
  let userA: UserContext;
  let userB: UserContext;

  beforeEach(async () => {
    t = createTestEnvironment();

    userA = await createUserContext(t, {
      workosUserId: "queue-regression-a",
      email: "a@example.com",
      displayName: "Queue Regression A",
    });
    userB = await createUserContext(t, {
      workosUserId: "queue-regression-b",
      email: "b@example.com",
      displayName: "Queue Regression B",
    });
  });

  describe("enterMatchingQueue validation", () => {
    it("rejects a window that starts in the past", async () => {
      const now = Date.now();
      await expect(
        userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now - 1000,
          availableTo: now + HOURS,
          constraints: { interests: ["ai"], roles: ["mentor"] },
        }),
      ).rejects.toThrow("Availability window cannot start in the past");
    });

    it("rejects an end time that is not after the start time", async () => {
      const now = Date.now();
      await expect(
        userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now + 60_000,
          availableTo: now + 60_000,
          constraints: { interests: ["ai"], roles: ["mentor"] },
        }),
      ).rejects.toThrow("Availability end time must be after start time");
    });

    it("requires at least one interest and one role", async () => {
      const now = Date.now();
      await expect(
        userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now + 60_000,
          availableTo: now + HOURS,
          constraints: { interests: [], roles: ["mentor"] },
        }),
      ).rejects.toThrow("At least one interest must be specified");

      await expect(
        userA.auth.mutation(api.matching.queue.enterMatchingQueue, {
          availableFrom: now + 60_000,
          availableTo: now + HOURS,
          constraints: { interests: ["ai"], roles: [] },
        }),
      ).rejects.toThrow("At least one role must be specified");
    });
  });

  describe("getQueueStatus math", () => {
    it("computes FIFO position and the two-minutes-per-position wait estimate", async () => {
      const now = Date.now();
      await seedQueueEntry(t, { userId: userB.id, createdAt: now - 2000 });
      const mine = await seedQueueEntry(t, { userId: userA.id, createdAt: now });

      const status = await userA.auth.query(api.matching.queue.getQueueStatus, {});
      expect(status?._id).toEqual(mine);
      expect(status?.status).toBe("waiting");
      expect(status?.queuePosition).toBe(2);
      expect(status?.estimatedWaitTime).toBe(240_000);
    });

    it("returns non-waiting entries without queue metadata", async () => {
      await seedQueueEntry(t, {
        userId: userA.id,
        status: "expired",
        createdAt: Date.now(),
        availableTo: Date.now() - 1000,
      });

      const status = await userA.auth.query(api.matching.queue.getQueueStatus, {});
      expect(status?.status).toBe("expired");
      expect(status?.queuePosition).toBeUndefined();
      expect(status?.estimatedWaitTime).toBeUndefined();
    });
  });

  describe("cancelQueueEntry", () => {
    it("refuses to cancel another user's entry by id", async () => {
      const entryId = await seedQueueEntry(t, { userId: userB.id, createdAt: Date.now() });

      await expect(
        userA.auth.mutation(api.matching.queue.cancelQueueEntry, { queueId: entryId }),
      ).rejects.toThrow("Queue entry not found or access denied");
    });

    it("cancels the caller's waiting entry when no queueId is given", async () => {
      await seedQueueEntry(t, { userId: userA.id, createdAt: Date.now() });

      await userA.auth.mutation(api.matching.queue.cancelQueueEntry, {});

      const status = await userA.auth.query(api.matching.queue.getQueueStatus, {});
      expect(status).toBeNull();
    });

    it("cancels an already-matched entry via explicit queueId (no status guard)", async () => {
      const entryId = await seedQueueEntry(t, {
        userId: userA.id,
        status: "matched",
        matchedWith: userB.id,
        createdAt: Date.now(),
      });

      await userA.auth.mutation(api.matching.queue.cancelQueueEntry, { queueId: entryId });

      const doc = await t.run(async (ctx) => ctx.db.get(entryId));
      expect(doc?.status).toBe("cancelled");
    });
  });

  describe("unauthenticated public surfaces (documented exposure)", () => {
    it("getActiveQueueEntries is callable without authentication", async () => {
      await seedQueueEntry(t, { userId: userA.id, createdAt: Date.now() });

      const entries = await t.query(api.matching.queue.getActiveQueueEntries, {});

      expect(entries.length).toBe(1);
      expect(entries[0].userId).toEqual(userA.id);
    });

    it("updateQueueStatus is callable without authentication on any entry", async () => {
      const entryId = await seedQueueEntry(t, { userId: userB.id, createdAt: Date.now() });

      await t.mutation(api.matching.queue.updateQueueStatus, {
        queueId: entryId,
        status: "cancelled",
      });

      const doc = await t.run(async (ctx) => ctx.db.get(entryId));
      expect(doc?.status).toBe("cancelled");

      const logs = await t.run(async (ctx) =>
        ctx.db
          .query("auditLogs")
          .withIndex("by_resource", (q) =>
            q.eq("resourceType", "matchingQueue").eq("resourceId", entryId),
          )
          .collect(),
      );
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe("status_updated");
    });

    it("updateQueueStatus omits matchedWith from the audit log when not provided", async () => {
      const entryId = await seedQueueEntry(t, {
        userId: userB.id,
        status: "matched",
        matchedWith: userA.id,
        createdAt: Date.now(),
      });

      await t.mutation(api.matching.queue.updateQueueStatus, {
        queueId: entryId,
        status: "waiting",
      });

      const logs = await t.run(async (ctx) =>
        ctx.db
          .query("auditLogs")
          .withIndex("by_resource", (q) =>
            q.eq("resourceType", "matchingQueue").eq("resourceId", entryId),
          )
          .collect(),
      );
      expect(logs[0].metadata).toMatchObject({
        oldStatus: "matched",
        newStatus: "waiting",
        matchedWith: "",
      });
    });
  });

  describe("cleanupExpiredEntries", () => {
    it("expires only stale waiting entries and reports the count", async () => {
      const stale = await seedQueueEntry(t, {
        userId: userA.id,
        createdAt: Date.now(),
        availableTo: Date.now() - 1000,
      });
      const fresh = await seedQueueEntry(t, { userId: userB.id, createdAt: Date.now() });

      const result = await t.mutation(internal.matching.queue.cleanupExpiredEntries, {});
      expect(result.expiredCount).toBe(1);

      const staleDoc = await t.run(async (ctx) => ctx.db.get(stale));
      expect(staleDoc?.status).toBe("expired");
      const freshDoc = await t.run(async (ctx) => ctx.db.get(fresh));
      expect(freshDoc?.status).toBe("waiting");
    });
  });
});
