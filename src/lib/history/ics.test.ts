// @vitest-environment node
/**
 * Property round-trip tests for the RFC 5545 ICS exporter, plus fixed-vector
 * gold output, 75-octet boundary tests, and injection canaries.
 *
 * Determinism: the PRNG is mulberry32 seeded with SEED below. A failure
 * message always carries the seed, so any failing case is replayable.
 */

import { describe, expect, it } from "vitest";
import { buildCalendarExport, type CalendarExportInput } from "./ics";
import { parseIcs, parseIcsUtc } from "./icsRoundTrip";

const SEED = 0x5eed1337;
const PROPERTY_CASES = 300;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const encoder = new TextEncoder();
function octets(value: string): number {
  return encoder.encode(value).length;
}

/**
 * RFC 5545 §3.3.11 canonicalizes every CR, LF and CRLF in TEXT to the same
 * `\n` escape, so a value containing raw CR/CRLF round-trips to its
 * LF-normalized form — not byte-identical. Assertions compare against this
 * normalization; LF-only values are unaffected and stay char-for-char exact.
 */
function normalizeNewlinesForIcs(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

const TITLE_FRAGMENTS = [
  "设计评审",
  "회의록",
  "ミーティング",
  "Перезвон",
  "😀",
  "🚀🔥",
  "👍🏽",
  "cafe\u0301\u0302",
  "A\u030a",
  ",",
  ";",
  "\\",
  '"',
  ":",
  "\n",
  "\r\n",
  "\r",
  "plain",
  " ",
  "SUMMARY:evil",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:x@y",
];

const MEETING_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

interface GeneratedCase {
  label: string;
  input: CalendarExportInput;
}

function generateCase(random: () => number, index: number): GeneratedCase {
  const long = random() < 0.5;

  let title = "";
  const titleLength = long ? 200 + Math.floor(random() * 300) : Math.floor(random() * 40);
  while (title.length < titleLength) {
    title += TITLE_FRAGMENTS[Math.floor(random() * TITLE_FRAGMENTS.length)];
  }

  const descriptionValue =
    random() < 0.5
      ? TITLE_FRAGMENTS.slice(0, 1 + Math.floor(random() * TITLE_FRAGMENTS.length)).join("") +
        (long ? TITLE_FRAGMENTS.slice().reverse().join("") : "")
      : random() < 0.5
        ? null
        : undefined;

  // meetingId mirrors a Convex system id: a safe token, not user text.
  let meetingId = "";
  for (let i = 0; i < 20; i++) {
    meetingId += MEETING_ID_ALPHABET[Math.floor(random() * MEETING_ID_ALPHABET.length)];
  }

  const scheduledAt = Math.floor(
    Date.UTC(1990, 0, 1) + random() * (Date.UTC(2050, 0, 1) - Date.UTC(1990, 0, 1)),
  );
  const durationMs =
    random() < 0.5 ? 5 + Math.floor(random() * 7_200_000) : random() < 0.5 ? null : undefined;
  const updatedAt = scheduledAt - Math.floor(random() * 86_400_000);

  const input: CalendarExportInput = {
    meetingId,
    title,
    description: descriptionValue,
    scheduledAt,
    durationMs,
    state: random() < 0.5 ? "scheduled" : "cancelled",
    updatedAt,
  };

  return { label: `case #${index}`, input };
}

describe("buildCalendarExport", () => {
  it("returns null when the meeting has no scheduled time", () => {
    const result = buildCalendarExport({
      meetingId: "abc123",
      title: "Sync",
      scheduledAt: null,
      state: "scheduled",
      updatedAt: Date.UTC(2024, 0, 1),
    });
    expect(result).toBeNull();
  });

  it("renders one known input as an exact byte-for-byte gold document", () => {
    const ics = buildCalendarExport({
      meetingId: "m123",
      title: "Design Review",
      description: null,
      scheduledAt: 1700000000123, // 2023-11-14T22:13:20.123Z -> floored
      durationMs: 3_600_000,
      state: "scheduled",
      updatedAt: 1700000100000,
    });
    expect(ics).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Connvo//Meeting Export//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        "UID:m123@connvo-history",
        "DTSTAMP:20231114T221500Z",
        "DTSTART:20231114T221320Z",
        "DTEND:20231114T231320Z",
        "SUMMARY:Design Review",
        "STATUS:TENTATIVE",
        "SEQUENCE:0",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("emits CANCELLED status for cancelled meetings in the gold structure", () => {
    const parsed = parseIcs(
      buildCalendarExport({
        meetingId: "m123",
        title: "Design Review",
        scheduledAt: 1700000000123,
        state: "cancelled",
        updatedAt: 1700000100000,
      })!,
    );
    expect(parsed.status).toBe("CANCELLED");
    expect(parsed.count("DTEND")).toBe(0);
    expect(parsed.description).toBeNull();
  });

  it("folds at 75 octets without splitting multi-byte characters", () => {
    // SUMMARY: is 8 octets; 67 ASCII chars = exactly 75, 68 must fold.
    for (const [label, title] of [
      ["exactly 75 octets", "A".repeat(67)],
      ["one octet over", "A".repeat(68)],
      ["multi-byte CJK over limit", "中".repeat(25)], // 75 CJK octets + 8 prefix
      ["4-byte emoji over limit", "😀".repeat(20)],
      ["long ascii", "A".repeat(500)],
      ["long emoji", "😀".repeat(100)],
    ] as const) {
      const ics = buildCalendarExport({
        meetingId: "foldcheck",
        title,
        scheduledAt: 1700000000123,
        state: "scheduled",
        updatedAt: 1700000100000,
      })!;
      const physicalLines = ics.split("\r\n");
      for (const line of physicalLines) {
        expect(octets(line), `seed ${SEED} ${label}: line exceeds 75 octets`).toBeLessThanOrEqual(75);
      }
      // No bare LF/CR anywhere: what remains after removing CRLFs is line content.
      expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      const parsed = parseIcs(ics);
      expect(parsed.summary, `seed ${SEED} ${label}: folded title did not round-trip`).toBe(title);
    }
  });

  it("keeps DTEND out unless a duration is actually known", () => {
    const withoutDuration = parseIcs(
      buildCalendarExport({
        meetingId: "m1",
        title: "No duration",
        scheduledAt: 1700000000123,
        state: "scheduled",
        updatedAt: 1700000100000,
      })!,
    );
    expect(withoutDuration.dtend).toBeNull();

    const undefinedDuration = parseIcs(
      buildCalendarExport({
        meetingId: "m1",
        title: "No duration",
        scheduledAt: 1700000000123,
        durationMs: undefined,
        state: "scheduled",
        updatedAt: 1700000100000,
      })!,
    );
    expect(undefinedDuration.dtend).toBeNull();

    const zeroDuration = parseIcs(
      buildCalendarExport({
        meetingId: "m1",
        title: "Zero duration",
        scheduledAt: 1700000000123,
        durationMs: 0,
        state: "scheduled",
        updatedAt: 1700000100000,
      })!,
    );
    expect(zeroDuration.dtend).toBeNull();
  });

  it("is deterministic: two builds of the same meeting are byte-identical", () => {
    const input: CalendarExportInput = {
      meetingId: "det-check",
      title: "Repeatable, really repeatable, really repeatable, really repeatable, really repeatable",
      description: "second line\nwith an escape: ;,\\ and unicode 😀",
      scheduledAt: 1700000000123,
      durationMs: 1_800_000,
      state: "scheduled",
      updatedAt: 1700000100000,
    };
    const first = buildCalendarExport(input);
    const second = buildCalendarExport(input);
    expect(second).toBe(first);
    expect(parseIcs(first!).uid).toBe("det-check@connvo-history");
  });

  it("contains injection canaries verbatim as one SUMMARY property", () => {
    const exactCanaries = [
      "Real\nSUMMARY:evil",
      "Real\\nSUMMARY:evil", // literal backslash + n in the stored title
      "设计\nSUMMARY:中文注入",
    ];
    const crCanaries = [
      "Real\r\nSUMMARY:evil\r\nATTENDEE:mailto:evil@example.com",
      "Bare\rDTEND:20240101T000000Z",
      "Fold\r\n END:VEVENT",
      "设计\r\nSUMMARY:中文注入",
    ];
    for (const title of exactCanaries) {
      const ics = buildCalendarExport({
        meetingId: "canary",
        title,
        scheduledAt: 1700000000123,
        state: "scheduled",
        updatedAt: 1700000100000,
      })!;
      expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      const parsed = parseIcs(ics);
      expect(parsed.count("SUMMARY"), `seed ${SEED}: title injected extra SUMMARY`).toBe(1);
      expect(parsed.count("ATTENDEE")).toBe(0);
      expect(parsed.count("DTEND")).toBe(0);
      expect(parsed.count("END")).toBe(0);
      expect(parsed.summary, `seed ${SEED}: canary title did not survive verbatim`).toBe(title);
    }
    for (const title of crCanaries) {
      const ics = buildCalendarExport({
        meetingId: "canary",
        title,
        scheduledAt: 1700000000123,
        state: "scheduled",
        updatedAt: 1700000100000,
      })!;
      expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      const parsed = parseIcs(ics);
      expect(parsed.count("SUMMARY"), `seed ${SEED}: title injected extra SUMMARY`).toBe(1);
      expect(parsed.count("ATTENDEE")).toBe(0);
      expect(parsed.count("DTEND")).toBe(0);
      expect(parsed.count("END")).toBe(0);
      expect(parsed.summary, `seed ${SEED}: canary title did not survive normalized`).toBe(
        normalizeNewlinesForIcs(title),
      );
    }
  });

  it("round-trips every field across randomized unicode-heavy meetings", () => {
    const random = mulberry32(SEED);
    for (let index = 0; index < PROPERTY_CASES; index++) {
      const generated = generateCase(random, index);
      const { input } = generated;
      const label = `seed ${SEED} ${generated.label} (meetingId ${input.meetingId})`;

      const ics = buildCalendarExport(input);
      expect(ics, `${label}: expected a document for a scheduled meeting`).toBeTruthy();
      // The generator always provides a time; narrow explicitly so the
      // instants below type-check as numbers.
      if (ics === null || input.scheduledAt === null) {
        throw new Error(`${label}: generator produced a case without a scheduled time`);
      }
      const scheduledAtMs: number = input.scheduledAt;

      const physicalLines = ics.split("\r\n");
      for (const line of physicalLines) {
        expect(octets(line), `${label}: line over 75 octets`).toBeLessThanOrEqual(75);
      }
      expect(ics.replace(/\r\n/g, ""), `${label}: bare LF/CR present`).not.toMatch(/[\r\n]/);

      const parsed = parseIcs(ics);
      expect(parsed.count("SUMMARY"), `${label}: SUMMARY property count`).toBe(1);
      expect(parsed.count("VEVENT"), `${label}: VEVENT property count`).toBe(0);

      expect(parsed.summary, `${label}: title round-trip`).toBe(normalizeNewlinesForIcs(input.title));
      if (!input.title.includes("\r")) {
        expect(parsed.summary, `${label}: LF-only title must be exact`).toBe(input.title);
      }
      expect(parsed.uid, `${label}: stable UID`).toBe(`${input.meetingId}@connvo-history`);
      expect(parseIcsUtc(parsed.dtstart), `${label}: DTSTART instant`).toBe(
        Math.floor(scheduledAtMs / 1000) * 1000,
      );
      expect(parseIcsUtc(parsed.dtstamp), `${label}: DTSTAMP from updatedAt`).toBe(
        Math.floor(input.updatedAt / 1000) * 1000,
      );

      if (
        input.durationMs != null &&
        Math.floor((scheduledAtMs + input.durationMs) / 1000) > Math.floor(scheduledAtMs / 1000)
      ) {
        expect(parseIcsUtc(parsed.dtend), `${label}: DTEND instant`).toBe(
          Math.floor((scheduledAtMs + input.durationMs) / 1000) * 1000,
        );
      } else {
        expect(parsed.dtend, `${label}: DTEND must be absent without duration`).toBeNull();
      }

      if (input.description != null) {
        expect(parsed.description, `${label}: description round-trip`).toBe(
          normalizeNewlinesForIcs(input.description),
        );
      } else {
        expect(parsed.description, `${label}: description must be absent`).toBeNull();
      }

      expect(parsed.status, `${label}: STATUS mapping`).toBe(
        input.state === "cancelled" ? "CANCELLED" : "TENTATIVE",
      );
      expect(parsed.sequence, `${label}: SEQUENCE`).toBe("0");

      const secondBuild = buildCalendarExport(input);
      expect(secondBuild, `${label}: rebuild is byte-identical`).toBe(ics);
      expect(parseIcs(secondBuild!).uid, `${label}: UID stable across builds`).toBe(parsed.uid);
    }
  });
});
