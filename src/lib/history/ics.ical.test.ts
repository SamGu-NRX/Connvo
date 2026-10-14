// @vitest-environment node
/**
 * Validates the generated ICS against a real RFC 5545 parser (ical.js).
 * The round-trip parser in ./icsRoundTrip.ts is intentionally minimal and
 * independent; this suite is the external check that a real consumer can
 * read what buildCalendarExport writes.
 */

import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { buildCalendarExport } from "./ics";

type VEvent = InstanceType<typeof ICAL.Component>;

function parseToVEvent(ics: string): VEvent {
  const jcal = ICAL.parse(ics);
  const calendar = new ICAL.Component(jcal);
  const vevent = calendar.getFirstSubcomponent("vevent");
  expect(
    vevent,
    "ical.js found no VEVENT in the generated document",
  ).toBeTruthy();
  return vevent!;
}

function textProperty(vevent: VEvent, name: string): string | null {
  const value = vevent.getFirstPropertyValue(name);
  return typeof value === "string" ? value : null;
}

function timePropertyMs(vevent: VEvent, name: string): number | null {
  const value = vevent.getFirstPropertyValue(name);
  return value instanceof ICAL.Time ? value.toJSDate().getTime() : null;
}

const trickyTitle =
  'Design Review: 中文, 😀; with "quotes" and \\backslashes\\';
const trickyDescription =
  "Second line\nafter CRLF\r\nand commas, semicolons; 😀";

describe("buildCalendarExport parsed by ical.js", () => {
  it.each([0, -1, -1000, 1, 876, NaN, Infinity, -Infinity, 1e20, 3e14])(
    "omits DTEND for an interval that cannot end later: %s ms",
    (durationMs) => {
      const vevent = parseToVEvent(
        buildCalendarExport({
          meetingId: "invalid-interval",
          title: "Short meeting",
          scheduledAt: 1700000000123,
          durationMs,
          state: "scheduled",
          updatedAt: 1700000000123,
        })!,
      );
      expect(timePropertyMs(vevent, "dtstart")).toBe(1700000000000);
      expect(vevent.getFirstProperty("dtend")).toBeNull();
    },
  );

  it("keeps a sub-second duration that crosses the next calendar second", () => {
    const vevent = parseToVEvent(
      buildCalendarExport({
        meetingId: "second-boundary",
        title: "Short meeting",
        scheduledAt: 1700000000123,
        durationMs: 877,
        state: "scheduled",
        updatedAt: 1700000000123,
      })!,
    );
    expect(timePropertyMs(vevent, "dtstart")).toBe(1700000000000);
    expect(timePropertyMs(vevent, "dtend")).toBe(1700000001000);
  });

  it("keeps the last four-digit second and omits an end in year 10000", () => {
    for (const [durationMs, expected] of [
      [1000, "99991231T235959Z"],
      [2000, null],
    ] as const) {
      const ics = buildCalendarExport({
        meetingId: "year-boundary",
        title: "Last meeting",
        scheduledAt: Date.parse("9999-12-31T23:59:58Z"),
        durationMs,
        state: "scheduled",
        updatedAt: 1700000000000,
      })!;
      expect(ics).toContain("DTSTART:99991231T235958Z");
      if (expected) expect(ics).toContain(`DTEND:${expected}`);
      else expect(parseToVEvent(ics).getFirstProperty("dtend")).toBeNull();
    }
  });

  it.each(["-000001-12-31T23:59:59Z", "+010000-01-01T00:00:00Z"])(
    "rejects an out-of-range required date: %s",
    (date) => {
      for (const field of ["scheduledAt", "updatedAt"] as const) {
        expect(() =>
          buildCalendarExport({
            meetingId: "invalid-year",
            title: "Meeting",
            scheduledAt: 1700000000000,
            updatedAt: 1700000000000,
            state: "scheduled",
            [field]: Date.parse(date),
          }),
        ).toThrow(RangeError);
      }
    },
  );

  it("round-trips summary, uid, start and end instants through the real parser", () => {
    const ics = buildCalendarExport({
      meetingId: "icalcheck-1",
      title: trickyTitle,
      description: trickyDescription,
      scheduledAt: 1700000000123,
      durationMs: 3_600_000,
      state: "scheduled",
      updatedAt: 1700000100000,
    })!;
    const vevent = parseToVEvent(ics);

    expect(textProperty(vevent, "summary")).toBe(trickyTitle);
    expect(textProperty(vevent, "uid")).toBe("icalcheck-1@connvo-history");
    expect(timePropertyMs(vevent, "dtstart")).toBe(
      Math.floor(1700000000123 / 1000) * 1000,
    );
    expect(timePropertyMs(vevent, "dtend")).toBe(
      Math.floor(1700003600123 / 1000) * 1000,
    );
    expect(textProperty(vevent, "status")).toBe("TENTATIVE");
    // RFC 5545 §3.3.11 normalizes CRLF to the \n escape, so the parsed
    // description carries LF line endings.
    expect(textProperty(vevent, "description")).toBe(
      "Second line\nafter CRLF\nand commas, semicolons; 😀",
    );
  });

  it("sees no DTEND when the duration is unknown, and CANCELLED status", () => {
    const ics = buildCalendarExport({
      meetingId: "icalcheck-2",
      title: "长期项目复盘",
      scheduledAt: 1700000000123,
      state: "cancelled",
      updatedAt: 1700000100000,
    })!;
    const vevent = parseToVEvent(ics);

    expect(vevent.getFirstProperty("dtend")).toBeNull();
    expect(textProperty(vevent, "status")).toBe("CANCELLED");
    expect(textProperty(vevent, "summary")).toBe("长期项目复盘");
  });

  it("unfolds a heavily folded multi-byte title back to the exact value", () => {
    const title = "设计评审会".repeat(40) + " " + "😀".repeat(30);
    const ics = buildCalendarExport({
      meetingId: "icalcheck-3",
      title,
      scheduledAt: 1700000000123,
      durationMs: 1_800_000,
      state: "scheduled",
      updatedAt: 1700000100000,
    })!;
    const vevent = parseToVEvent(ics);

    expect(textProperty(vevent, "summary")).toBe(title);
    expect(timePropertyMs(vevent, "dtstart")).toBe(1_700_000_000_000);
    expect(timePropertyMs(vevent, "dtend")).toBe(1_700_001_800_000);
  });
});

