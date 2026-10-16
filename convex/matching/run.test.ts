/**
 * Booked time in a matcher run (convex/matching/run.ts) on a real in-memory
 * Convex runtime. A chat can be confirmed between the snapshot and the
 * write, so the write must recheck live bookings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createMeetingRecords } from "@convex/meetings/lifecycle";
import { createTestEnvironment } from "../../test/convex/helpers";

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const SLOT = Date.UTC(2026, 9, 17, 9, 0);
const HALF_HOUR = 30 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

function draft(userAId: Id<"users">, userBId: Id<"users">, scheduledAt: number, alternatives: number[]) {
  return {
    userAId,
    userBId,
    scheduledAt,
    alternatives,
    reasons: ["You both love rust"],
    firstQuestion: "What are you building this week?",
    score: 0.7,
    sharedInterestKeys: ["rust"],
    goalPair: "peers:peers",
  };
}

describe("writeProposals", () => {
  it("rechecks bookings made after the snapshot", async () => {
    const t = createTestEnvironment();
    const [alice, bob, cara, dan] = await t.run(async (ctx) => {
      const ids: Id<"users">[] = [];
      for (const name of ["Alice", "Bob", "Cara", "Dan"]) {
        ids.push(
          await ctx.db.insert("users", {
            workosUserId: name,
            email: `${name.toLowerCase()}@example.com`,
            displayName: name,
            isActive: true,
            createdAt: NOW,
            updatedAt: NOW,
          }),
        );
      }
      // Alice and Dan confirm a chat at SLOT after the snapshot was taken.
      await createMeetingRecords(ctx, {
        organizerId: ids[0],
        title: "Connvo match: Alice & Dan",
        scheduledAt: SLOT,
        duration: HALF_HOUR,
        webrtcEnabled: true,
        recordingEnabled: false,
        participantIds: [ids[0], ids[3]],
      });
      return ids;
    });

    const result = await t.mutation(internal.matching.run.writeProposals, {
      drafts: [
        draft(alice, bob, SLOT + 15 * 60_000, [SLOT + 2 * HALF_HOUR]),
        draft(cara, alice, SLOT + HALF_HOUR, [SLOT, SLOT + 2 * HALF_HOUR]),
      ],
      runAt: NOW,
    });

    expect(result).toEqual({ created: 1, skipped: 1 });
    const rows = await t.run((ctx) => ctx.db.query("matchProposals").collect());
    expect(rows.map((r) => [r.scheduledAt, r.alternatives])).toEqual([
      [SLOT + HALF_HOUR, [SLOT + 2 * HALF_HOUR]],
    ]);
  });
});
