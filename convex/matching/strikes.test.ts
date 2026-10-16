/**
 * Strike window tests (convex/matching/strikes.ts, pipeline eligibility) —
 * pure functions, no Convex runtime needed.
 *
 * The risks worth pinning: exactly two strikes in 30 days pause matching,
 * strikes age out of the window so the pause lifts, and the matcher's
 * eligibility refuses anyone at or above the threshold.
 */

import { describe, expect, it } from "vitest";
import {
  activeStrikes,
  matchingPaused,
  STRIKES_PAUSE_THRESHOLD,
  STRIKE_WINDOW_MS,
} from "./strikes";
import { selectEligible, type MatcherSnapshot } from "./pipeline";

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const DAY = 86_400_000;

function strikeAt(daysAgo: number) {
  return { createdAt: NOW - daysAgo * DAY };
}

describe("strike window", () => {
  it("pauses matching at exactly two active strikes", () => {
    expect(matchingPaused([strikeAt(1)], NOW)).toBe(false);
    expect(
      matchingPaused([strikeAt(1), strikeAt(2)], NOW),
    ).toBe(true);
    expect(
      matchingPaused([strikeAt(1), strikeAt(2), strikeAt(3)], NOW),
    ).toBe(true);
    expect(STRIKES_PAUSE_THRESHOLD).toBe(2);
  });

  it("lifts the pause when strikes age out of the 30-day window", () => {
    // One strike inside the window, one aged out: only one is active.
    expect(
      matchingPaused([strikeAt(29), strikeAt(40)], NOW),
    ).toBe(false);
    // Two strikes, one aged out: only one is active, so no pause.
    expect(
      matchingPaused([strikeAt(40), strikeAt(10)], NOW),
    ).toBe(false);
    // A strike on the window boundary (exactly 30 days) is out.
    expect(activeStrikes([strikeAt(30)], NOW)).toHaveLength(0);
    expect(activeStrikes([strikeAt(29.999)], NOW)).toHaveLength(1);
    expect(STRIKE_WINDOW_MS).toBe(30 * DAY);
  });
});

describe("matcher eligibility", () => {
  const base = {
    userId: "u_alice",
    displayName: "Alice",
    intents: ["peers"],
    interests: [],
    languages: ["English"],
    field: null,
    jobTitle: null,
    experience: null,
    timezone: "UTC",
    chatsPerWeek: 1,
    meetingsThisWeek: 0,
    waitingRuns: 0,
    metRecently: [],
    talkAgainBoth: [],
    booked: [],
    // All Thursday, all day: free for whatever `now` we pass.
    blocks: [{ weekday: 4, startMinute: 0, endMinute: 1440 }],
  };

  function snapshot(strikes: number): MatcherSnapshot {
    return {
      now: NOW,
      people: [
        { ...base, userId: "u_alice", strikes },
        { ...base, userId: "u_bob", strikes: 0 },
      ],
    };
  }

  it("keeps people with no strikes and pauses people at two", () => {
    expect(selectEligible(snapshot(0)).map((p) => p.userId)).toEqual([
      "u_alice",
      "u_bob",
    ]);
    expect(selectEligible(snapshot(1)).map((p) => p.userId)).toEqual([
      "u_alice",
      "u_bob",
    ]);
    const paused = selectEligible(snapshot(2));
    expect(paused.map((p) => p.userId)).toEqual(["u_bob"]);
  });
});
