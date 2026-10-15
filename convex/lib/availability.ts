import { v } from "convex/values";

/**
 * Shared matching-preference validators and availability math
 * (cv6-profile-availability). Imported by the schema, the profile functions
 * and (later) the matcher, so the shapes agree everywhere.
 */

/** The seven conversation goals a profile can carry. At most three are stored. */
export const INTENT_VALUES = [
  "find_mentor",
  "mentor",
  "peers",
  "explore_field",
  "collaborate",
  "hiring",
  "job_seeking",
] as const;

export type Intent = (typeof INTENT_VALUES)[number];

export const intentsV = v.array(
  v.union(
    v.literal("find_mentor"),
    v.literal("mentor"),
    v.literal("peers"),
    v.literal("explore_field"),
    v.literal("collaborate"),
    v.literal("hiring"),
    v.literal("job_seeking"),
  ),
);

/** Chats a person wants per week. 0 means matching is paused. */
export const chatsPerWeekV = v.union(
  v.literal(0),
  v.literal(1),
  v.literal(2),
);

/** One recurring weekly free-time block, in the user's own timezone. */
export const weeklyBlockFields = {
  weekday: v.number(),
  startMinute: v.number(),
  endMinute: v.number(),
};

export const weeklyBlockV = v.object(weeklyBlockFields);

export type WeeklyBlock = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export const MINUTES_PER_DAY = 24 * 60;
/** Free time is stored in half-hour steps. */
export const BLOCK_STEP = 30;

/** A block's weekly free time is stored 0..6, Sunday=0, in half-hour steps. */
export const MAX_BLOCKS_PER_WEEK = 7 * (MINUTES_PER_DAY / BLOCK_STEP);

/**
 * Returns null when the block can be stored, otherwise a sentence explaining
 * why not. Pure: the mutation turns the sentence into a ConvexError.
 */
export function weeklyBlockProblem(block: WeeklyBlock): string | null {
  if (
    !Number.isInteger(block.weekday) ||
    block.weekday < 0 ||
    block.weekday > 6
  ) {
    return "Free time days must be whole days of the week (0-6).";
  }
  const { startMinute, endMinute } = block;
  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    endMinute > MINUTES_PER_DAY
  ) {
    return "Free time must sit inside one day (minutes from local midnight).";
  }
  if (
    startMinute % BLOCK_STEP !== 0 ||
    endMinute % BLOCK_STEP !== 0
  ) {
    return "Free time is picked in 30-minute steps.";
  }
  if (startMinute >= endMinute) {
    return "A free-time block has to end after it starts.";
  }
  return null;
}

/**
 * Sorts by day and start, drops exact duplicates, and merges blocks that
 * overlap or touch, so the matcher never double-counts a half hour.
 */
export function normalizeWeeklyBlocks(blocks: WeeklyBlock[]): WeeklyBlock[] {
  const sorted = [...blocks].sort(
    (a, b) =>
      a.weekday - b.weekday || a.startMinute - b.startMinute,
  );
  const merged: WeeklyBlock[] = [];
  for (const block of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.weekday === block.weekday &&
      block.startMinute <= last.endMinute
    ) {
      last.endMinute = Math.max(last.endMinute, block.endMinute);
      continue;
    }
    merged.push({ ...block });
  }
  return merged;
}

/** True when the string names a timezone the runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
