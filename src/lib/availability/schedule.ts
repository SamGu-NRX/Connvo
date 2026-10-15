/**
 * Availability math for the one-week free-time grid
 * (cv6-profile-availability).
 *
 * The grid a person taps is 7 days × 48 half-hour slots in their own
 * timezone; storage (convex availabilityBlocks) is the same shape collapsed
 * into runs. Blocks recur every week, so daylight-saving time is resolved
 * when a concrete occurrence is needed — blockOccurrences — not when it is
 * stored.
 */

export type WeeklyBlock = {
  /** 0-6, Sunday = 0, matching Date#getDay. */
  weekday: number;
  /** Minutes from local midnight; multiples of 30, start < end. */
  startMinute: number;
  endMinute: number;
};

export const BLOCK_STEP = 30;
export const SLOTS_PER_DAY = (24 * 60) / BLOCK_STEP; // 48
export const DAYS_PER_WEEK = 7;

/** grid[weekday][slot]; slot 0 is 00:00-00:30 local. */
export type AvailabilityGrid = boolean[][];

export function emptyGrid(): AvailabilityGrid {
  return Array.from({ length: DAYS_PER_WEEK }, () =>
    new Array<boolean>(SLOTS_PER_DAY).fill(false),
  );
}

/** Paints stored blocks back onto the grid. */
export function blocksToGrid(blocks: WeeklyBlock[]): AvailabilityGrid {
  const grid = emptyGrid();
  for (const block of blocks) {
    if (block.weekday < 0 || block.weekday >= DAYS_PER_WEEK) continue;
    const firstSlot = Math.floor(block.startMinute / BLOCK_STEP);
    const lastSlot = Math.ceil(block.endMinute / BLOCK_STEP);
    for (
      let slot = Math.max(0, firstSlot);
      slot < Math.min(SLOTS_PER_DAY, lastSlot);
      slot++
    ) {
      grid[block.weekday][slot] = true;
    }
  }
  return grid;
}

/** Collapses the grid into stored blocks: runs of adjacent half hours. */
export function gridToBlocks(grid: AvailabilityGrid): WeeklyBlock[] {
  const blocks: WeeklyBlock[] = [];
  for (let weekday = 0; weekday < DAYS_PER_WEEK; weekday++) {
    let start: number | null = null;
    for (let slot = 0; slot <= SLOTS_PER_DAY; slot++) {
      const selected = slot < SLOTS_PER_DAY && grid[weekday]?.[slot];
      const minute = slot * BLOCK_STEP;
      if (selected && start === null) {
        start = minute;
      } else if (!selected && start !== null) {
        blocks.push({ weekday, startMinute: start, endMinute: minute });
        start = null;
      }
    }
  }
  return blocks;
}

/** How much free time the grid holds, in minutes. */
export function gridMinutes(grid: AvailabilityGrid): number {
  return gridToBlocks(grid).reduce(
    (sum, b) => sum + (b.endMinute - b.startMinute),
    0,
  );
}

/** True when the string names a timezone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's timezone, or null when it cannot be detected. */
export function detectedTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(key: string, options: Intl.DateTimeFormatOptions) {
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", options);
    formatters.set(key, fmt);
  }
  return fmt;
}

/** The grid slot an instant falls in, in the given timezone. */
export function zoneWeekdayMinute(
  instant: Date,
  timeZone: string,
): { weekday: number; minute: number } {
  const parts = formatter(`wd:${timeZone}`, {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  const hour = Number(get("hour")) % 24;
  const minute = hour * 60 + Number(get("minute"));
  return { weekday, minute };
}

/** The zone's calendar date for an instant. */
function zoneDateParts(
  instant: number,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = formatter(`date:${timeZone}`, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** The offset (ms) the zone stood at an instant: wall clock minus UTC. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const { year, month, day } = zoneDateParts(instant, timeZone);
  const parts = formatter(`hm:${timeZone}`, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(year, month - 1, day, get("hour") % 24, get("minute"));
  return wall - instant;
}

/**
 * The instant a wall-clock minute-of-day falls on, for the calendar date
 * given as UTC day fields. Two-pass offset refinement. Ambiguous wall times
 * (a fall-back repeat) resolve to the earlier instant, and wall times inside
 * a spring-forward gap resolve to the earlier existing wall time — both the
 * conservative choice for free time: an occurrence never starts later than
 * the wall clock promised.
 */
function wallToInstant(
  day: { year: number; month: number; day: number },
  minuteOfDay: number,
  timeZone: string,
): number {
  const naive = Date.UTC(
    day.year,
    day.month - 1,
    day.day,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  let instant = naive - zoneOffsetMs(naive, timeZone);
  instant = naive - zoneOffsetMs(instant, timeZone);
  return instant;
}

/**
 * Expands recurring weekly blocks into concrete UTC intervals that overlap
 * [rangeStart, rangeEnd), in the given timezone. Wall-clock semantics: a
 * 30-minute block keeps its wall minutes, so across a fall-back the same
 * slot lands an hour later in UTC the following week.
 */
export function blockOccurrences(
  blocks: WeeklyBlock[],
  timeZone: string,
  rangeStart: number,
  rangeEnd: number,
): Array<{ start: number; end: number; weekday: number }> {
  if (!(rangeEnd > rangeStart) || blocks.length === 0) return [];
  const byWeekday = new Map<number, WeeklyBlock[]>();
  for (const block of blocks) {
    if (!Number.isInteger(block.weekday)) continue;
    const list = byWeekday.get(block.weekday) ?? [];
    list.push(block);
    byWeekday.set(block.weekday, list);
  }

  const out: Array<{ start: number; end: number; weekday: number }> = [];
  const first = zoneDateParts(rangeStart, timeZone);
  const last = zoneDateParts(rangeEnd - 1, timeZone);
  // Walk zone calendar days with a one-day margin on each side.
  for (
    let cursor = Date.UTC(first.year, first.month - 1, first.day - 1);
    cursor <= Date.UTC(last.year, last.month - 1, last.day + 1);
    cursor += 24 * 60 * 60 * 1000
  ) {
    const day = {
      year: new Date(cursor).getUTCFullYear(),
      month: new Date(cursor).getUTCMonth() + 1,
      day: new Date(cursor).getUTCDate(),
    };
    const weekday = new Date(cursor).getUTCDay();
    for (const block of byWeekday.get(weekday) ?? []) {
      const start = wallToInstant(day, block.startMinute, timeZone);
      const end = wallToInstant(day, block.endMinute, timeZone);
      if (end > start && end > rangeStart && start < rangeEnd) {
        out.push({ start, end, weekday });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
