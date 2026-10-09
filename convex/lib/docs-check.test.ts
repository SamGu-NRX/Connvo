/**
 * Vitest wrapper for the README fact-checker so it runs with the rest of the suite.
 *
 * The self-test proves the checker detects valid claims, missing files,
 * out-of-range lines, blank-line references, and nonexistent exports.
 * The live check then verifies the real convex/lib/README.md against the code.
 */

import { describe, expect, it } from "vitest";
import { checkReadme, selfTest } from "./docs-check.mjs";

describe("docs-check (README fact-checker)", () => {
  it("self-test: detects valid and invalid claims", () => {
    expect(selfTest()).toEqual([]);
  });

  it("live check: every convex/lib/README.md claim matches the code", () => {
    const failures = checkReadme(new URL("./README.md", import.meta.url).pathname);
    expect(failures).toEqual([]);
  });
});
