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
  expect(vevent, "ical.js found no VEVENT in the generated document").toBeTruthy();
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

const trickyTitle = 'Design Review: 中文, 😀; with "quotes" and \\backslashes\\';
const trickyDescription = "Second line\nafter CRLF\r\nand commas, semicolons; 😀";

describe("buildCalendarExport parsed by ical.js", () => {
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
    expect(timePropertyMs(vevent, "dtstart")).toBe(Math.floor(1700000000123 / 1000) * 1000);
    expect(timePropertyMs(vevent, "dtend")).toBe(Math.floor(1700003600123 / 1000) * 1000);
    expect(textProperty(vevent, "status")).toBe("TENTATIVE");
    // RFC 5545 §3.3.11 normalizes CRLF to the \n escape, so the parsed
    // description carries LF line endings.
    expect(textProperty(vevent, "description")).toBe("Second line\nafter CRLF\nand commas, semicolons; 😀");
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
