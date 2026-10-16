/**
 * Time-slot math for recurring weekly availability across timezones.
 *
 * availabilityBlocks rows are wall-clock minutes in one person's own IANA
 * timezone. To find times two people share, each person's blocks are expanded
 * into absolute UTC intervals over a horizon, and the intersections are cut
 * into 30-minute meeting slots. Every conversion goes through Intl with the
 * IANA zone, so daylight-saving changes fall out of the offset arithmetic:
 * a block stays at the same wall-clock time and moves in UTC when the zone's
 * offset changes.
 */

export interface WeeklyBlock {
  /** 0-6, 0 = Sunday (JS getDay convention). */
  weekday: number;
  /** Minutes from local midnight; endMinute > startMinute; 30-minute steps. */
  startMinute: number;
  endMinute: number;
}

export interface Interval {
  /** UTC epoch ms. */
  start: number;
  end: number;
}

export interface SharedSlotOptions {
  /** Reference "now" (UTC epoch ms). */
  now: number;
  /** Slots must start at least this far in the future (18h per the plan). */
  minLeadMs?: number;
  /** Meeting length; 30 minutes per the plan. */
  slotMs?: number;
  /** How many shared slots to return (proposed time + alternatives). */
  maxSlots?: number;
  /** How many local calendar days ahead to expand the weekly grid. */
  horizonDays?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
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

/** The wall-clock parts of a UTC instant as seen in the zone. */
export function wallParts(timeZone: string, epochMs: number): WallParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  // Weekday from the civil date itself, not from the UTC instant.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour: read("hour"), minute: read("minute"), weekday };
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
    0,
    epochMs % 1000,
  );
  return asUtc - epochMs;
}

/**
 * A local wall-clock time (minute of day on a civil date) as a UTC instant.
 * Two passes converge on the right offset; for wall times a DST transition
 * skips or repeats, this deterministically resolves to one side.
 */
export function wallTimeToEpoch(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): number {
  const guess = Date.UTC(year, month - 1, day) + minuteOfDay * 60_000;
  const offset = tzOffsetMs(timeZone, tzOffsetMs(timeZone, guess) + guess);
  return guess - offset;
}

/**
 * Expand recurring weekly blocks into absolute UTC intervals over the next
 * `days` local calendar dates, sorted by start. Past or in-progress blocks are
 * kept only if they still have future time.
 */
export function expandWeeklyBlocks(
  blocks: WeeklyBlock[],
  timeZone: string,
  fromEpoch: number,
  days: number,
): Interval[] {
  if (!timeZone || blocks.length === 0 || days <= 0) return [];
  const start = wallParts(timeZone, fromEpoch);
  const intervals: Interval[] = [];
  for (let i = 0; i < days; i++) {
    // Walk civil dates on the UTC calendar; weekday comes from the date.
    const dateUtc = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const year = dateUtc.getUTCFullYear();
    const month = dateUtc.getUTCMonth() + 1;
    const day = dateUtc.getUTCDate();
    const weekday = dateUtc.getUTCDay();
    for (const block of blocks) {
      if (block.weekday !== weekday) continue;
      if (block.endMinute <= block.startMinute) continue;
      intervals.push({
        start: wallTimeToEpoch(timeZone, year, month, day, block.startMinute),
        end: wallTimeToEpoch(timeZone, year, month, day, block.endMinute),
      });
    }
  }
  return intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Intersections of two sorted interval lists. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end <= b[j].end) i++;
    else j++;
  }
  return out;
}

/**
 * The earliest shared meeting slots for two people, in UTC epoch ms, sorted.
 * The first entry is the proposed time; the rest are the alternatives.
 */
export function sharedSlots(
  aBlocks: WeeklyBlock[],
  aTimeZone: string,
  bBlocks: WeeklyBlock[],
  bTimeZone: string,
  options: SharedSlotOptions,
): number[] {
  const {
    now,
    minLeadMs = 18 * 60 * 60 * 1000,
    slotMs = 30 * 60 * 1000,
    maxSlots = 4,
    horizonDays = 10,
  } = options;
  const earliest = now + minLeadMs;
  // One extra week guarantees every recurring block has a future occurrence
  // even when this week's has already passed; the horizon cap below keeps the
  // proposed slots inside the requested window.
  const horizonEnd = now + horizonDays * 86_400_000;
  const a = expandWeeklyBlocks(aBlocks, aTimeZone, now, horizonDays + 7).filter(
    (i) => i.end > earliest && i.start <= horizonEnd,
  );
  const b = expandWeeklyBlocks(bBlocks, bTimeZone, now, horizonDays + 7).filter(
    (i) => i.end > earliest && i.start <= horizonEnd,
  );
  const slots: number[] = [];
  for (const overlap of intersectIntervals(a, b)) {
    // When the lead time cuts into an overlap, round up to the next slot step
    // from the overlap's start; otherwise "now + 18h" leaks into the proposal
    // as an odd minute like 8:13 PM.
    const first =
      overlap.start >= earliest
        ? overlap.start
        : overlap.start + Math.ceil((earliest - overlap.start) / slotMs) * slotMs;
    for (let s = first; s + slotMs <= overlap.end; s += slotMs) {
      slots.push(s);
      if (slots.length >= maxSlots) return slots;
    }
  }
  return slots;
}

/** Does this person have any shared-capable free block in the next 7 days? */
export function hasFreeBlockSoon(
  blocks: WeeklyBlock[],
  timeZone: string,
  now: number,
  days = 7,
): boolean {
  return (
    // One extra week so a block whose occurrence has passed this week still
    // counts as soon free time.
    expandWeeklyBlocks(blocks, timeZone, now, days + 7).some((i) => i.end > now) ||
    false
  );
}
