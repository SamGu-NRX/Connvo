/**
 * Time-slot math for recurring weekly availability across timezones.
 *
 * availabilityBlocks rows are wall-clock minutes in one person's own IANA
 * timezone. To find times two people share, each person's blocks are expanded
 * into absolute UTC intervals over a horizon, and the intersections are cut
 * into 30-minute meeting slots. Every conversion goes through the one
 * wall-clock rule in src/lib/availability/zoneTime.ts — the same module the
 * client editor imports — so the matcher and the editor cannot disagree about
 * which instant a free hour falls on, and daylight-saving changes fall out of
 * the offset arithmetic: a block stays at the same wall-clock time and moves
 * in UTC when the zone's offset changes.
 */

import {
  occurrencesOnCivilDays,
  wallParts,
  wallToInstant,
  type WeeklyBlock,
} from "../../src/lib/availability/zoneTime";

export type { WeeklyBlock } from "../../src/lib/availability/zoneTime";
export type { WallParts } from "../../src/lib/availability/zoneTime";
export { wallParts, tzOffsetMs } from "../../src/lib/availability/zoneTime";

export interface Interval {
  /** UTC epoch ms. */
  start: number;
  end: number;
}

/** Whether a slot starting at `start` overlaps any booked interval. */
export function overlapsBooked(start: number, slotMs: number, booked: Interval[]): boolean {
  return booked.some((b) => start < b.end && start + slotMs > b.start);
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
  /** Times either person already has a chat; overlapping slots are skipped. */
  booked?: Interval[];
}

/**
 * A local wall-clock time (minute of day on a civil date) as a UTC instant.
 * Ambiguous and nonexistent wall times resolve by the one rule documented in
 * src/lib/availability/zoneTime.ts — the rule the client applies too.
 */
export function wallTimeToEpoch(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): number {
  return wallToInstant(timeZone, year, month, day, minuteOfDay);
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
  // Walk civil dates on the UTC calendar; weekday comes from the date.
  return occurrencesOnCivilDays(
    blocks,
    timeZone,
    Date.UTC(start.year, start.month - 1, start.day),
    Date.UTC(start.year, start.month - 1, start.day + days - 1),
  );
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
    booked = [],
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
      if (overlapsBooked(s, slotMs, booked)) continue;
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