/** The recorded seed for the parser property below; change it deliberately. */
const ICAL_PROPERTY_SEED = 20261012;
const ICAL_PROPERTY_CASES = 2_000;

/** mulberry32: small, seedable, deterministic. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pieces that stress escaping and folding: separators, line breaks, multi-byte text. */
const PIECES = [
  "a",
  "Z",
  " ",
  ",",
  ";",
  ":",
  "\\",
  '"',
  "\n",
  "\r\n",
  "é",
  "中",
  "😀",
  "x".repeat(30),
];

describe(`buildCalendarExport through ical.js, ${ICAL_PROPERTY_CASES} seeded cases (seed ${ICAL_PROPERTY_SEED})`, () => {
  it("every title, description, start and end survives a real parser", () => {
    const random = seeded(ICAL_PROPERTY_SEED);
    const text = (max: number) => {
      let out = "";
      const n = Math.floor(random() * max);
      for (let i = 0; i < n; i++)
        out += PIECES[Math.floor(random() * PIECES.length)];
      return out;
    };
    for (let i = 0; i < ICAL_PROPERTY_CASES; i++) {
      const title = text(60) || "t";
      const description = random() < 0.5 ? null : text(80);
      const scheduledAt =
        Date.UTC(2020, 0, 1) + Math.floor(random() * 10 * 365 * 86_400_000);
      const durationMs =
        random() < 0.3 ? null : Math.floor(random() * 8 * 3_600_000);
      const cancelled = random() < 0.2;
      const label = `seed ${ICAL_PROPERTY_SEED} case ${i}`;
      const vevent = parseToVEvent(
        buildCalendarExport({
          meetingId: `case-${i}`,
          title,
          description,
          scheduledAt,
          durationMs,
          state: cancelled ? "cancelled" : "scheduled",
          updatedAt: scheduledAt,
        })!,
      );
      // §3.3.11: a line break is written as the \n escape, so CRLF and CR
      // come back as LF.
      const normalized = (s: string) => s.replace(/\r\n?/g, "\n");
      expect(textProperty(vevent, "summary"), label).toBe(normalized(title));
      expect(textProperty(vevent, "description"), label).toBe(
        description === null ? null : normalized(description),
      );
      expect(timePropertyMs(vevent, "dtstart"), label).toBe(
        Math.floor(scheduledAt / 1000) * 1000,
      );
      expect(timePropertyMs(vevent, "dtend"), label).toBe(
        durationMs === null ||
          Math.floor((scheduledAt + durationMs) / 1000) <=
            Math.floor(scheduledAt / 1000)
          ? null
          : Math.floor((scheduledAt + durationMs) / 1000) * 1000,
      );
      const end = timePropertyMs(vevent, "dtend");
      if (end !== null) {
        expect(
          end,
          `${label}: RFC 5545 requires end after start`,
        ).toBeGreaterThan(timePropertyMs(vevent, "dtstart")!);
      }
      expect(textProperty(vevent, "status"), label).toBe(
        cancelled ? "CANCELLED" : "TENTATIVE",
      );
    }
  });
});
