/**
 * CI-style harness for the convex/lib runnable examples.
 *
 * Runs every module's `runExamples()` and asserts it produces results without
 * throwing. Each example file self-asserts its own expectations, so a resolved
 * promise with at least one result means the documented behavior held.
 *
 * Run with: npx vitest run convex/lib/examples
 */

import { describe, expect, it } from "vitest";
import { exampleModules } from "./index";

describe("convex/lib runnable examples", () => {
  it("covers every expected module", () => {
    expect(exampleModules.length).toBeGreaterThanOrEqual(10);
  });

  for (const { module, run } of exampleModules) {
    describe(module, () => {
      it("runs its examples with every assertion passing", async () => {
        const results = await run();
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
          expect(typeof r.name).toBe("string");
          expect(r.name.length).toBeGreaterThan(0);
          expect(typeof r.detail).toBe("string");
          expect(r.detail.length).toBeGreaterThan(0);
        }
      });
    });
  }
});
