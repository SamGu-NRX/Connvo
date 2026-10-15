import { describe, expect, it } from "vitest";
import { internal, api } from "@convex/_generated/api";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;

async function person(t: TestServer, name: string) {
  const userId = await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      workosUserId: name,
      email: `${name.toLowerCase()}@example.com`,
      displayName: name,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  return { id: userId, auth: t.withIdentity({ subject: name }) };
}

async function meetingBetween(
  t: TestServer,
  hostId: string,
  guestId: string | null,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const meetingId = await ctx.db.insert("meetings", {
      organizerId: hostId as never,
      title: "Coffee chat",
      state: "concluded",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: hostId as never,
      role: "host",
      presence: "left",
      createdAt: now,
    });
    if (guestId) {
      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId: guestId as never,
        role: "participant",
        presence: "left",
        createdAt: now,
      });
    }
    return meetingId as unknown as string;
  });
}

describe("blockUser", () => {
  it("records the signed-in user as the blocker, whatever the caller sends", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");

    await alice.auth.mutation(api.profiles.moderation.blockUser, {
      blockedId: bob.id as never,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("blocks").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      blockerId: alice.id,
      blockedId: bob.id,
    });
  });

  it("is idempotent and cannot target yourself or a stranger", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");

    await alice.auth.mutation(api.profiles.moderation.blockUser, {
      blockedId: bob.id as never,
    });
    await alice.auth.mutation(api.profiles.moderation.blockUser, {
      blockedId: bob.id as never,
    });
    expect(await t.run(async (ctx) => ctx.db.query("blocks").collect())).toHaveLength(1);

    await expect(
      alice.auth.mutation(api.profiles.moderation.blockUser, {
        blockedId: alice.id as never,
      }),
    ).rejects.toThrow(/yourself/);

    await expect(
      alice.auth.mutation(api.profiles.moderation.blockUser, {
        blockedId: "jsm0new9q6v4c5kw3sy4qj4qj4qj4qj4" as never,
      }),
    ).rejects.toThrow();
  });

  it("isBlockedEither is true in both directions and false for strangers", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");
    const carol = await person(t, "Carol");

    await bob.auth.mutation(api.profiles.moderation.blockUser, {
      blockedId: alice.id as never,
    });

    const blocked = await t.run(async (ctx) => {
      // Bob blocked Alice: true for both orders.
      const ab = await ctx.runQuery(internal.profiles.moderation.isBlockedEither, {
        a: alice.id as never,
        b: bob.id as never,
      });
      const ba = await ctx.runQuery(internal.profiles.moderation.isBlockedEither, {
        a: bob.id as never,
        b: alice.id as never,
      });
      // Carol is out of the pair.
      const ac = await ctx.runQuery(internal.profiles.moderation.isBlockedEither, {
        a: alice.id as never,
        b: carol.id as never,
      });
      return { ab, ba, ac };
    });
    expect(blocked).toEqual({ ab: true, ba: true, ac: false });
  });
});

describe("reportUser", () => {
  it("records the signed-in user as the reporter and keeps the reason", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");

    await alice.auth.mutation(api.profiles.moderation.reportUser, {
      reportedId: bob.id as never,
      reason: "Repeated harassment",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("reports").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporterId: alice.id,
      reportedId: bob.id,
      reason: "Repeated harassment",
    });
  });

  it("only accepts a meetingId the reporter took part in", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");
    const carol = await person(t, "Carol");

    const shared = await meetingBetween(t, alice.id, bob.id);
    const strangers = await meetingBetween(t, alice.id, carol.id);

    // Alice met Bob; this attaches cleanly.
    await alice.auth.mutation(api.profiles.moderation.reportUser, {
      reportedId: bob.id as never,
      meetingId: shared as never,
      reason: "No-show",
    });

    // Carol was never in Alice-and-Bob's meeting: refused.
    await expect(
      carol.auth.mutation(api.profiles.moderation.reportUser, {
        reportedId: bob.id as never,
        meetingId: shared as never,
        reason: "No-show",
      }),
    ).rejects.toThrow(/took part/);

    // Alice met Bob, not Carol's report against a meeting she wasn't in.
    await expect(
      bob.auth.mutation(api.profiles.moderation.reportUser, {
        reportedId: carol.id as never,
        meetingId: strangers as never,
        reason: "No-show",
      }),
    ).rejects.toThrow(/took part/);
  });

  it("needs a reason and refuses self-reports", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");

    await expect(
      alice.auth.mutation(api.profiles.moderation.reportUser, {
        reportedId: bob.id as never,
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/);

    await expect(
      alice.auth.mutation(api.profiles.moderation.reportUser, {
        reportedId: alice.id as never,
        reason: "Me",
      }),
    ).rejects.toThrow(/yourself/);
  });
});
