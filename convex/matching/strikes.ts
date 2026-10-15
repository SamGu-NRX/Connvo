/**
 * Strikes and the matching pause (docs/plan/MATCHING-PLAN.md, step 6).
 *
 * A reported no-show gives the absent person one strike. Two strikes in 30
 * days pause their matching: the matcher's eligibility (selectEligible in
 * convex/matching/pipeline.ts) refuses anyone at or above the threshold, and
 * the pause lifts when the strikes age out of the window.
 */

/** The no-show strike window. */
export const STRIKE_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Active strikes at or above this number pause matching. */
export const STRIKES_PAUSE_THRESHOLD = 2;

export interface StrikeLike {
  createdAt: number;
}

/** Strikes recorded inside the last 30 days. */
export function activeStrikes(
  strikes: StrikeLike[],
  now: number,
): StrikeLike[] {
  return strikes.filter((strike) => now - strike.createdAt < STRIKE_WINDOW_MS);
}

/** True when this person's active strikes pause their matching. */
export function matchingPaused(
  strikes: StrikeLike[],
  now: number,
): boolean {
  return activeStrikes(strikes, now).length >= STRIKES_PAUSE_THRESHOLD;
}
