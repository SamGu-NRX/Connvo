/**
 * Retry-safe multi-recipient delivery tests (convex/emails/deliver.ts) on a
 * real in-memory Convex runtime via convex-test, with a fake Resend HTTP
 * endpoint behind a stubbed global fetch.
 *
 * The thing that must never happen is one person of a pair left uninformed
 * because the other person's send failed transiently — or the same person
 * told twice by a retry. The provider under test is the real resendProvider
 * (RESEND_API_KEY set, api.resend.com stubbed), so the retry classification
 * and the Idempotency-Key header are exercised for real:
 *
 * - a transient failure on recipient two still delivers to both after a
 *   scheduled retry;
 * - the retry never sends twice to recipient one (durable per-recipient
 *   sent marker), and stays bounded when recipient two never recovers;
 * - a meeting cancelled between attempts sends nothing more (the reminder
 *   guard re-runs at retry time);
 * - refusals (4xx) are not retried, fail the action, and leave the
 *   recipient's marker failed rather than sent;
 * - a 300-character address still gets an Idempotency-Key within Resend's
 *   256-character limit.
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
  process.env.RESEND_API_KEY = "re_test_key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.RESEND_API_KEY;
  vi.restoreAllMocks();
});

interface Fixture {
  meetingId: Id<"meetings">;
  aliceId: Id<"users">;
  bobId: Id<"users">;
}

/** Alice and Bob share a confirmed proposal and its meeting. */
async function seedConfirmedMeeting(t: TestServer): Promise<Fixture> {
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
      scheduledAt: SLOT,
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
      scheduledAt: SLOT,
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

interface SendLog {
  /** Every HTTP attempt, in order (delivered or not). */
  attempts: string[];
  /** Attempts that returned success. */
  delivered: string[];
  /** The Idempotency-Key header of every attempt, aligned with attempts. */
  keys: string[];
}

/**
 * Stub the global fetch that resendProvider uses. `failures` scripts each
 * address: n > 0 — the next n attempts return 500 (transient) and decrement;
 * -1 — every attempt returns 400 (a refusal); 0 or missing — success.
 * A key longer than 256 characters returns 400, as Resend does.
 */
function stubResend(failures: Record<string, number>): SendLog {
  const log: SendLog = { attempts: [], delivered: [], keys: [] };
  const fakeFetch = async (
    url: unknown,
    init: { body: string; headers: Record<string, string> },
  ) => {
    if (String(url) !== "https://api.resend.com/emails") {
      throw new Error(`unexpected fetch to ${String(url)}`);
    }
    const body = JSON.parse(init.body) as { to: string[] };
    const to = body.to[0]!;
    log.attempts.push(to);
    const key = init.headers["Idempotency-Key"] ?? "";
    log.keys.push(key);
    // Resend rejects an Idempotency-Key over 256 characters.
    if (key.length > 256) {
      return { ok: false, status: 400, text: async () => "invalid key" };
    }
    const remaining = failures[to] ?? 0;
    if (remaining > 0) {
      failures[to] = remaining - 1;
      return { ok: false, status: 500, text: async () => "internal error" };
    }
    if (remaining === -1) {
      return { ok: false, status: 400, text: async () => "validation failed" };
    }
    log.delivered.push(to);
    return { ok: true, status: 200 };
  };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  return log;
}

function attemptsFor(log: SendLog, to: string): string[] {
  return log.attempts.filter((address) => address === to);
}

describe("retry-safe multi-recipient delivery", () => {
  it.each([
    { ageMs: 31 * 60_000 + 1, expectedSends: 1, label: "stale" },
    {
      ageMs: 31 * 60_000,
      expectedSends: 0,
      label: "live at the lease boundary",
    },
    { ageMs: 1_000, expectedSends: 0, label: "fresh" },
  ])("handles a $label executing marker", async ({ ageMs, expectedSends }) => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    const log = stubResend({});
    const key = `confirmed:${fx.meetingId}:alice@example.com`;
    await t.run(async (ctx) => {
      await ctx.db.insert("idempotencyKeys", {
        key,
        scope: "email_send",
        createdAt: NOW - ageMs,
        metadata: { status: "executing", startedAt: NOW - ageMs },
      });
    });

    // Competing duplicates must not both take over the same stale marker.
    await Promise.all(
      [1, 2].map(() =>
        t.action(internal.emails.deliver.meetingConfirmed, {
          meetingId: fx.meetingId,
          reminderKinds: [],
        }),
      ),
    );
    expect(attemptsFor(log, "alice@example.com")).toHaveLength(expectedSends);
    expect(attemptsFor(log, "bob@example.com")).toHaveLength(1);
    await t.action(internal.emails.deliver.meetingConfirmed, {
      meetingId: fx.meetingId,
      reminderKinds: [],
    });
    expect(attemptsFor(log, "alice@example.com")).toHaveLength(expectedSends);
    const marker = await t.query(internal.system.idempotency.getKey, {
      key,
      scope: "email_send",
    });
    expect(marker?.metadata?.status).toBe(
      expectedSends ? "completed" : "executing",
    );
  });

  it("skips a duplicate while the original provider call is still in flight", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    let entered!: () => void;
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attempts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: { body: string }) => {
        const { to } = JSON.parse(init.body) as { to: string[] };
        attempts.push(to[0]!);
        if (to[0] === "alice@example.com") {
          entered();
          await response;
        }
        return { ok: true, status: 200 };
      }),
    );
    const args = { meetingId: fx.meetingId, reminderKinds: [] };
    const original = t.action(internal.emails.deliver.meetingConfirmed, args);
    await inFlight;
    try {
      await t.action(internal.emails.deliver.meetingConfirmed, args);
      expect(attempts.filter((to) => to === "alice@example.com")).toHaveLength(
        1,
      );
    } finally {
      release();
      await original;
    }
    expect(attempts.sort()).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("still delivers to both after a transient failure on recipient two", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    // Bob's first attempt fails transiently; his retry succeeds.
    const log = stubResend({ "bob@example.com": 1 });

    await t.action(internal.emails.deliver.meetingConfirmed, {
      meetingId: fx.meetingId,
      reminderKinds: ["24h", "10min"],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect([...log.delivered].sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
  });

  it("never sends twice to recipient one, and stays bounded when recipient two never recovers", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    // Bob fails on every attempt; the retry chain must be bounded.
    const log = stubResend({ "bob@example.com": Number.POSITIVE_INFINITY });

    await t.action(internal.emails.deliver.meetingConfirmed, {
      meetingId: fx.meetingId,
      reminderKinds: ["24h", "10min"],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Alice is attempted, delivered, and never retried.
    expect(attemptsFor(log, "alice@example.com")).toHaveLength(1);
    expect(log.delivered).toContain("alice@example.com");
    // Bob's attempts are bounded (initial + retries), not endless.
    expect(attemptsFor(log, "bob@example.com").length).toBeLessThanOrEqual(3);
    expect(attemptsFor(log, "bob@example.com").length).toBeGreaterThan(1);

    // One stable idempotency key per message and recipient: every attempt
    // for a given recipient carries the same key, distinct across people.
    const keyFor = (to: string) =>
      new Set(
        log.attempts.flatMap((attempt, i) =>
          attempt === to ? [log.keys[i]!] : [],
        ),
      );
    const aliceKeys = keyFor("alice@example.com");
    const bobKeys = keyFor("bob@example.com");
    expect(aliceKeys.size).toBe(1);
    expect(bobKeys.size).toBe(1);
    expect([...aliceKeys][0]!).not.toBe("");
    expect([...aliceKeys][0]!).not.toEqual([...bobKeys][0]!);
  });

  it("sends nothing more for a reminder whose meeting was cancelled between attempts", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    const log = stubResend({ "bob@example.com": 1 });

    await t.action(internal.emails.deliver.sendReminder, {
      meetingId: fx.meetingId,
      kind: "10min",
    });

    // Cancel between the first attempt and the scheduled retry.
    await t.run(async (ctx) => {
      await ctx.db.patch(fx.meetingId, { state: "cancelled" });
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The first attempt went out (Alice delivered, Bob transient); the
    // retry re-runs the reminder guard, sees the cancellation, and stops.
    expect(attemptsFor(log, "alice@example.com")).toHaveLength(1);
    expect(attemptsFor(log, "bob@example.com")).toHaveLength(1);
    expect(log.delivered).toEqual(["alice@example.com"]);
  });

  it("fails loudly without recording a refused recipient as sent", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    // Bob's address is refused (4xx); the provider must throw before the
    // idempotency marker can be completed.
    const log = stubResend({ "bob@example.com": -1 });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      t.action(internal.emails.deliver.meetingConfirmed, {
        meetingId: fx.meetingId,
        reminderKinds: ["24h", "10min"],
      }),
    ).rejects.toThrow("dropped:bob@example.com");

    expect(attemptsFor(log, "alice@example.com")).toHaveLength(1);
    expect(attemptsFor(log, "bob@example.com")).toHaveLength(1);
    expect(log.delivered).toEqual(["alice@example.com"]);
    const bobMarker = await t.run((ctx) =>
      ctx.db
        .query("idempotencyKeys")
        .withIndex("by_key_scope", (q) =>
          q
            .eq("key", `confirmed:${fx.meetingId}:bob@example.com`)
            .eq("scope", "email_send"),
        )
        .unique(),
    );
    expect(bobMarker?.metadata?.status).toBe("failed");
  });

  it("bounds the Resend key for a 300-character address", async () => {
    const t = createTestEnvironment();
    const fx = await seedConfirmedMeeting(t);
    const longAddress = `${"a".repeat(288)}@example.com`;
    await t.run(async (ctx) => {
      await ctx.db.patch(fx.bobId, { email: longAddress });
    });
    const log = stubResend({});

    await t.action(internal.emails.deliver.meetingConfirmed, {
      meetingId: fx.meetingId,
      reminderKinds: [],
    });

    const bobIndex = log.attempts.indexOf(longAddress);
    expect(bobIndex).toBeGreaterThanOrEqual(0);
    const bobKey = log.keys[bobIndex]!;
    expect(longAddress).toHaveLength(300);
    expect(bobKey).toMatch(/^confirmed:[0-9a-f]{64}$/);
    expect(bobKey).toHaveLength("confirmed:".length + 64);
    expect(log.delivered).toContain(longAddress);
  });
});
