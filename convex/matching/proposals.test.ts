/**
 * State-machine tests for the proposal mutations (convex/matching/
 * proposals.ts) on a real in-memory Convex runtime via convex-test.
 *
 * Covers the three behaviours the matcher plan calls out: mutual acceptance
 * creates exactly one meeting, an accept after the deadline is refused, and
 * anyone who is not one of the two people in the proposal is refused.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;

// Frozen clock, like callQueue.test.ts: the mutations guard on Date.now().
const NOW = Date.UTC(2026, 9, 15, 12, 0); // Thursday Oct 15, noon UTC.
const SLOT = Date.UTC(2026, 9, 16, 9, 0); // Friday Oct 16, 09:00 UTC.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

interface Fixture {
  proposalId: Id<"matchProposals">;
  aliceId: string;
  bobId: string;
  outsiderId: string;
  /** The proposal's userAId (lexicographically smaller of the pair). */
  aId: string;
  bId: string;
}

async function seedProposal(
  t: TestServer,
  overrides: Partial<{
    state: "proposed" | "confirmed" | "declined" | "expired";
    aAccepted: boolean;
    bAccepted: boolean;
    expiresAt: number;
    scheduledAt: number;
  }> = {},
): Promise<Fixture> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const mk = async (name: string) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: name,
        email: `${name.toLowerCase()}@example.com`,
        displayName: name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("profiles", {
        userId,
        displayName: name,
        languages: ["English"],
        timezone: "UTC",
        createdAt: now,
        updatedAt: now,
      });
      return userId;
    };
    const aliceId = await mk("Alice");
    const bobId = await mk("Bob");
    const outsiderId = await mk("Mallory");
    const [aId, bId] = [aliceId, bobId].sort();
    const proposalId = await ctx.db.insert("matchProposals", {
      userAId: aId as Id<"users">,
      userBId: bId as Id<"users">,
      state: "proposed",
      aAccepted: false,
      bAccepted: false,
      scheduledAt: SLOT,
      alternatives: [SLOT + 30 * 60_000, SLOT + 60 * 60_000],
      reasons: ["You both love rust"],
      firstQuestion: "What are you building this week?",
      score: 0.7,
      sharedInterestKeys: ["rust"],
      goalPair: "peers:find_mentor",
      runAt: NOW,
      expiresAt: NOW + 48 * 60 * 60_000,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    });
    return {
      proposalId,
      aliceId,
      bobId,
      outsiderId,
      aId,
      bId,
    };
  });
}

function authOf(t: TestServer, name: string) {
  return t.withIdentity({ subject: name });
}

