import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EXACT_COUNTS, PAIRS, PROFILES, profileById } from "./fixtures";
import {
  REAL_SCORING_HANDLER,
  REPO_ROOT,
  runAllPairs,
  runMissingUserCase,
  hashAllSources,
} from "./harness";
import {
  COMPUTED_BUT_UNSURFACED,
  CONTRIBUTION_CONDITIONS,
  ELIGIBILITY_RULES,
  FALLBACK_SENTENCE,
  predictedExplanation,
} from "./references";

const allSentinels = PROFILES.flatMap((p) =>
  p.privateSentinels.map((s) => s.value),
);

describe("entrypoint binding (real production handler, offline)", () => {
  it("binds to the real registered Convex action handler", () => {
    expect(typeof REAL_SCORING_HANDLER).toBe("function");
  });

  it("scores every declared pair through the real entrypoint", async () => {
    const pairs = await runAllPairs();
    expect(pairs.length).toBe(PAIRS.length);
    for (const result of pairs) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      for (const [feature, value] of Object.entries(result.features)) {
        if (feature === "vectorSimilarity" && value === undefined) continue;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(Array.isArray(result.explanation)).toBe(true);
      // The real handler fetched both profiles through ctx.runQuery.
      expect(result.runQueryCalls).toBe(2);
    }
  });

  it("rejects a pair whose user data is missing, via the real handler", async () => {
    const outcome = await runMissingUserCase();
    expect(outcome.errorMessage).toContain("User data not found for scoring");
  });
});

