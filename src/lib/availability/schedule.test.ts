import { describe, expect, it } from "vitest";
import {
  blockOccurrences,
  blocksToGrid,
  gridMinutes,
  gridToBlocks,
  isValidTimeZone,
  zoneWeekdayMinute,
} from "./schedule";

// The 2025 US fall-back: 2025-11-02 06:00 UTC, EDT (UTC-4) becomes EST (UTC-5).
const NY = "America/New_York";

describe("availability grid math", () => {
  it("collapses adjacent half-hour taps into stored runs and paints them back", () => {
    const grid = blocksToGrid([
      { weekday: 3, startMinute: 750, endMinute: 810 },
      { weekday: 3, startMinute: 810, endMinute: 870 },
      { weekday: 0, startMinute: 540, endMinute: 570 },
    ]);
    expect(gridToBlocks(grid)).toEqual([
      { weekday: 0, startMinute: 540, endMinute: 570 },
      { weekday: 3, startMinute: 750, endMinute: 870 },
    ]);
    expect(gridMinutes(grid)).toBe(150);
  });

  it("the grid round-trip is stable", () => {
    const blocks = [
      { weekday: 1, startMinute: 0, endMinute: 1440 },
      { weekday: 6, startMinute: 1290, endMinute: 1440 },
    ];
    const grid = blocksToGrid(blocks);
    expect(gridToBlocks(blocksToGrid(gridToBlocks(grid)))).toEqual(
      gridToBlocks(grid),
    );
  });
});

describe("timezone math across a daylight-saving week", () => {
  it("maps the same wall slot to different UTC times either side of the change", () => {
    // Sunday 2025-10-26, 12:30 local (EDT, UTC-4).
    const before = blockOccurrences(
      [{ weekday: 0, startMinute: 750, endMinute: 780 }],
      NY,
      Date.UTC(2025, 9, 26),
      Date.UTC(2025, 9, 27),
    );
    expect(before.map((o) => o.start)).toEqual([Date.UTC(2025, 9, 26, 16, 30)]);

    // Sunday 2025-11-02, the same 12:30 wall clock is now EST (UTC-5).
    const after = blockOccurrences(
      [{ weekday: 0, startMinute: 750, endMinute: 780 }],
      NY,
      Date.UTC(2025, 10, 2),
      Date.UTC(2025, 10, 3),
    );
    expect(after.map((o) => o.start)).toEqual([Date.UTC(2025, 10, 2, 17, 30)]);
  });

  it("one expansion across the change produces both weeks with both offsets", () => {
    const occurrences = blockOccurrences(
      [{ weekday: 0, startMinute: 750, endMinute: 780 }],
      NY,
      Date.UTC(2025, 9, 26),
      Date.UTC(2025, 10, 10),
    );
    expect(occurrences.map((o) => o.start)).toEqual([
      Date.UTC(2025, 9, 26, 16, 30), // EDT
      Date.UTC(2025, 10, 2, 17, 30), // EST — one hour later in UTC
      Date.UTC(2025, 10, 9, 17, 30), // EST
    ]);
  });

  it("an instant during the repeated hour maps back to the Sunday slot", () => {
    // 2025-11-02 05:30 UTC is 01:30 EDT; 06:30 UTC is 01:30 EST an hour
    // later on the wall. Both are Sunday, 01:30.
    expect(zoneWeekdayMinute(new Date("2025-11-02T05:30:00Z"), NY)).toEqual({
      weekday: 0,
      minute: 90,
    });
    expect(zoneWeekdayMinute(new Date("2025-11-02T06:30:00Z"), NY)).toEqual({
      weekday: 0,
      minute: 90,
    });
  });

  it("a weekday slot stays on its weekday when UTC crosses midnight", () => {
    // Sunday 12:30 in India is 07:00 UTC — the same UTC day. Sunday 01:00 in
    // New York is 06:00 UTC. A Sunday 23:30-24:00 block in Tokyo is 14:30 UTC
    // the same Sunday; a Monday 01:00 block in Auckland is Sunday 12:00 UTC —
    // the stored weekday must follow the zone, not UTC.
    const auckland = blockOccurrences(
      [{ weekday: 1, startMinute: 60, endMinute: 90 }],
      "Pacific/Auckland",
      Date.UTC(2025, 10, 1),
      Date.UTC(2025, 10, 4),
    );
    // Monday 01:00 local (NZDT, UTC+13) = Sunday 12:00 UTC (2025-11-02).
    expect(auckland.map((o) => o.start)).toEqual([
      Date.UTC(2025, 10, 2, 12, 0),
    ]);
  });
});

describe("timezone names", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
