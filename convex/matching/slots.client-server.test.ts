import { describe, expect, it } from "vitest";

import { blockOccurrences, type WeeklyBlock } from "../../src/lib/availability/schedule";
import { expandWeeklyBlocks } from "./slots";

/**
 * The matcher (convex/matching/slots.ts) and the client editor module
 * (src/lib/availability/schedule.ts) must produce the same instants for the
 * same weekly block. The two used to carry separate wall-clock-to-instant
 * implementations whose refinements probed opposite sides of DST transitions
 * in west-of-UTC zones; both now share one module, and this test pins the
 * agreement across a spring-forward, a fall-back, and a no-DST week.
 */

const block = (weekday: number, start: number, end: number): WeeklyBlock[] => [
  { weekday, startMinute: start, endMinute: end },
];

// Sunday 01:00-04:00 free time: it straddles the wall-clock gap and repeat of
// every zone in the matrix, so any client/server disagreement shows up here.
const sundayMorning = block(0, 60, 240);

const windows = [
  { zone: "America/Chicago", label: "spring-forward week", from: Date.UTC(2026, 2, 1), to: Date.UTC(2026, 2, 15) },
  { zone: "America/Chicago", label: "fall-back week", from: Date.UTC(2025, 9, 26), to: Date.UTC(2025, 10, 9) },
  { zone: "Europe/London", label: "spring-forward week", from: Date.UTC(2026, 2, 22), to: Date.UTC(2026, 3, 5) },
  { zone: "Europe/London", label: "fall-back week", from: Date.UTC(2026, 9, 18), to: Date.UTC(2026, 10, 1) },
  { zone: "Australia/Sydney", label: "southern fall-back week", from: Date.UTC(2026, 2, 29), to: Date.UTC(2026, 3, 12) },
  { zone: "Australia/Sydney", label: "southern spring-forward week", from: Date.UTC(2026, 8, 27), to: Date.UTC(2026, 9, 11) },
  { zone: "Asia/Kolkata", label: "no-DST fortnight", from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 5, 15) },
];

describe("client and server agree on the same free hour", () => {
  for (const { zone, label, from, to } of windows) {
    it(`${zone} ${label}: blockOccurrences and expandWeeklyBlocks produce identical intervals`, () => {
      const days = Math.ceil((to - from) / 86_400_000) + 1;
      const client = blockOccurrences(sundayMorning, zone, from, to);
      const server = expandWeeklyBlocks(sundayMorning, zone, from, days).filter(
        (i) => i.end > from && i.start < to,
      );
      expect(client.map((o) => [o.start, o.end])).toEqual(
        server.map((i) => [i.start, i.end]),
      );
    });
  }

  it("the shared expansion moves a Sunday slot across the US fall-back like any other week", () => {
    // Wall-clock semantics stay intact after unification: the same wall slot
    // lands one hour later in UTC the week after Chicago falls back.
    const client = blockOccurrences(
      block(0, 750, 780),
      "America/Chicago",
      Date.UTC(2025, 9, 26),
      Date.UTC(2025, 10, 10),
    );
    expect(client.map((o) => o.start)).toEqual([
      Date.UTC(2025, 9, 26, 17, 30),
      Date.UTC(2025, 10, 2, 18, 30),
      Date.UTC(2025, 10, 9, 18, 30),
    ]);
  });
});
