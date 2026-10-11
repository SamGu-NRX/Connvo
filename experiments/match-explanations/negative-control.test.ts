import { describe, expect, it } from "vitest";

import { scanCanaryLeaks } from "./canary";
import { PROFILES } from "./fixtures";
import { runAllPairs } from "./harness";

/**
 * Negative control for the canary privacy scan: proves the leak detector is
 * NOT vacuous by planting private sentinels into TEST-ONLY artifacts and
 * requiring the SAME scan code the replay pipeline uses (scanCanaryLeaks,
 * shared with run.ts --replay) to flag them.
 *
 * Nothing here is written into results/: the committed artifacts stay clean
 * and the replay pass gate (canaryLeaks.length === 0) is unaffected — this
 * control lives only in the test suite.
 */

const sentinels = PROFILES.flatMap((p) =>
  p.privateSentinels.map((s) => s.value),
);

describe("canary privacy scan — negative control (planted leak)", () => {
  it("flags a private sentinel planted in a test-only explanation", () => {
    // Planted leak: a fixture's private display-name sentinel surfaces in a
    // proposed public sentence — exactly the failure class the scan exists
    // to catch. The assertion is that the scan FAILS it (leaks non-empty).
    const planted = PROFILES[0].privateSentinels[0].value;
    const leaks = scanCanaryLeaks({
      sentences: [
        {
          pairId: "negative-control",
          sentence: `You matched with ${planted}.`,
        },
      ],
      fileTexts: [],
      sentinels,
    });
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks[0]).toContain("negative-control");
    expect(leaks[0]).toContain(planted);
  });

  it("flags a private sentinel planted in a test-only results-file text", () => {
    const planted = PROFILES[0].privateSentinels[1].value;
    const leaks = scanCanaryLeaks({
      sentences: [],
      fileTexts: [
        {
          name: "negative-control.json",
          content: `{"note": "planted leak of ${planted}"}`,
        },
      ],
      sentinels,
    });
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks[0]).toContain("negative-control.json");
  });

  it("reports nothing for clean test-only text (no false positive)", () => {
    const leaks = scanCanaryLeaks({
      sentences: [
        {
          pairId: "negative-control",
          sentence: "Strong interest alignment",
        },
      ],
      fileTexts: [
        { name: "negative-control.json", content: '{"clean": true}' },
      ],
      sentinels,
    });
    expect(leaks).toEqual([]);
  });

  it("real handler explanations scan clean (positive control)", async () => {
    const leaks = scanCanaryLeaks({
      sentences: (await runAllPairs()).flatMap((p) =>
        p.explanation.map((sentence) => ({ pairId: p.pairId, sentence })),
      ),
      fileTexts: [],
      sentinels,
    });
    expect(leaks).toEqual([]);
  });
});
