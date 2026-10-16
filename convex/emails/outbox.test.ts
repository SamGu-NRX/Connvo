/**
 * Local email inbox tests: the emailOutbox recording (convex/emails/outbox.ts
 * via deliver.ts's console provider) and the real-email CONNVO_APP_URL
 * refusal, on a real in-memory Convex runtime via convex-test.
 *
 * The things that must never happen: a tester reading the outbox sees a
 * different message than the one built, the same confirmation recorded
 * twice, real email (RESEND_API_KEY set) going out with localhost links, or
 * a reminder for a chat later the same day that says "Tomorrow".
 *
 * The refusal cases run against the real deliver action end to end: the
 * action fails naming CONNVO_APP_URL, no fetch leaves the process, nothing
 * is recorded, and the per-recipient marker settles as failed — a refused,
 * non-retried send under the delivery rules of #70.
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
  delete process.env.RESEND_API_KEY;
  process.env.CONNVO_APP_URL = "https://app.example.com";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.RESEND_API_KEY;
  delete process.env.CONNVO_APP_URL;
  vi.restoreAllMocks();
});

interface Fixture {
  meetingId: Id<"meetings">;
  aliceId: Id<"users">;
  bobId: Id<"users">;
}

/** Alice and Bob share a confirmed proposal and its meeting. */
async function seedConfirmedMeeting(
  t: TestServer,
  overrides: Partial<{ scheduledAt: number; timezone: string }> = {},
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
        timezone: overrides.timezone ?? "UTC",
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
      state: "scheduled",
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
      state: "confirmed",
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

describe("local email outbox", () => {
  it("records both confirmations once each, with links built from CONNVO_APP_URL", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    // Any network call is a bug: with no RESEND_API_KEY the console
    // provider must serve locally and nothing may leave the process.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unexpected network send");
      }),
    );

    await t.action(internal.emails.deliver.meetingConfirmed, {
      meetingId: fx.meetingId,
      reminderKinds: ["24h", "10min"],
    });
    // A duplicate scheduling is skipped by the sent marker and records
    // nothing more.
    await t.action(internal.emails.deliver.meetingConfirmed, {
      meetingId: fx.meetingId,
      reminderKinds: ["24h", "10min"],
    });

    for (const [address, partner] of [
      ["alice@example.com", "Bob"],
      ["bob@example.com", "Alice"],
    ] as const) {
      const rows = await t.query(internal.emails.outbox.listForAddress, {
        to: address,
      });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.to).toBe(address);
      expect(row.meetingId).toBe(fx.meetingId);
      expect(row.subject).toBe(
        `Confirmed: you and ${partner}, Fri, Oct 16, 9:00 AM`,
      );
      expect(row.attachmentNames).toEqual(["connvo-chat.ics"]);
      expect(row.idempotencyKey).toBe(`confirmed:${fx.meetingId}:${address}`);
      expect(row.links).toEqual([
        `https://app.example.com/app/call/${fx.meetingId}`,
      ]);
      expect(row.text).toContain(
        `https://app.example.com/app/call/${fx.meetingId}`,
      );
      expect(row.html).toContain(
        `https://app.example.com/app/call/${fx.meetingId}`,
      );
      expect(row.html).not.toContain("http://localhost:3000");
      expect(row.sentAt).toBe(NOW);
    }
    // Exactly one row per participant — nobody else, nothing extra.
    const all = await t.run((ctx) => ctx.db.query("emailOutbox").collect());
    expect(all).toHaveLength(2);
  });

  it("clears by address and everything, as the internal mutations promise", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    await t.action(internal.emails.deliver.meetingConfirmed, {
      meetingId: fx.meetingId,
      reminderKinds: [],
    });

    const cleared = await t.mutation(internal.emails.outbox.clearForAddress, {
      to: "alice@example.com",
    });
    expect(cleared).toBe(1);
    expect(
      await t.query(internal.emails.outbox.listForAddress, {
        to: "alice@example.com",
      }),
    ).toHaveLength(0);

    const clearedAll = await t.mutation(internal.emails.outbox.clearAll, {});
    expect(clearedAll).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.query("emailOutbox").collect()),
    ).toHaveLength(0);
  });

  it.each([
    { label: "missing", url: undefined },
    { label: "localhost", url: "http://localhost:3000" },
    { label: "the loopback IP", url: "http://127.0.0.1:8787" },
  ])("refuses real email when CONNVO_APP_URL is $label", async ({ url }) => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    process.env.RESEND_API_KEY = "re_test_key";
    if (url === undefined) delete process.env.CONNVO_APP_URL;
    else process.env.CONNVO_APP_URL = url;
    const networkSend = vi.fn(async () => {
      throw new Error("unexpected network send");
    });
    vi.stubGlobal("fetch", networkSend);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      t.action(internal.emails.deliver.meetingConfirmed, {
        meetingId: fx.meetingId,
        reminderKinds: [],
      }),
    ).rejects.toThrow(/CONNVO_APP_URL/);

    // Nothing went out, nothing was recorded, and both recipients'
    // markers are failed, not sent — never retried.
    expect(networkSend).not.toHaveBeenCalled();
    for (const address of ["alice@example.com", "bob@example.com"]) {
      expect(
        await t.query(internal.emails.outbox.listForAddress, { to: address }),
      ).toHaveLength(0);
      const marker = await t.run((ctx) =>
        ctx.db
          .query("idempotencyKeys")
          .withIndex("by_key_scope", (q) =>
            q
              .eq("key", `confirmed:${fx.meetingId}:${address}`)
              .eq("scope", "email_send"),
          )
          .unique(),
      );
      expect(marker?.metadata?.status).toBe("failed");
    }
  });
});

