import { describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
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
  return {
    id: userId,
    auth: t.withIdentity({ subject: name }),
  };
}

function availabilityOf(t: TestServer, userId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("availabilityBlocks")
      .withIndex("by_user", (q) => q.eq("userId", userId as never))
      .collect(),
  );
}

describe("replaceAvailability", () => {
  it("a user writes and reads only their own availability", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");

    await alice.auth.mutation(api.profiles.availability.replaceAvailability, {
      blocks: [{ weekday: 1, startMinute: 720, endMinute: 750 }],
    });
    await bob.auth.mutation(api.profiles.availability.replaceAvailability, {
      blocks: [{ weekday: 2, startMinute: 0, endMinute: 30 }],
    });

    // Bob's replace must not have touched Alice's rows, and his own read
    // sees only his block.
    const aliceBlocks = await availabilityOf(t, alice.id);
    expect(aliceBlocks).toHaveLength(1);
    expect(aliceBlocks[0]).toMatchObject({
      weekday: 1,
      startMinute: 720,
      endMinute: 750,
    });
    expect(await bob.auth.query(api.profiles.availability.getMyAvailability, {})).toEqual([
      expect.objectContaining({ weekday: 2, startMinute: 0, endMinute: 30 }),
    ]);

    // Replacing replaces: Bob's old block is gone, Alice's is untouched.
    await bob.auth.mutation(api.profiles.availability.replaceAvailability, {
      blocks: [{ weekday: 4, startMinute: 600, endMinute: 660 }],
    });
    const bobBlocks = await availabilityOf(t, bob.id);
    expect(bobBlocks).toHaveLength(1);
    expect(bobBlocks[0]).toMatchObject({ weekday: 4 });
    expect(await availabilityOf(t, alice.id)).toHaveLength(1);
  });

  it("refuses blocks that are not half-hour steps or outside one day", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");

    await expect(
      alice.auth.mutation(api.profiles.availability.replaceAvailability, {
        blocks: [{ weekday: 1, startMinute: 720, endMinute: 765 }],
      }),
    ).rejects.toThrow(/30-minute/);

    await expect(
      alice.auth.mutation(api.profiles.availability.replaceAvailability, {
        blocks: [{ weekday: 1, startMinute: 750, endMinute: 720 }],
      }),
    ).rejects.toThrow(/end after it starts/);

    await expect(
      alice.auth.mutation(api.profiles.availability.replaceAvailability, {
        blocks: [{ weekday: 7, startMinute: 0, endMinute: 30 }],
      }),
    ).rejects.toThrow(/0-6/);

    // Nothing was written by any of the refused calls.
    expect(await availabilityOf(t, alice.id)).toHaveLength(0);
  });

  it("merges overlapping and touching blocks so the matcher never double-counts", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");

    const stored = await alice.auth.mutation(
      api.profiles.availability.replaceAvailability,
      {
        blocks: [
          { weekday: 1, startMinute: 720, endMinute: 780 },
          { weekday: 1, startMinute: 750, endMinute: 840 },
          { weekday: 1, startMinute: 840, endMinute: 870 },
          { weekday: 1, startMinute: 720, endMinute: 780 },
        ],
      },
    );
    expect(stored).toBe(1);
    const rows = await availabilityOf(t, alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      weekday: 1,
      startMinute: 720,
      endMinute: 870,
    });
  });
});

describe("setChatPreferences", () => {
  it("stores goals, timezone and cadence for the signed-in user only", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");

    await alice.auth.mutation(api.profiles.availability.setChatPreferences, {
      intents: ["find_mentor", "peers", "hiring"],
      timezone: "America/New_York",
      chatsPerWeek: 2,
    });
    // Bob's write cannot reach Alice: ids are taken from the identity.
    await bob.auth.mutation(api.profiles.availability.setChatPreferences, {
      intents: ["mentor"],
      chatsPerWeek: 0,
    });

    const alicePrefs = await alice.auth.query(
      api.profiles.availability.getMyChatPreferences,
      {},
    );
    expect(alicePrefs).toEqual({
      intents: ["find_mentor", "peers", "hiring"],
      timezone: "America/New_York",
      chatsPerWeek: 2,
    });
    const bobPrefs = await bob.auth.query(
      api.profiles.availability.getMyChatPreferences,
      {},
    );
    expect(bobPrefs).toEqual({
      intents: ["mentor"],
      timezone: undefined,
      chatsPerWeek: 0,
    });
  });

  it("refuses more than three goals, duplicates, and unknown timezones", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");

    await expect(
      alice.auth.mutation(api.profiles.availability.setChatPreferences, {
        intents: ["mentor", "peers", "hiring", "collaborate"],
      }),
    ).rejects.toThrow(/at most three/);

    await expect(
      alice.auth.mutation(api.profiles.availability.setChatPreferences, {
        intents: ["mentor", "mentor"],
      }),
    ).rejects.toThrow(/only be picked once/);

    await expect(
      alice.auth.mutation(api.profiles.availability.setChatPreferences, {
        timezone: "Mars/Olympus",
      }),
    ).rejects.toThrow(/timezone/);
  });
});

describe("unauthenticated access", () => {
  it("is refused for writes; availability reads return empty like other profile reads", async () => {
    const t = createTestEnvironment();
    await expect(
      t.mutation(api.profiles.availability.replaceAvailability, {
        blocks: [],
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.profiles.availability.setChatPreferences, {}),
    ).rejects.toThrow();
    // Reads degrade to empty rather than throwing, matching
    // getCurrentUserProfile's null-on-unauthenticated contract.
    expect(
      await t.query(api.profiles.availability.getMyAvailability, {}),
    ).toEqual([]);
    expect(
      await t.query(api.profiles.availability.getMyChatPreferences, {}),
    ).toBeNull();
  });
});
