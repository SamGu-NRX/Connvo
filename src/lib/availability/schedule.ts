/**
 * Availability math for the one-week free-time grid
 * (cv6-profile-availability).
 *
 * The grid a person taps is 7 days × 48 half-hour slots in their own
 * timezone; storage (convex availabilityBlocks) is the same shape collapsed
 * into runs. Blocks recur every week, so daylight-saving time is resolved
 * when a concrete occurrence is needed — blockOccurrences — not when it is
 * stored, through the one wall-clock rule in ./zoneTime that the matcher
 * (convex/matching/slots.ts) shares.
 */

import { occurrencesOnCivilDays, wallParts, type WeeklyBlock } from "./zoneTime";

export type { WeeklyBlock } from "./zoneTime";

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

export { zoneWeekdayMinute } from "./zoneTime";

/**
 * Expands recurring weekly blocks into concrete UTC intervals that overlap
 * [rangeStart, rangeEnd), in the given timezone. Wall-clock semantics: a
 * 30-minute block keeps its wall minutes, so across a fall-back the same
 * slot lands an hour later in UTC the following week. Ambiguous and
 * nonexistent wall times resolve by the one rule documented in ./zoneTime,
 * the same rule the matcher applies.
 */
export function blockOccurrences(
  blocks: WeeklyBlock[],
  timeZone: string,
  rangeStart: number,
  rangeEnd: number,
): Array<{ start: number; end: number; weekday: number }> {
  if (!(rangeEnd > rangeStart) || blocks.length === 0) return [];
  const first = wallParts(timeZone, rangeStart);
  const last = wallParts(timeZone, rangeEnd - 1);
  // Walk zone calendar days with a one-day margin on each side.
  const occurrences = occurrencesOnCivilDays(
    blocks,
    timeZone,
    Date.UTC(first.year, first.month - 1, first.day - 1),
    Date.UTC(last.year, last.month - 1, last.day + 1),
  );
  return occurrences.filter(
    (o) => o.end > rangeStart && o.start < rangeEnd,
  );
}
