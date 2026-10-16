/**
 * Reminder guard tests (convex/emails/drafts.ts reminderDrafts) on a real
 * in-memory Convex runtime via convex-test.
 *
 * The one thing that must never happen is a reminder for a cancelled or
 * expired meeting, so the guard is pinned from every side: a cancelled
 * meeting sends nothing, a meeting whose window has passed sends nothing, a
 * non-confirmed proposal sends nothing, and a genuinely upcoming confirmed
 * chat drafts one email per participant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;

// Thursday Oct 15 2026, noon UTC.
const NOW = Date.UTC(2026, 9, 15, 12, 0);
/** Tomorrow 09:00 UTC — a legal proposed slot. */
const SLOT = Date.UTC(2026, 9, 16, 9, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

interface Fixture {
  meetingId: Id<"meetings">;
  aliceId: Id<"users">;
  bobId: Id<"users">;
}

/** Alice and Bob share a confirmed proposal and its meeting. */
async function seedConfirmedMeeting(
  t: TestServer,
  overrides: Partial<{
    scheduledAt: number;
    state: "scheduled" | "active" | "concluded" | "cancelled";
    proposalState: "proposed" | "confirmed" | "declined" | "expired";
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
    const [aId, bId] = [aliceId, bobId].sort() as Id<"users">[];
    const meetingId = await ctx.db.insert("meetings", {
      organizerId: aliceId,
      title: "Connvo match: Alice & Bob",
      scheduledAt: overrides.scheduledAt ?? SLOT,
      duration: 30 * 60_000,
      state: overrides.state ?? "scheduled",
      createdAt: now,
      updatedAt: now,
    });
    for (const userId of [aliceId, bobId]) {
      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId,
        role: "participant",
        presence: "joined",
        joinedAt: now,
        createdAt: now,
      });
    }
    await ctx.db.insert("matchProposals", {
      userAId: aId,
      userBId: bId,
      state: overrides.proposalState ?? "confirmed",
      aAccepted: true,
      bAccepted: true,
      meetingId,
      scheduledAt: overrides.scheduledAt ?? SLOT,
      alternatives: [],
      reasons: ["You both love rust"],
      firstQuestion: "What are you building this week?",
      score: 0.7,
      sharedInterestKeys: ["rust"],
      goalPair: "peers:find_mentor",
      runAt: NOW,
      expiresAt: SLOT,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { meetingId, aliceId, bobId };
  });
}

function reminder(
  t: TestServer,
  meetingId: Id<"meetings">,
  kind: "24h" | "10min",
) {
  return t.query(internal.emails.drafts.reminderDrafts, {
    meetingId,
    kind,
  });
}

function icsInstant(value: string): number {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) throw new Error(`Invalid ICS instant: ${value}`);
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
}

describe("reminder guard", () => {
  it("sends nothing for a cancelled meeting", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t, { state: "cancelled" });
    expect(await reminder(t, fx.meetingId, "24h")).toBeNull();
    expect(await reminder(t, fx.meetingId, "10min")).toBeNull();
  });

  it("sends nothing once the meeting window has passed", async () => {
    const t = createTestEnvironment();
    // Yesterday: past at seed time; even "active" stays null.
    const fx = await seedConfirmedMeeting(t, {
      scheduledAt: NOW - 60 * 60_000,
      state: "active",
    });
    expect(await reminder(t, fx.meetingId, "10min")).toBeNull();
    expect(await reminder(t, fx.meetingId, "24h")).toBeNull();
  });

  it("sends nothing when the proposal is not confirmed", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t, { proposalState: "expired" });
    expect(await reminder(t, fx.meetingId, "24h")).toBeNull();
  });

  it("drafts one email per participant for an upcoming confirmed chat", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    const drafts = await reminder(t, fx.meetingId, "24h");
    expect(drafts).not.toBeNull();
    expect(drafts).toHaveLength(2);
    const addresses = drafts!.map((draft) => draft.to).sort();
    expect(addresses).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(drafts![0]?.attachment?.filename).toBeUndefined();
    const subjects = drafts!.map((draft) => draft.subject).join(" | ");
    expect(subjects).toContain("Alice");
    expect(subjects).toContain("Bob");

    // Inside the final 30 minutes the 24-hour reminder stands down and the
    // 10-minute reminder takes over.
    vi.setSystemTime(new Date(SLOT - 20 * 60_000));
    expect(await reminder(t, fx.meetingId, "24h")).toBeNull();
    const late = await reminder(t, fx.meetingId, "10min");
    expect(late).toHaveLength(2);
  });

  it("attaches a 30-minute invite and names only scheduled reminders", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t, { scheduledAt: NOW + 5 * 60 * 60_000 });
    const drafts = await t.query(internal.emails.drafts.confirmedDrafts, {
      meetingId: fx.meetingId,
      reminderKinds: ["10min"],
    });
    expect(drafts).toHaveLength(2);
    const attachment = drafts[0]?.attachment;
    expect(attachment?.filename).toBe("connvo-chat.ics");
    const ics = atob(attachment?.base64 ?? "");
    const start = ics.match(/DTSTART:(\d{8}T\d{6}Z)/)?.[1];
    const end = ics.match(/DTEND:(\d{8}T\d{6}Z)/)?.[1];
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect(icsInstant(end!) - icsInstant(start!)).toBe(30 * 60_000);
    expect(drafts[0]?.text).toContain("10 minutes before");
    expect(drafts[0]?.text).not.toContain("24 hours");
  });
});
