import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@convex/_generated/api";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;

async function person(t: TestServer, name: string, withProfile = true) {
  const id = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      workosUserId: name,
      email: `${name.toLowerCase()}@example.com`,
      displayName: name,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    if (withProfile) {
      await ctx.db.insert("profiles", {
        userId,
        displayName: name,
        languages: ["English"],
        experience: "senior",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("userInterests", {
        userId,
        interestKey: "technology",
        createdAt: now,
      });
    }
    return userId;
  });
  const auth = t.withIdentity({ subject: name });
  return {
    id,
    auth,
    join: (queueType: "casual" | "professional" = "casual") =>
      auth.mutation(api.matching.queue.join, { queueType }),
    status: () => auth.query(api.matching.queue.status, {}),
  };
}

async function pair(t: TestServer) {
  const alice = await person(t, "Alice");
  const bob = await person(t, "Bob");
  await alice.join();
  await bob.join();
  const state = await alice.status();
  if (state.state !== "matched")
    throw new Error(`Expected matched, got ${state.state}`);
  return { alice, bob, matchId: state.matchId };
}

describe("live call queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("pairs two people with genuine reasons while a third keeps waiting", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    const charlie = await person(t, "Charlie");
    await charlie.join();
    expect(await alice.status()).toMatchObject({
      state: "matched",
      matchId,
      partner: { id: bob.id, displayName: "Bob" },
      reasons: [
        "Strong interest alignment",
        "A shared language for your conversation",
      ],
      accepted: false,
      partnerAccepted: false,
    });
    expect(await bob.status()).toMatchObject({
      state: "matched",
      matchId,
      partner: { id: alice.id, displayName: "Alice" },
    });
    expect(await charlie.status()).toEqual({
      state: "waiting",
      queueType: "casual",
      joinedAt: Date.now(),
      expiresAt: Date.now() + 900_000,
    });
    expect(
      await t.run((ctx) => ctx.db.query("callQueueMatches").collect()),
    ).toHaveLength(1);
  });

  it("is idempotent when joining again, preserving server elapsed time", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    await alice.join();
    const joinedAt = Date.now();
    vi.setSystemTime(joinedAt + 12_000);
    await alice.join();
    expect(await alice.status()).toEqual({
      state: "waiting",
      queueType: "casual",
      joinedAt,
      expiresAt: joinedAt + 900_000,
    });
    expect(
      await t.run((ctx) => ctx.db.query("callQueueEntries").collect()),
    ).toHaveLength(1);
  });

  it("returns both to waiting after decline and does not immediately repeat that pair", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    await alice.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: false,
    });
    expect(await alice.status()).toMatchObject({
      state: "waiting",
      notice: { id: matchId, type: "declined" },
    });
    expect(await bob.status()).toMatchObject({
      state: "waiting",
      notice: { id: matchId, type: "partner_declined" },
    });
    await bob.join();
    expect(await bob.status()).toMatchObject({
      state: "waiting",
      notice: { id: matchId, type: "partner_declined" },
    });
    const charlie = await person(t, "Charlie");
    await charlie.join();
    const charlieState = await charlie.status();
    expect(charlieState).toMatchObject({ state: "matched" });
    if (charlieState.state !== "matched") throw new Error("Charlie must match");
    expect([alice.id, bob.id]).toContain(charlieState.partner.id);
    expect(
      (await t.run((ctx) => ctx.db.query("callQueueMatches").collect()))
        .map((match) => match.state)
        .sort(),
    ).toEqual(["declined", "pending"]);
  });

  it("creates one real meeting only after both accept, even with acceptance retries", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    await alice.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    await alice.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    expect(await alice.status()).toMatchObject({
      state: "matched",
      accepted: true,
      partnerAccepted: false,
    });
    expect(await bob.status()).toMatchObject({
      state: "matched",
      accepted: false,
      partnerAccepted: true,
    });
    expect(await t.run((ctx) => ctx.db.query("meetings").collect())).toEqual(
      [],
    );
    await bob.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    await bob.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    const aliceState = await alice.status();
    expect(aliceState).toMatchObject({ state: "ready", matchId });
    if (aliceState.state !== "ready") throw new Error("Expected ready");
    expect(await bob.status()).toEqual(aliceState);
    const records = await t.run(async (ctx) => ({
      meetings: await ctx.db.query("meetings").collect(),
      participants: await ctx.db.query("meetingParticipants").collect(),
      state: await ctx.db.query("meetingState").collect(),
      notes: await ctx.db.query("meetingNotes").collect(),
    }));
    expect(records.meetings).toHaveLength(1);
    expect(records.meetings[0]).toMatchObject({
      _id: aliceState.meetingId,
      webrtcEnabled: true,
      participantCount: 2,
      state: "active",
      organizerId: alice.id,
    });
    expect(
      records.participants.map(({ meetingId, userId, role }) => ({
        meetingId,
        userId,
        role,
      })),
    ).toEqual([
      { meetingId: aliceState.meetingId, userId: alice.id, role: "host" },
      { meetingId: aliceState.meetingId, userId: bob.id, role: "participant" },
    ]);
    expect(records.state).toMatchObject([
      { meetingId: aliceState.meetingId, recordingEnabled: false, active: true },
    ]);
    expect(records.notes).toMatchObject([
      { meetingId: aliceState.meetingId, content: "", version: 0 },
    ]);
    const sessionId = "queue-alice-session";
    expect(await alice.auth.mutation(api.meetings.webrtc.mesh.joinCall, {
      meetingId: aliceState.meetingId, sessionId,
    })).toEqual({ sessionId, participantId: "Alice" });
    await alice.auth.mutation(api.meetings.webrtc.mesh.leaveCall, {
      meetingId: aliceState.meetingId, sessionId,
    });
    expect(await alice.status()).toEqual({ state: "idle" });
    expect(await bob.status()).toEqual(aliceState);
    await alice.join();
    expect(await alice.status()).toMatchObject({ state: "waiting" });
  });

  it.each(["concluded", "cancelled"] as const)(
    "allows a fresh queue after a %s meeting",
    async (state) => {
      const t = createTestEnvironment();
      const { alice, bob, matchId } = await pair(t);
      await alice.auth.mutation(api.matching.queue.respond, {
        matchId,
        accept: true,
      });
      await bob.auth.mutation(api.matching.queue.respond, {
        matchId,
        accept: true,
      });
      const ready = await alice.status();
      if (ready.state !== "ready") throw new Error("Expected ready");
      await t.run((ctx) => ctx.db.patch(ready.meetingId, { state }));
      expect(await alice.status()).toEqual({ state: "idle" });
      expect(await bob.status()).toEqual({ state: "idle" });
      await alice.join("professional");
      expect(await alice.status()).toMatchObject({
        state: "waiting",
        queueType: "professional",
      });
      await bob.join("professional");
      expect(await alice.status()).toMatchObject({
        state: "matched",
        queueType: "professional",
        partner: { id: bob.id },
      });
    },
  );

  it("expires an unanswered match on the server and announces both returned to waiting", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    await alice.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await t.finishInProgressScheduledFunctions();
    expect(await alice.status()).toMatchObject({
      state: "waiting",
      notice: { id: matchId, type: "match_expired" },
    });
    expect(await bob.status()).toMatchObject({
      state: "waiting",
      notice: { id: matchId, type: "match_expired" },
    });
    await bob.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({
      state: "expired",
    });
    expect(await t.run((ctx) => ctx.db.query("meetings").collect())).toEqual(
      [],
    );
  });

  it("rejects an acceptance at the deadline even before the scheduled expiry runs", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    await alice.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    vi.setSystemTime(Date.now() + 60_000);
    await bob.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    expect(await alice.status()).toMatchObject({
      state: "waiting",
      notice: { type: "match_expired" },
    });
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({
      state: "expired",
    });
    expect(await t.run((ctx) => ctx.db.query("meetings").collect())).toEqual(
      [],
    );
  });

  it("expires queue availability and allows a fresh search", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    await alice.join();
    const joinedAt = Date.now();
    await vi.advanceTimersByTimeAsync(900_000);
    await t.finishInProgressScheduledFunctions();
    expect(await alice.status()).toEqual({
      state: "expired",
      queueType: "casual",
      joinedAt,
      expiresAt: joinedAt + 900_000,
    });
    await alice.join();
    expect(await alice.status()).toEqual({
      state: "waiting",
      queueType: "casual",
      joinedAt: Date.now(),
      expiresAt: Date.now() + 900_000,
    });
  });

  it("ignores an old availability timer after leaving and rejoining", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    await alice.join();
    const entry = await t.run((ctx) =>
      ctx.db.query("callQueueEntries").unique(),
    );
    if (!entry) throw new Error("Missing entry");
    await alice.auth.mutation(api.matching.queue.leave, {});
    vi.setSystemTime(Date.now() + 1_000);
    await alice.join();
    vi.setSystemTime(entry.expiresAt);
    await t.mutation(internal.matching.queue.expireEntry, {
      entryId: entry._id,
      expiresAt: entry.expiresAt,
    });
    expect(await alice.status()).toEqual({
      state: "waiting",
      queueType: "casual",
      joinedAt: entry.joinedAt + 1_000,
      expiresAt: entry.expiresAt + 1_000,
    });
  });

  it("does not double-match people across concurrent joins", async () => {
    const t = createTestEnvironment();
    const people = await Promise.all(
      ["Alice", "Bob", "Charlie", "Daria", "Eli"].map((name) =>
        person(t, name),
      ),
    );
    await Promise.all(people.map((user) => user.join()));
    const states = await Promise.all(people.map((user) => user.status()));
    expect(states.filter((state) => state.state === "matched")).toHaveLength(4);
    expect(states.filter((state) => state.state === "waiting")).toHaveLength(1);
    const matches = await t.run((ctx) =>
      ctx.db.query("callQueueMatches").collect(),
    );
    expect(matches).toHaveLength(2);
    expect(
      new Set(matches.flatMap(({ user1Id, user2Id }) => [user1Id, user2Id]))
        .size,
    ).toBe(4);
  });

  it("serializes concurrent final accepts into one meeting", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    await Promise.all([
      alice.auth.mutation(api.matching.queue.respond, {
        matchId,
        accept: true,
      }),
      bob.auth.mutation(api.matching.queue.respond, { matchId, accept: true }),
    ]);
    expect(await alice.status()).toEqual(await bob.status());
    expect(await alice.status()).toMatchObject({ state: "ready" });
    expect(
      await t.run((ctx) => ctx.db.query("meetings").collect()),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("meetingParticipants").collect()),
    ).toHaveLength(2);
  });

  it("rejects outsider accepts and declines without changing either participant", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    const charlie = await person(t, "Charlie");
    for (const accept of [true, false])
      await expect(
        charlie.auth.mutation(api.matching.queue.respond, { matchId, accept }),
      ).rejects.toThrow("not a participant");
    expect(await alice.status()).toMatchObject({
      state: "matched",
      accepted: false,
      partnerAccepted: false,
    });
    expect(await bob.status()).toMatchObject({
      state: "matched",
      accepted: false,
      partnerAccepted: false,
    });
  });

  it("requires authentication for every live queue endpoint", async () => {
    const t = createTestEnvironment();
    const { matchId } = await pair(t);
    await expect(
      t.mutation(api.matching.queue.join, { queueType: "casual" }),
    ).rejects.toThrow("Authentication required");
    await expect(t.mutation(api.matching.queue.leave, {})).rejects.toThrow(
      "Authentication required",
    );
    await expect(t.query(api.matching.queue.status, {})).rejects.toThrow(
      "Authentication required",
    );
    await expect(
      t.mutation(api.matching.queue.respond, { matchId, accept: true }),
    ).rejects.toThrow("Authentication required");
  });

  it("leaving a pending match releases the partner and prevents a late acceptance", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    await alice.auth.mutation(api.matching.queue.leave, {});
    await alice.auth.mutation(api.matching.queue.leave, {});
    expect(await alice.status()).toEqual({ state: "idle" });
    expect(await bob.status()).toMatchObject({
      state: "waiting",
      notice: { type: "partner_declined" },
    });
    await alice.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    await bob.auth.mutation(api.matching.queue.respond, {
      matchId,
      accept: true,
    });
    expect(await bob.status()).toMatchObject({ state: "waiting" });
    expect(await t.run((ctx) => ctx.db.query("meetings").collect())).toEqual(
      [],
    );
  });

  it("keeps conversation types in separate pools", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice");
    const bob = await person(t, "Bob");
    const charlie = await person(t, "Charlie");
    await alice.join("casual");
    await bob.join("professional");
    await charlie.join("professional");
    expect(await alice.status()).toMatchObject({
      state: "waiting",
      queueType: "casual",
    });
    expect(await bob.status()).toMatchObject({
      state: "matched",
      queueType: "professional",
      partner: { id: charlie.id },
    });
    await expect(alice.join("professional")).rejects.toThrow(
      "Leave your current queue",
    );
  });

  it("does not offer unsupported matches for profiles without any matching evidence", async () => {
    const t = createTestEnvironment();
    const alice = await person(t, "Alice", false);
    const bob = await person(t, "Bob", false);
    await alice.join();
    await bob.join();
    expect(await alice.status()).toMatchObject({ state: "waiting" });
    expect(await bob.status()).toMatchObject({ state: "waiting" });
    expect(
      await t.run((ctx) => ctx.db.query("callQueueMatches").collect()),
    ).toEqual([]);
  });

  it("legacy scheduler and status mutations cannot consume the live queue", async () => {
    const t = createTestEnvironment();
    const { alice, bob, matchId } = await pair(t);
    const charlie = await person(t, "Charlie");
    await charlie.join();
    const cycle = await t.action(api.matching.engine.runMatchingCycle, {
      shardCount: 1,
      minScore: 0.01,
      maxMatches: 10,
    });
    expect(cycle.totalMatches).toBe(0);
    expect(await alice.status()).toMatchObject({
      state: "matched",
      matchId,
      partner: { id: bob.id },
    });
    expect(await charlie.status()).toMatchObject({ state: "waiting" });
  });
});
