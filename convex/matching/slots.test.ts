import { describe, expect, it } from "vitest";

import {
  expandWeeklyBlocks,
  hasFreeBlockSoon,
  sharedSlots,
  type WeeklyBlock,
} from "./slots";

// A zone with no DST: slots must sit at the same wall minutes all year.
const noDst = (start: number, end: number): WeeklyBlock[] => [
  { weekday: 1, startMinute: start, endMinute: end },
];

describe("toUtcIntervals", () => {
  it("keeps the same local wall time in a zone without DST", () => {
    // Monday 09:00-09:30 in Kathmandu (+05:45): 03:15 UTC.
    const intervals = expandWeeklyBlocks(
      noDst(9 * 60, 9 * 60 + 30),
      "Asia/Kathmandu",
      Date.UTC(2026, 0, 5),
      14,
    );
    const monday0900 = Date.UTC(2026, 0, 5) + 3 * 3600_000 + 15 * 60_000;
    expect(intervals.length).toBeGreaterThanOrEqual(2);
    expect(intervals[0].start).toBe(monday0900);
    expect(intervals[0].end).toBe(monday0900 + 30 * 60_000);
  });

  it("shifts a slot by one hour across the spring DST change", () => {
    // Sunday March 8 2026 is the US spring-forward date; two Mondays cover it.
    const intervals = expandWeeklyBlocks(
      noDst(9 * 60, 9 * 60 + 30),
      "America/New_York",
      Date.UTC(2026, 2, 2),
      15,
    );
    // Before the change: EST (-5) -> 14:00 UTC. After: EDT (-4) -> 13:00 UTC.
    const starts = intervals.map((i) => new Date(i.start).getUTCHours());
    expect(starts).toContain(14);
    expect(starts).toContain(13);
  });
});

describe("sharedSlots", () => {
  const now = Date.UTC(2026, 0, 5, 12, 0); // Monday noon UTC.

  it("proposes 30-minute shared slots", () => {
    const a = noDst(9 * 60, 10 * 60);
    const b = noDst(9 * 60 + 15, 10 * 60);
    const slots = sharedSlots(a, "UTC", b, "UTC", {
      now,
      minLeadMs: 60 * 60_000,
      maxSlots: 4,
      horizonDays: 7,
    });
    // One full 30-minute meeting fits the 09:15-10:00 overlap: 09:15 only
    // (09:45 would end at 10:15, past b's availability).
    expect(slots).toEqual([Date.UTC(2026, 0, 12, 9, 15)]);
    for (const slot of slots) {
      expect(slot - now).toBeGreaterThanOrEqual(60 * 60_000);
    }
  });

  it("proposes nothing when free time never overlaps", () => {
    const a = noDst(9 * 60, 10 * 60);
    const b = noDst(11 * 60, 12 * 60);
    expect(
      sharedSlots(a, "UTC", b, "UTC", {
        now,
        minLeadMs: 60 * 60_000,
        maxSlots: 4,
        horizonDays: 7,
      }),
    ).toEqual([]);
  });

  it("proposes nothing when the blocks overlap for under 30 minutes", () => {
    const a = noDst(9 * 60, 10 * 60);
    const b = noDst(9 * 60 + 40, 10 * 60 + 30); // 20 min overlap
    expect(
      sharedSlots(a, "UTC", b, "UTC", {
        now,
        minLeadMs: 60 * 60_000,
        maxSlots: 4,
        horizonDays: 7,
      }),
    ).toEqual([]);
  });

  it("respects the 18-hour lead time", () => {
    const a = noDst(13 * 60, 14 * 60); // today 13:00 UTC, 1h out
    const b = noDst(13 * 60, 14 * 60);
    const slots = sharedSlots(a, "UTC", b, "UTC", {
      now,
      minLeadMs: 18 * 60 * 60_000,
      maxSlots: 4,
      horizonDays: 10,
    });
    // The Monday 13:00 slot is too soon; the next Mondays qualify.
    for (const slot of slots) {
      expect(slot - now).toBeGreaterThanOrEqual(18 * 60 * 60_000);
    }
    expect(slots.length).toBeGreaterThan(0);
  });

  it("rounds a slot cut by the lead time up to the block's 30-minute grid", () => {
    // Free 19:00-22:00; the lead time ends at 20:13, mid-block.
    const a = noDst(19 * 60, 22 * 60);
    const b = noDst(19 * 60, 22 * 60);
    const at = Date.UTC(2026, 0, 5, 20, 13);
    const slots = sharedSlots(a, "UTC", b, "UTC", {
      now: at,
      minLeadMs: 0,
      maxSlots: 2,
      horizonDays: 1,
    });
    expect(slots).toEqual([Date.UTC(2026, 0, 5, 20, 30), Date.UTC(2026, 0, 5, 21, 0)]);
  });

  it("still finds slots across the spring DST change", () => {
    // Friday Feb 27 2026 12:00 UTC; the change is Sunday Mar 8, so an 11-day
    // horizon brackets it with one EST Monday and one EDT Monday.
    const dstNow = Date.UTC(2026, 1, 27, 12, 0);
    const a = noDst(9 * 60, 10 * 60);
    const b = noDst(9 * 60, 10 * 60);
    const slots = sharedSlots(a, "America/New_York", b, "America/New_York", {
      now: dstNow,
      minLeadMs: 18 * 60 * 60_000,
      maxSlots: 4,
      // 11 days so the second Monday (Mar 16, 13:00 UTC start) is inside the
      // horizon; 10 days would cap it at Mar 16 12:00 UTC.
      horizonDays: 11,
    });
    expect(slots.length).toBe(4);
    // 09:00 EST is 14:00 UTC; 09:00 EDT is 13:00 UTC.
    const hours = new Set(slots.map((s) => new Date(s).getUTCHours()));
    expect(hours.has(14)).toBe(true);
    expect(hours.has(13)).toBe(true);
  });

  it("excludes a 15:00+ slot pair whose window misses the other's morning", () => {
    // A is free Monday 09:00-09:30 UTC; B only Wednesday. No shared slots.
    const a = noDst(9 * 60, 9 * 60 + 30);
    const b: WeeklyBlock[] = [{ weekday: 3, startMinute: 9 * 60, endMinute: 10 * 60 }];
    expect(
      sharedSlots(a, "UTC", b, "UTC", {
        now,
        minLeadMs: 60 * 60_000,
        maxSlots: 4,
        horizonDays: 7,
      }),
    ).toEqual([]);
  });
});

describe("hasFreeBlockSoon", () => {
  it("is true when a free block starts within the horizon", () => {
    const now = Date.UTC(2026, 0, 5, 12, 0);
    expect(hasFreeBlockSoon(noDst(9 * 60, 10 * 60), "UTC", now)).toBe(true);
  });

  it("is false with no blocks", () => {
    const now = Date.UTC(2026, 0, 5, 12, 0);
    expect(hasFreeBlockSoon([], "UTC", now)).toBe(false);
  });
});