describe("matchProposals state machine", () => {
  it("creates exactly one meeting when both sides accept", async () => {
    const t = createTestEnvironment();
    const fx = await seedProposal(t);
    const alice = authOf(t, "Alice");
    const bob = authOf(t, "Bob");

    // First accept: recorded, still proposed, no meeting yet.
    const first = await alice.mutation(api.matching.proposals.accept, {
      proposalId: fx.proposalId,
    });
    expect(first.state).toBe("proposed");
    expect(first.meetingId).toBeUndefined();
    const afterFirst = await t.run((ctx) => ctx.db.get(fx.proposalId));
    expect(afterFirst?.state).toBe("proposed");
    expect(afterFirst?.aAccepted || afterFirst?.bAccepted).toBe(true);
    const meetingsAfterFirst = await t.run(async (ctx) =>
      ctx.db.query("meetings").collect(),
    );
    expect(meetingsAfterFirst).toHaveLength(0);

    // Second accept: confirms and creates exactly one meeting.
    const second = await bob.mutation(api.matching.proposals.accept, {
      proposalId: fx.proposalId,
    });
    expect(second.state).toBe("confirmed");
    expect(second.meetingId).toBeDefined();
    const meetings = await t.run(async (ctx) =>
      ctx.db.query("meetings").collect(),
    );
    expect(meetings).toHaveLength(1);
    const meeting = meetings[0];
    expect(meeting.scheduledAt).toBe(SLOT);
    const participants = await t.run(async (ctx) =>
      ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect(),
    );
    expect(new Set(participants.map((p) => p.userId))).toEqual(
      new Set([fx.aId, fx.bId]),
    );
    const row = await t.run((ctx) => ctx.db.get(fx.proposalId));
    expect(row?.state).toBe("confirmed");
    expect(row?.meetingId).toBe(second.meetingId);
    expect(row?.aAccepted).toBe(true);
    expect(row?.bAccepted).toBe(true);
  });

  it("schedules the confirmation email and both reminders when both accept", async () => {
    const t = createTestEnvironment();
    const fx = await seedProposal(t);
    const scheduled = () =>
      t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect())
          .filter((f) => f.name.startsWith("emails/deliver"))
          .map((f) => [f.name, f.args[0]?.kind ?? null, f.scheduledTime]),
      );

    await authOf(t, "Alice").mutation(api.matching.proposals.accept, { proposalId: fx.proposalId });
    expect(await scheduled()).toEqual([]);

    await authOf(t, "Bob").mutation(api.matching.proposals.accept, { proposalId: fx.proposalId });
    expect(await scheduled()).toEqual([
      ["emails/deliver:meetingConfirmed", null, NOW],
      ["emails/deliver:sendReminder", "24h", SLOT - 24 * 60 * 60_000],
      ["emails/deliver:sendReminder", "10min", SLOT - 10 * 60_000],
    ]);
  });

  it("refuses an accept after expiry; the scheduled function does the flip", async () => {
    const t = createTestEnvironment();
    const fx = await seedProposal(t, { expiresAt: NOW - 1_000 });
    const alice = authOf(t, "Alice");

    await expect(
      alice.mutation(api.matching.proposals.accept, {
        proposalId: fx.proposalId,
      }),
    ).rejects.toThrowError(/expired/i);

    // A thrown mutation rolls back its transaction, so the flip itself is
    // the scheduled expireProposal's job — covered in the test below.
    const row = await t.run((ctx) => ctx.db.get(fx.proposalId));
    expect(row?.state).toBe("proposed");
  });

  it("refuses anyone who is not one of the two people in the proposal", async () => {
    const t = createTestEnvironment();
    const fx = await seedProposal(t);
    const mallory = authOf(t, "Mallory");

    await expect(
      mallory.mutation(api.matching.proposals.accept, {
        proposalId: fx.proposalId,
      }),
    ).rejects.toThrowError(/Only the two people/);
    await expect(
      mallory.mutation(api.matching.proposals.decline, {
        proposalId: fx.proposalId,
        reason: "other",
      }),
    ).rejects.toThrowError(/Only the two people/);

    const row = await t.run((ctx) => ctx.db.get(fx.proposalId));
    expect(row?.state).toBe("proposed");
  });

  it("resets the other side's acceptance when a time is chosen", async () => {
    const t = createTestEnvironment();
    const fx = await seedProposal(t, { aAccepted: true, bAccepted: true });
    const bob = authOf(t, "Bob");

    // The pair accepted the original time; switching it voids that.
    await bob.mutation(api.matching.proposals.chooseAlternative, {
      proposalId: fx.proposalId,
      index: 0,
    });
    const row = await t.run((ctx) => ctx.db.get(fx.proposalId));
    expect(row?.scheduledAt).toBe(SLOT + 30 * 60_000);
    expect(row?.alternatives).toEqual([SLOT, SLOT + 60 * 60_000]);
    expect(row?.expiresAt).toBe(SLOT + 30 * 60_000 - 2 * 60 * 60_000);
    // The caller's own acceptance stands; the other side is reset.
    const bobIsA = fx.aId === fx.bobId;
    expect(bobIsA ? row?.bAccepted : row?.aAccepted).toBe(false);
    expect(bobIsA ? row?.aAccepted : row?.bAccepted).toBe(true);
  });

  it("records who declined and why", async () => {
    const t = createTestEnvironment();
    const fx = await seedProposal(t);
    const bob = authOf(t, "Bob");

    await bob.mutation(api.matching.proposals.decline, {
      proposalId: fx.proposalId,
      reason: "bad_timing",
    });
    const row = await t.run((ctx) => ctx.db.get(fx.proposalId));
    expect(row?.state).toBe("declined");
    expect(row?.declineReason).toBe("bad_timing");
    expect(row?.declinedById).toBe(fx.bobId);
  });

  it("expires only live proposals, as a no-op otherwise", async () => {
    const t = createTestEnvironment();
    const live = await seedProposal(t);
    const past = await seedProposal(t, { expiresAt: NOW - 1_000 });

    await t.mutation(internal.matching.proposals.expireProposal, {
      proposalId: live.proposalId,
    });
    await t.mutation(internal.matching.proposals.expireProposal, {
      proposalId: past.proposalId,
    });

    const liveRow = await t.run((ctx) => ctx.db.get(live.proposalId));
    expect(liveRow?.state).toBe("proposed");
    const pastRow = await t.run((ctx) => ctx.db.get(past.proposalId));
    expect(pastRow?.state).toBe("expired");
  });

  it("shows my live proposal in my timezone", async () => {
    const t = createTestEnvironment();
    const fx = await seedProposal(t);
    const nameA = fx.aId === fx.aliceId ? "Alice" : "Bob";
    const me = authOf(t, nameA);

    const view = await me.query(api.matching.proposals.myProposal, {});
    expect(view).not.toBeNull();
    expect(view?.partner.name).toBe(nameA === "Alice" ? "Bob" : "Alice");
    expect(view?.scheduledAt).toBe(SLOT);
    expect(view?.scheduledAtLocal).toBe("Fri, Oct 16, 9:00 AM");
    expect(view?.alternatives).toHaveLength(2);
    expect(view?.firstQuestion).toContain("building");

    // No proposal for the outsider.
    const mallory = authOf(t, "Mallory");
    expect(await mallory.query(api.matching.proposals.myProposal, {})).toBeNull();
  });
});