describe("contribution references (sentence -> computed feature witness)", () => {
  it("explanation is fully determined by computed features via the condition table", async () => {
    const pairs = await runAllPairs();
    for (const result of pairs) {
      expect(result.explanation).toEqual(predictedExplanation(result.features));
    }
  });

  it("every emitted sentence carries exactly one contribution witness", async () => {
    const pairs = await runAllPairs();
    for (const result of pairs) {
      for (const sentence of result.explanation) {
        // The fallback is not feature-backed by design; its guard is
        // asserted separately below.
        if (sentence === FALLBACK_SENTENCE) continue;
        const matches = CONTRIBUTION_CONDITIONS.filter(
          (c) => c.sentence === sentence,
        );
        expect(
          matches.length,
          `no contribution witness for sentence: ${sentence}`,
        ).toBe(1);
      }
      // The fallback fires only when no other condition did.
      const fallbackOnly = result.explanation.length === 1;
      const noConditionFired = CONTRIBUTION_CONDITIONS.every(
        (c) => !c.holds(result.features),
      );
      if (result.explanation.includes(FALLBACK_SENTENCE)) {
        expect(fallbackOnly).toBe(true);
        expect(noConditionFired).toBe(true);
      } else {
        expect(noConditionFired).toBe(false);
      }
    }
  });

  it("no explanation sentence contains any private-field sentinel", async () => {
    const pairs = await runAllPairs();
    for (const result of pairs) {
      for (const sentence of result.explanation) {
        for (const sentinel of allSentinels) {
          expect(
            sentence.includes(sentinel),
            `leak: ${sentinel} in "${sentence}"`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("eligibility references (rule structures exercised by fixtures)", () => {
  it("witnesses resolve to real computed feature values", async () => {
    const pairs = await runAllPairs();
    const byId = new Map(pairs.map((p) => [p.pairId, p]));
    for (const rule of ELIGIBILITY_RULES) {
      expect(rule.witnesses.length).toBeGreaterThan(0);
      for (const witness of rule.witnesses) {
        const pair = byId.get(witness.pairId);
        expect(pair, `unknown pair ${witness.pairId}`).toBeDefined();
        if (rule.id === "VECTOR_MISSING_UNDEFINED") {
          // The evidence for this rule IS the undefined value.
          expect(
            pair!.features[witness.feature],
            `rule ${rule.id} witness ${witness.pairId}.${witness.feature} should be undefined`,
          ).toBeUndefined();
        } else {
          expect(
            pair!.features[witness.feature],
            `rule ${rule.id} witness ${witness.pairId}.${witness.feature} is undefined`,
          ).toBeDefined();
        }
      }
    }
  });

  it("role rules: complementary pairs 1.0, same-role 0.7, unrelated 0", async () => {
    const pairs = await runAllPairs();
    const byId = new Map(pairs.map((p) => [p.pairId, p]));
    expect(byId.get("mentee-x-mentor")!.features.roleComplementarity).toBe(1.0);
    expect(byId.get("mentor-x-peer")!.features.roleComplementarity).toBe(1.0);
    expect(byId.get("mentee-x-design")!.features.roleComplementarity).toBe(0.7);
    expect(byId.get("mentee-x-sparse")!.features.roleComplementarity).toBe(0);
  });

  it("org rules: falsified same_org is 0.0 while identical constraint strings short-circuit to 1.0", async () => {
    const pairs = await runAllPairs();
    const byId = new Map(pairs.map((p) => [p.pairId, p]));
    // The short-circuit pairs genuinely have DIFFERENT orgIds.
    const mentor = profileById("mentor-senior-technology").scoringData.user
      .orgId;
    const mentee = profileById("mentee-junior-technology").scoringData.user
      .orgId;
    const peer = profileById("peer-mid-software").scoringData.user.orgId;
    expect(mentor).not.toBe(mentee);
    expect(mentor).not.toBe(peer);
    expect(byId.get("mentee-x-mentor")!.features.orgConstraintMatch).toBe(1.0);
    expect(byId.get("mentor-x-peer")!.features.orgConstraintMatch).toBe(1.0);
    // Falsified and one-sided same_org cases land on 0.0.
    expect(byId.get("mentee-x-design")!.features.orgConstraintMatch).toBe(0.0);
    expect(byId.get("mentee-x-sparse")!.features.orgConstraintMatch).toBe(0.0);
  });

  it("missing-profile data yields the 0.5 neutral branches", async () => {
    const pairs = await runAllPairs();
    const sparse = pairs.find((p) => p.pairId === "mentee-x-sparse")!;
    expect(sparse.features.experienceGap).toBe(0.5);
    expect(sparse.features.industryMatch).toBe(0.5);
    expect(sparse.features.languageOverlap).toBe(0.5);
  });

  it("vector rules: undefined without embeddings, computed and > 0.8 for near-collinear vectors", async () => {
    const pairs = await runAllPairs();
    const byId = new Map(pairs.map((p) => [p.pairId, p]));
    expect(
      byId.get("mentee-x-mentor")!.features.vectorSimilarity,
    ).toBeUndefined();
    const semantic = byId.get("mentor-x-peer")!.features.vectorSimilarity;
    expect(semantic).toBeDefined();
    expect(semantic!).toBeGreaterThan(0.8);
    // Near-collinear synthetic vectors: cosine ~0.99 -> similarity ~0.995.
    expect(semantic!).toBeGreaterThan(0.99);
    expect(semantic!).toBeLessThanOrEqual(1);
  });

  it("records timezoneCompatibility as a hardcoded placeholder", async () => {
    const pairs = await runAllPairs();
    for (const result of pairs) {
      expect(result.features.timezoneCompatibility).toBe(1.0);
    }
    const tzRule = ELIGIBILITY_RULES.find(
      (r) => r.id === "TIMEZONE_PLACEHOLDER",
    )!;
    const surfaced = COMPUTED_BUT_UNSURFACED.some(
      (c) => c.feature === "timezoneCompatibility",
    );
    expect(tzRule).toBeDefined();
    expect(surfaced).toBe(true);
  });
});

describe("exact fixture counts", () => {
  it("matches the declared exact counts", () => {
    expect(EXACT_COUNTS).toEqual({
      profiles: 9,
      scoredPairs: 6,
      missingUserCases: 1,
    });
    const ids = PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const userIds = PROFILES.map((p) => p.scoringData.user._id);
    expect(new Set(userIds).size).toBe(userIds.length);
  });
});

describe("committed results freshness", () => {
  it("committed source hashes match the current source tree", () => {
    const resultsPath = path.join(
      REPO_ROOT,
      "experiments/match-explanations/results/source-hashes.json",
    );
    expect(existsSync(resultsPath)).toBe(true);
    const committed = JSON.parse(readFileSync(resultsPath, "utf8"));
    expect(committed.algorithm).toBe("sha256");
    expect(committed.files).toEqual(hashAllSources(REPO_ROOT));
  });
});
