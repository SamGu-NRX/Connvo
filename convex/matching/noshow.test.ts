/**
 * No-show tests (convex/matching/noshow.ts) on a real in-memory Convex
 * runtime via convex-test.
 *
 * The adversarial cases the matcher plan calls out: a report before the
 * 10-minute mark is refused, the report path ends with one report and one
 * strike and a concluded meeting, a partner who did join blocks the report,
 * and a meeting reports once only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;

// Frozen clock, like proposals.test.ts: the guards compare against Date.now().
const NOW = Date.UTC(2026, 9, 15, 12, 0); // Thursday Oct 15, noon UTC.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

interface Fixture {
  meetingId: Id<"meetings">;
  aliceId: Id<"users">;
  bobId: Id<"users">;
  malloryId: Id<"users">;
}

/** Alice and Bob share a scheduled meeting; Mallory is nobody in it. */
async function seedMeeting(
  t: TestServer,
  overrides: Partial<{
    scheduledAt: number;
    state: "scheduled" | "active" | "concluded" | "cancelled";
    bobPresence: "invited" | "joined" | "left";
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
    const malloryId = await mk("Mallory");

    const meetingId = await ctx.db.insert("meetings", {
      organizerId: aliceId,
      title: "Connvo match: Alice & Bob",
      scheduledAt: overrides.scheduledAt ?? NOW,
      duration: 30 * 60_000,
      state: overrides.state ?? "scheduled",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: aliceId,
      role: "host",
      presence: "joined",
      joinedAt: now,
      createdAt: now,
    });
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: bobId,
      role: "participant",
      presence: overrides.bobPresence ?? "invited",
      createdAt: now,
    });
    return { meetingId, aliceId, bobId, malloryId };
  });
}

describe("no-show reporting", () => {
  it("refuses a report before the 10-minute mark", async () => {
    const t = createTestEnvironment();
    const fx = await seedMeeting(t, { scheduledAt: NOW });
    const alice = t.withIdentity({ subject: "Alice" });

    vi.setSystemTime(new Date(NOW + 9 * 60_000 + 59_000));
    await expect(
      alice.mutation(api.matching.noshow.reportNoShow, {
        meetingId: fx.meetingId,
      }),
    ).rejects.toThrow(/10 minutes/);

    const canReport = await alice.query(api.matching.noshow.canReport, {
      meetingId: fx.meetingId,
    });
    expect(canReport.ok).toBe(false);
    expect(canReport.reason).toBe("too_early");
  });

  it("reports after 10 minutes: one report, one strike, meeting concluded", async () => {
    const t = createTestEnvironment();
    const fx = await seedMeeting(t, { scheduledAt: NOW });
    const alice = t.withIdentity({ subject: "Alice" });

    vi.setSystemTime(new Date(NOW + 11 * 60_000));
    const result = await alice.mutation(api.matching.noshow.reportNoShow, {
      meetingId: fx.meetingId,
    });
    expect(result.absentUserId).toBe(fx.bobId);
    expect(result.strikeCount).toBe(1);

    const reports = await t.run(async (ctx) =>
      ctx.db.query("noShowReports").collect(),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.reporterId).toBe(fx.aliceId);
    expect(reports[0]?.absentUserId).toBe(fx.bobId);

    const strikes = await t.run(async (ctx) =>
      ctx.db.query("matchingStrikes").collect(),
    );
    expect(strikes).toHaveLength(1);
    expect(strikes[0]?.userId).toBe(fx.bobId);

    const meeting = await t.run((ctx) => ctx.db.get(fx.meetingId));
    expect(meeting?.state).toBe("concluded");

    const canReport = await alice.query(api.matching.noshow.canReport, {
      meetingId: fx.meetingId,
    });
    expect(canReport.ok).toBe(false);
    expect(canReport.reason).toBe("ended");
  });

  it("refuses the report when the other person joined", async () => {
    const t = createTestEnvironment();
    const fx = await seedMeeting(t, {
      scheduledAt: NOW,
      bobPresence: "joined",
    });
    const alice = t.withIdentity({ subject: "Alice" });

    vi.setSystemTime(new Date(NOW + 11 * 60_000));
    await expect(
      alice.mutation(api.matching.noshow.reportNoShow, {
        meetingId: fx.meetingId,
      }),
    ).rejects.toThrow(/no no-show/);

    const canReport = await alice.query(api.matching.noshow.canReport, {
      meetingId: fx.meetingId,
    });
    expect(canReport.reason).toBe("partner_joined");
  });

  it("reports once per meeting and only from inside it", async () => {
    const t = createTestEnvironment();
    const fx = await seedMeeting(t, { scheduledAt: NOW });
    const alice = t.withIdentity({ subject: "Alice" });
    const mallory = t.withIdentity({ subject: "Mallory" });

    vi.setSystemTime(new Date(NOW + 11 * 60_000));
    await expect(
      mallory.mutation(api.matching.noshow.reportNoShow, {
        meetingId: fx.meetingId,
      }),
    ).rejects.toThrow(/Only the two people/);

    await alice.mutation(api.matching.noshow.reportNoShow, {
      meetingId: fx.meetingId,
    });
    await expect(
      alice.mutation(api.matching.noshow.reportNoShow, {
        meetingId: fx.meetingId,
      }),
    ).rejects.toThrow(/already reported/);
  });
});
