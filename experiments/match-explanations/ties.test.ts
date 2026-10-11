import { describe, expect, it } from "vitest";

import { runAllPairs } from "./harness";

/**
 * Deliberate tied-match constructions, hand-solved and pinned against the
 * REAL handler (the same offline binding used everywhere else in this
 * experiment — no mocks, no re-implemented scoring).
 *
 * Tie A: mentee-x-mentor ≡ tie-a-x-b. The clone pair renames the people and
 * changes everything the score ignores (display names, org identities,
 * language identities, field spelling, interest order) while holding every
 * scoring-relevant value exactly equal. Hand solution with the production
 * weights (vectorSimilarity undefined, so the effective weight sum is 0.8):
 *
 *   interestOverlap     0.7·(2/3) + 0.3·1                 = 23/30
 *                       (2 of 3 actual interests shared;
 *                        2 of 2 constraint interests shared)
 *   experienceGap       junior(2) vs senior(4), gap 2     = 1.0
 *   industryMatch       "technology" ≡ "TECHNOLOGY"
 *                       case-insensitive exact match      = 1.0
 *   languageOverlap     1 shared of max 2                 = 0.5
 *   roleComplementarity mentee/mentor                     = 1.0
 *   orgConstraintMatch  identical "same_org" strings
 *                       short-circuit before org ids      = 1.0
 *   timezoneCompatibility hardcoded placeholder          = 1.0
 *
 *   score = (0.25·23/30 + 0.15·1 + 0.1·1 + 0.1·1 + 0.05·1 + 0.1·0.5
 *            + 0.05·1) / 0.8 = (83/120)·(5/4) = 83/96 ≈ 0.864583
 *
 * Tie B: mentee-x-sparse ≡ tie-c-x-d, all components zeroed or neutral:
 *
 *   interestOverlap     no shared interests either layer  = 0
 *   experienceGap       junior vs null profile            = 0.5
 *   industryMatch       undefined field on one side       = 0.5
 *   languageOverlap     two languages vs empty set        = 0.5
 *   roleComplementarity mentee vs investor                = 0
 *   orgConstraintMatch  one-sided same_org, differing orgs = 0.0
 *
 *   score = (0.15·0.5 + 0.1·0.5 + 0.1·1 + 0.1·0.5) / 0.8 = 0.275/0.8
 *         = 11/32 = 0.34375 (exactly representable in binary)
 */
describe("deliberate tied-match constructions (hand-solved, real handler)", () => {
  it("ties mentee-x-mentor and tie-a-x-b at exactly 83/96", async () => {
    const byId = new Map((await runAllPairs()).map((p) => [p.pairId, p]));
    const original = byId.get("mentee-x-mentor")!;
    const clone = byId.get("tie-a-x-b")!;
    // The two candidate pairs score EXACTLY equal — not approximately.
    expect(clone.score).toBe(original.score);
    // Pin the hand solution: the handler's own double for 83/96.
    expect(original.score).toBe(0.8645833333333334);
    expect(Math.abs(original.score - 83 / 96)).toBeLessThan(1e-12);
  });

  it("ties mentee-x-sparse and tie-c-x-d at exactly 11/32 = 0.34375", async () => {
    const byId = new Map((await runAllPairs()).map((p) => [p.pairId, p]));
    const original = byId.get("mentee-x-sparse")!;
    const clone = byId.get("tie-c-x-d")!;
    expect(clone.score).toBe(original.score);
    // 11/32 is exactly representable in binary, so the pin is exact.
    expect(original.score).toBe(0.34375);
  });

  it("tied scores come from identical component values, not float luck", async () => {
    const byId = new Map((await runAllPairs()).map((p) => [p.pairId, p]));
    for (const [a, b] of [
      ["mentee-x-mentor", "tie-a-x-b"],
      ["mentee-x-sparse", "tie-c-x-d"],
    ] as const) {
      const left = byId.get(a)!;
      const right = byId.get(b)!;
      for (const [feature, value] of Object.entries(left.features)) {
        expect(
          right.features[feature as keyof typeof right.features],
          `tie component ${feature} differs between ${a} and ${b}`,
        ).toBe(value);
      }
    }
  });

  it("tied pairs emit identical explanations (rename-invariance)", async () => {
    const byId = new Map((await runAllPairs()).map((p) => [p.pairId, p]));
    expect(byId.get("tie-a-x-b")!.explanation).toEqual(
      byId.get("mentee-x-mentor")!.explanation,
    );
    expect(byId.get("tie-c-x-d")!.explanation).toEqual(
      byId.get("mentee-x-sparse")!.explanation,
    );
  });

  it("tied scores reproduce exactly across independent runs", async () => {
    const first = await runAllPairs();
    const second = await runAllPairs();
    for (const pairId of ["tie-a-x-b", "tie-c-x-d"]) {
      const a = first.find((p) => p.pairId === pairId)!;
      const b = second.find((p) => p.pairId === pairId)!;
      expect(b.score).toBe(a.score);
      expect(b.explanation).toEqual(a.explanation);
    }
  });
});