describe("reminder subject words", () => {
  it("does not say Tomorrow for a chat later the same day", async () => {
    const t = createTestEnvironment();
    // Five hours out, the same UTC calendar day as NOW.
    const fx = await seedConfirmedMeeting(t, {
      scheduledAt: Date.UTC(2026, 9, 15, 17, 0),
    });
    const drafts = await t.query(internal.emails.drafts.reminderDrafts, {
      meetingId: fx.meetingId,
      kind: "24h",
    });
    expect(drafts).not.toBeNull();
    expect(drafts![0]!.subject).toMatch(/^Today: you and /);
    expect(drafts![0]!.subject).not.toContain("Tomorrow");
    expect(drafts![0]!.text).toContain("is later today.");
    expect(drafts![0]!.text).not.toContain("24 hours");
  });

  it("says Today in the recipient's timezone when the chat is tomorrow in UTC but today there", async () => {
    const t = createTestEnvironment();
    // Oct 16 01:00 UTC is Oct 15 21:00 in New York (EDT, UTC-4 in October)
    // — thirteen hours away, but the same calendar day for the recipient.
    const fx = await seedConfirmedMeeting(t, {
      scheduledAt: Date.UTC(2026, 9, 16, 1, 0),
      timezone: "America/New_York",
    });
    const drafts = await t.query(internal.emails.drafts.reminderDrafts, {
      meetingId: fx.meetingId,
      kind: "24h",
    });
    expect(drafts![0]!.subject).toMatch(/^Today: you and /);
  });

  it("still says Tomorrow in the recipient's timezone for the next calendar day there", async () => {
    const t = createTestEnvironment();
    // Oct 16 13:30 UTC is Oct 16 09:30 in New York — the next day there.
    const fx = await seedConfirmedMeeting(t, {
      scheduledAt: Date.UTC(2026, 9, 16, 13, 30),
      timezone: "America/New_York",
    });
    const drafts = await t.query(internal.emails.drafts.reminderDrafts, {
      meetingId: fx.meetingId,
      kind: "24h",
    });
    expect(drafts![0]!.subject).toMatch(/^Tomorrow: you and /);
  });

  it("keeps Starting soon for the 10-minute reminder", async () => {
    const t = createTestEnvironment();
    // Ten minutes out — inside the Starting-soon window of reminderLead.
    const fx = await seedConfirmedMeeting(t, {
      scheduledAt: Date.UTC(2026, 9, 15, 12, 10),
    });
    const drafts = await t.query(internal.emails.drafts.reminderDrafts, {
      meetingId: fx.meetingId,
      kind: "10min",
    });
    expect(drafts![0]!.subject).toMatch(/^Starting soon: you and /);
    expect(drafts![0]!.text).toContain("starts in about 10 minutes.");
  });
});
