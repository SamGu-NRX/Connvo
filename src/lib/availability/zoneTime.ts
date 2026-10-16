/**
 * The one wall-clock <-> instant implementation for availability time math,
 * shared by the client (src/lib/availability/schedule.ts) and the matcher
 * (convex/matching/slots.ts). Pure Intl + Date: no Node, no DOM, so both
 * bundles can import it.
 *
 * Daylight-saving rule, the same in every zone:
 * - A wall time that happens once maps to that instant.
 * - A wall time the fall-back repeats maps to the earlier instant (the first
 *   pass of the clock).
 * - A wall time the spring-forward skips maps to the instant the
 *   pre-transition offset gives, the closest existing time not later than the
 *   wall clock promised.
 *
 * Availability therefore never starts later than the wall clock promised,
 * and the client editor and the matcher cannot disagree about which instant
 * that is. The earlier two-pass refinements converged on whichever side of a
 * transition the zone's UTC sign happened to land — east-of-UTC fall-back
 * repeats resolved late and gap times resolved to opposite hours on the two
 * sides of the client/server split.
 */

export interface WeeklyBlock {
  /** 0-6, 0 = Sunday (JS getDay convention). */
  weekday: number;
  /** Minutes from local midnight; endMinute > startMinute; 30-minute steps. */
  startMinute: number;
  endMinute: number;
}

export interface WallParts {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
    formatters.set(key, fmt);
  }
  return fmt;
}

/** The wall-clock parts of a UTC instant as seen in the zone. */
export function wallParts(timeZone: string, epochMs: number): WallParts {
  const parts = formatter(`parts:${timeZone}`, timeZone, {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  // Weekday from the civil date itself, not from the UTC instant.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    hour: read("hour") % 24,
    minute: read("minute"),
    weekday,
  };
}

/** The zone's offset from UTC at the given instant (east of UTC: positive). */
export function tzOffsetMs(timeZone: string, epochMs: number): number {
  const p = wallParts(timeZone, epochMs);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    readSecond(timeZone, epochMs),
    epochMs % 1000,
  );
  return asUtc - epochMs;
}

function readSecond(timeZone: string, epochMs: number): number {
  const parts = formatter(`second:${timeZone}`, timeZone, {
    second: "2-digit",
  }).formatToParts(new Date(epochMs));
  return Number(parts.find((p) => p.type === "second")?.value ?? 0);
}

/** The grid slot an instant falls in, in the given timezone. */
export function zoneWeekdayMinute(
  instant: Date,
  timeZone: string,
): { weekday: number; minute: number } {
  const p = wallParts(timeZone, instant.getTime());
  return { weekday: p.weekday, minute: p.hour * 60 + p.minute };
}

function wallMatches(
  timeZone: string,
  instant: number,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): boolean {
  const p = wallParts(timeZone, instant);
  return (
    p.year === year &&
    p.month === month &&
    p.day === day &&
    p.hour * 60 + p.minute === minuteOfDay
  );
}

/**
 * The instant a wall-clock time (minute of day on a civil date) falls on, in
 * the zone, under the one documented rule above. Civil-date fields may be
 * any values Date.UTC normalizes (an endMinute of 1440 is the next day's
 * midnight).
 */
export function wallToInstant(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): number {
  const naive = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  const normalized = new Date(naive);
  const targetYear = normalized.getUTCFullYear();
  const targetMonth = normalized.getUTCMonth() + 1;
  const targetDay = normalized.getUTCDate();
  const targetMinute = normalized.getUTCHours() * 60 + normalized.getUTCMinutes();

  // Every offset the zone can hold on this civil date. A zone changes its
  // offset at most once in any 48-hour window, so three probes a day apart
  // see them all. Interpreting the wall time with the largest offset gives
  // the earliest candidate instant, the smallest offset the latest.
  const offsets = new Set<number>();
  for (const probe of [naive - DAY_MS, naive, naive + DAY_MS]) {
    offsets.add(tzOffsetMs(timeZone, probe));
  }
  const earliest = naive - Math.max(...offsets);
  if (wallMatches(timeZone, earliest, targetYear, targetMonth, targetDay, targetMinute)) {
    return earliest;
  }
  const latest = naive - Math.min(...offsets);
  if (wallMatches(timeZone, latest, targetYear, targetMonth, targetDay, targetMinute)) {
    return latest;
  }
  // The wall time does not exist (a spring-forward gap): resolve on the
  // pre-transition side, never later than the wall clock promised.
  return earliest;
}

export interface ZoneOccurrence {
  /** UTC epoch ms. */
  start: number;
  end: number;
  weekday: number;
}

/**
 * Expand recurring weekly blocks into concrete UTC intervals over the civil
 * dates walked by the UTC-midnight cursors [firstDayUtcMs, lastDayUtcMs]
 * (inclusive), sorted by start. Both expanders in the codebase — the client
 * blockOccurrences and the matcher expandWeeklyBlocks — are thin range
 * wrappers over this walk.
 */
export function occurrencesOnCivilDays(
  blocks: WeeklyBlock[],
  timeZone: string,
  firstDayUtcMs: number,
  lastDayUtcMs: number,
): ZoneOccurrence[] {
  const byWeekday = new Map<number, WeeklyBlock[]>();
  for (const block of blocks) {
    if (!Number.isInteger(block.weekday) || block.weekday < 0 || block.weekday >= 7) {
      continue;
    }
    if (block.endMinute <= block.startMinute) continue;
    const list = byWeekday.get(block.weekday) ?? [];
    list.push(block);
    byWeekday.set(block.weekday, list);
  }

  const out: ZoneOccurrence[] = [];
  for (
    let cursor = firstDayUtcMs;
    cursor <= lastDayUtcMs;
    cursor += DAY_MS
  ) {
    const date = new Date(cursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const weekday = date.getUTCDay();
    for (const block of byWeekday.get(weekday) ?? []) {
      const start = wallToInstant(timeZone, year, month, day, block.startMinute);
      const end = wallToInstant(timeZone, year, month, day, block.endMinute);
      if (end > start) out.push({ start, end, weekday });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
