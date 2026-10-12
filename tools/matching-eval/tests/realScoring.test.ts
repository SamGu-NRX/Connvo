/**
 * Grounds the baseline adapter: scores finite, reasons contribution-faithful.
 * Review fix 2 follow-up (PR #32): the double feature-mapping bug made
 * buildReasons read an absent orgConstraintMatch key and emit NaN
 * contributions — this suite fails loudly if that ever returns.
 */
import { describe, expect, it } from "vitest";
import { realScoringSelect } from "../src/realScoring";
import { makePopulation } from "../src/population";

describe("realScoring baseline adapter", () => {
  it("emits finite pair scores and finite reason contributions", () => {
    const population = makePopulation(24, 7);
    const { matches, pairs } = realScoringSelect(population, () => undefined);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(Number.isFinite(p.score)).toBe(true);
      for (const v of Object.values(p.features)) expect(Number.isFinite(v)).toBe(true);
    }
    for (const m of matches) {
      expect(Number.isFinite(m.score)).toBe(true);
      for (const r of m.reasons) {
        expect(Number.isFinite(r.contribution)).toBe(true);
        expect(r.contribution).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("reason contributions sum to a finite fraction of the score", () => {
    const population = makePopulation(24, 11);
    const { matches } = realScoringSelect(population, () => undefined);
    for (const m of matches) {
      const total = m.reasons.reduce((a, r) => a + r.contribution, 0);
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeLessThanOrEqual(1.0001);
    }
  });
});
