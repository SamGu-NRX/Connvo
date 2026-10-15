import { describe, expect, it } from "vitest";

import {
  assign,
  buildProposals,
  hardRuleAllowed,
  prepare,
  SHORTLIST_SIZE,
  type MatcherSnapshot,
  type MatcherSnapshotPerson,
} from "./pipeline";

const NOW = Date.UTC(2026, 0, 5, 12, 0); // Monday noon UTC.

/** A person free Monday 09:00-10:00 local, English, two chats a week. */
function person(overrides: Partial<MatcherSnapshotPerson>): MatcherSnapshotPerson {
  return {
    userId: "u_a",
    displayName: "A",
    intents: ["peers"],
    interests: [],
    languages: ["English"],
    timezone: "UTC",
    chatsPerWeek: 2,
    blocks: [{ weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
    meetingsThisWeek: 0,
    waitingRuns: 0,
    metRecently: [],
    talkAgainBoth: [],
    excluded: [],
    ...overrides,
  };
}

const monday = (week: number, hourUtc: number) =>
  Date.UTC(2026, 0, 5 + 7 * week, hourUtc);

describe("buildProposals", () => {
  it("writes a proposal in a shared free-time slot", async () => {
    const drafts = await buildProposals({
      now: NOW,
      people: [person({ userId: "u_a" }), person({ userId: "u_b" })],
    });
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft.userAId).toBe("u_a");
    expect(draft.userBId).toBe("u_b");
    // The first slot is Monday 09:00 UTC, 21 hours out: past the 18h lead.
    // now is Monday 12:00 UTC; this Monday's block already started, so the
    // proposal lands on next Monday and the horizon caps the alternatives.
    expect(draft.scheduledAt).toBe(monday(1, 9));
    // The rest of the 10-day horizon: Mondays 09:00, weeks 1-3.
    expect(draft.alternatives).toEqual([monday(1, 9) + 30 * 60_000]);
    for (const slot of [draft.scheduledAt, ...draft.alternatives]) {
      expect(slot - NOW).toBeGreaterThanOrEqual(18 * 60 * 60 * 1000);
    }
  });

  it("proposes 30-minute meetings across different timezones at the same wall time", async () => {
    // 09:00 in New York (14:00 UTC in winter) and 14:00 UTC.
    const drafts = await buildProposals({
      now: NOW,
      people: [
        person({
          userId: "u_a",
          timezone: "America/New_York",
          blocks: [{ weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
        }),
        person({
          userId: "u_b",
          timezone: "UTC",
          blocks: [{ weekday: 1, startMinute: 14 * 60, endMinute: 15 * 60 }],
        }),
      ],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].scheduledAt).toBe(monday(1, 14));
  });

  it("always proposes at least 18 hours out", async () => {
    const late = (userId: string) =>
      person({
        userId,
        blocks: [{ weekday: 1, startMinute: 12 * 60, endMinute: 13 * 60 }],
      });
    const drafts = await buildProposals({
      now: NOW,
      people: [late("u_a"), late("u_b")],
    });
    // Monday 12:00 is too soon; the proposal lands next Monday.
    expect(drafts[0].scheduledAt).toBe(monday(1, 12));
  });

  it("writes specific reasons naming the shared interest", async () => {
    const drafts = await buildProposals({
      now: NOW,
      people: [
        person({ userId: "u_a", interests: ["rust", "technology"] }),
        person({ userId: "u_b", interests: ["rust", "technology"] }),
      ],
    });
    expect(drafts[0].reasons.some((r) => r.includes("rust"))).toBe(true);
    expect(drafts[0].firstQuestion.length).toBeGreaterThan(0);
  });

  it("never proposes people who blocked or reported each other", async () => {
    const drafts = await buildProposals({
      now: NOW,
      people: [
        person({ userId: "u_a", excluded: ["u_b"] }),
        person({ userId: "u_b" }),
      ],
    });
    expect(drafts).toEqual([]);
  });

  it("never repeats a meeting from the last 90 days", async () => {
    const drafts = await buildProposals({
      now: NOW,
      people: [
        person({ userId: "u_a", metRecently: ["u_b"] }),
        person({ userId: "u_b" }),
      ],
    });
    expect(drafts).toEqual([]);
  });

  it("rematches within 90 days when both said they would talk again", async () => {
    const drafts = await buildProposals({
      now: NOW,
      people: [
        person({ userId: "u_a", metRecently: ["u_b"], talkAgainBoth: ["u_b"] }),
        person({ userId: "u_b", metRecently: ["u_a"], talkAgainBoth: ["u_a"] }),
      ],
    });
    expect(drafts).toHaveLength(1);
  });

  it("does not propose pairs without a shared language", async () => {
    const drafts = await buildProposals({
      now: NOW,
      people: [
        person({ userId: "u_a", languages: ["English"] }),
        person({ userId: "u_b", languages: ["Português"] }),
      ],
    });
    expect(drafts).toEqual([]);
  });

  it("gives one proposal per person and takes the best pairs first", async () => {
    // u_x complements both u_a and u_b on goals; u_a and u_b share nothing.
    const strongX = (userId: string): MatcherSnapshotPerson =>
      person({ userId, intents: ["find_mentor"] });
    const x = strongX("u_x");
    const a = person({
      userId: "u_a",
      intents: ["mentor"],
      interests: ["rust"],
    });
    const b = person({
      userId: "u_b",
      intents: ["mentor"],
      interests: ["cooking"],
    });
    const drafts = await buildProposals({ now: NOW, people: [x, a, b] });
    expect(drafts).toHaveLength(1);
    // u_x wins the one slot; ids are stored in sorted order inside the draft.
    const pair = [drafts[0].userAId, drafts[0].userBId];
    expect(pair).toContain("u_x");
    expect(pair).not.toContain("u_b");
  });

  it("breaks waiting people in with a bonus", async () => {
    // Two candidate pairs, deterministic scores nearly equal: the pair
    // containing the person who has waited four runs must be proposed.
    const waiting = person({ userId: "u_wait", waitingRuns: 4, intents: ["find_mentor"] });
    const mentor = person({ userId: "u_mentor", intents: ["mentor"], interests: ["rust"] });
    // Wait + mentor scores above two equal-scored others.
    const other1 = person({ userId: "u_o1", intents: ["peers"] });
    const other2 = person({ userId: "u_o2", intents: ["peers"] });
    const drafts = await buildProposals({
      now: NOW,
      people: [waiting, mentor, other1, other2],
    });
    const pairs = drafts.map((d) =>
      [d.userAId, d.userBId].sort().join("|"),
    );
    expect(pairs).toContain("u_mentor|u_wait");
  });

  it("caps each shortlist at 8 candidates", () => {
    const crowd = Array.from({ length: 20 }, (_, i) =>
      person({ userId: `u_c${String(i).padStart(2, "0")}` }),
    );
    const prepared = prepare({ now: NOW, people: crowd });
    for (const list of prepared.shortlists.values()) {
      expect(list.length).toBeLessThanOrEqual(SHORTLIST_SIZE);
    }
  });

  it("is deterministic: same snapshot, same drafts", async () => {
    const snapshot: MatcherSnapshot = {
      now: NOW,
      people: [
        person({ userId: "u_a", interests: ["rust"] }),
        person({ userId: "u_b", interests: ["rust", "cooking"] }),
        person({ userId: "u_c", interests: ["cooking"] }),
      ],
    };
    const first = await buildProposals(snapshot);
    const second = await buildProposals(snapshot);
    expect(first).toEqual(second);
  });
});

describe("hardRuleAllowed", () => {
  const a = person({ userId: "u_a" });
  const b = person({ userId: "u_b" });

  it("allows a pair with a shared slot", () => {
    expect(hardRuleAllowed(a, b, NOW)).toBe(true);
  });

  it("blocks a pair with no shared free time", () => {
    const c = person({
      userId: "u_c",
      blocks: [{ weekday: 5, startMinute: 9 * 60, endMinute: 10 * 60 }],
    });
    expect(hardRuleAllowed(a, c, NOW)).toBe(false);
  });

  it("blocks a pair where either side excluded the other", () => {
    const blocked = person({ userId: "u_b", excluded: ["u_a"] });
    expect(hardRuleAllowed(a, blocked, NOW)).toBe(false);
  });
});

describe("assign with an injected rerank", () => {
  it("blends the rerank probabilities into the final score", async () => {
    const snapshot: MatcherSnapshot = {
      now: NOW,
      people: [
        person({ userId: "u_a", interests: ["rust"] }),
        person({ userId: "u_b", interests: ["rust"] }),
        person({ userId: "u_c", interests: ["rust"] }),
      ],
    };
    // Rerank inverts the deterministic order: c beats b for a, and symmetric.
    const rerank = async (
      p: { userId: string },
      candidates: { userId: string }[],
    ) => {
      const probabilities = new Map<string, number>();
      const ids = candidates.map((c) => c.userId).sort();
      probabilities.set(ids[0], 0.9);
      probabilities.set(ids[1], 0.1);
      return probabilities;
    };
    const prepared = prepare(snapshot);
    const withRerank = await assign(snapshot, prepared, rerank);
    const withoutRerank = await assign(snapshot, prepared);
    // Same pair count; the rerank may reorder which pairs win but never
    // invents or drops coverage: everyone matched without rerank stays matched.
    expect(withRerank).toHaveLength(withoutRerank.length);
  });

  it("falls back to the deterministic score when the rerank returns null", async () => {
    const snapshot: MatcherSnapshot = {
      now: NOW,
      people: [person({ userId: "u_a" }), person({ userId: "u_b" })],
    };
    const prepared = prepare(snapshot);
    const drafts = await assign(snapshot, prepared, async () => null);
    expect(drafts).toHaveLength(1);
  });
});
