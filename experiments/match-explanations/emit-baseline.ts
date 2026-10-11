/**
 * Emit the milestone-1 baseline results for the match-explanations
 * experiment. Runs the REAL scoring entrypoint over the controlled
 * synthetic fixtures and writes deterministic JSON to results/.
 *
 * Usage: corepack pnpm exec tsx experiments/match-explanations/emit-baseline.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  EXACT_COUNTS,
  MISSING_USER_ID,
  PAIRS,
  PROFILES,
} from "./fixtures";
import {
  hashAllSources,
  REAL_SCORING_HANDLER,
  REPO_ROOT,
  runMissingUserCase,
  type PairResult,
} from "./harness";
import {
  COMPUTED_BUT_UNSURFACED,
  CONTRIBUTION_CONDITIONS,
  ELIGIBILITY_RULES,
  FALLBACK_SENTENCE,
} from "./references";

function jsonWrite(outDir: string, filename: string, payload: unknown): void {
  writeFileSync(
    path.join(outDir, filename),
    JSON.stringify(payload, null, 2) + "\n",
  );
}

function featureValue(value: number | undefined): number | null {
  return value === undefined ? null : value;
}

export async function buildBaseline(outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  // Score every pair through the real entrypoint.
  const pairResults: PairResult[] = [];
  for (const pair of PAIRS) {
    const left = PROFILES.find((p) => p.id === pair.leftId)!;
    const right = PROFILES.find((p) => p.id === pair.rightId)!;
    const runQueryCalls: number[] = [];
    const output = await REAL_SCORING_HANDLER(
      {
        runQuery: async (_ref: unknown, args: { userId: string }) => {
          runQueryCalls.push(1);
          const profile = PROFILES.find(
            (p) => p.scoringData.user._id === args.userId,
          );
          return profile ? profile.scoringData : null;
        },
      },
      {
        user1Id: left.scoringData.user._id,
        user2Id: right.scoringData.user._id,
        user1Constraints: left.constraints,
        user2Constraints: right.constraints,
      },
    );
    pairResults.push({
      pairId: pair.pairId,
      leftId: pair.leftId,
      rightId: pair.rightId,
      purpose: pair.purpose,
      runQueryCalls: runQueryCalls.length,
      score: output.score,
      features: output.features,
      explanation: output.explanation,
    });
  }

  const missingUser = await runMissingUserCase();

  // 1. Source hashes: what exact code produced / backs these results.
  jsonWrite(outDir, "source-hashes.json", {
    algorithm: "sha256",
    note:
      "Hashes of the untouched production sources this experiment binds to. " +
      "The binding invokes calculateCompatibilityScore's registered handler " +
      "(_handler) with a stub ctx.runQuery serving synthetic profiles in " +
      "place of internal.matching.scoring.getUserScoringData.",
    files: hashAllSources(REPO_ROOT),
    boundEntrypoints: {
      scoring: {
        module: "convex/matching/scoring.ts",
        export: "calculateCompatibilityScore",
        invocation:
          "_handler(ctx, args) with ctx.runQuery resolving synthetic UserScoringData by userId",
        runQueryCallsPerPair: 2,
      },
    },
  });

  // 2. Fixture inventory with exact counts.
  jsonWrite(outDir, "fixture-inventory.json", {
    exactCounts: EXACT_COUNTS,
    profiles: PROFILES.map((p) => ({
      id: p.id,
      description: p.description,
      fieldPresence: {
        profile: p.scoringData.profile !== null,
        experience: p.scoringData.profile?.experience !== undefined,
        field: p.scoringData.profile?.field !== undefined,
        company: p.scoringData.profile?.company !== undefined,
        languages: (p.scoringData.profile?.languages ?? []).length > 0,
        embedding: p.scoringData.embedding !== null,
        orgConstraints: p.constraints.orgConstraints !== undefined,
      },
      // Counts only; sentinel values live in fixtures.ts, not in results.
      privateSentinelCount: p.privateSentinels.length,
    })),
    pairs: PAIRS.map((p) => ({
      pairId: p.pairId,
      leftId: p.leftId,
      rightId: p.rightId,
      purpose: p.purpose,
    })),
    missingUserCase: { userId: MISSING_USER_ID, observed: missingUser },
  });

  // 3. Contribution references: sentence -> feature witness, values from the
  //    real handler's own output.
  jsonWrite(outDir, "contribution-references.json", {
    fallbackSentence: FALLBACK_SENTENCE,
    conditionTable: CONTRIBUTION_CONDITIONS.map((c) => ({
      sentence: c.sentence,
      feature: c.feature,
      condition: c.condition,
    })),
    computedButUnsurfaced: COMPUTED_BUT_UNSURFACED,
    pairs: pairResults.map((result) => ({
      pairId: result.pairId,
      leftId: result.leftId,
      rightId: result.rightId,
      score: result.score,
      // vectorSimilarity null means "undefined" in the handler output.
      features: {
        ...result.features,
        vectorSimilarity: featureValue(result.features.vectorSimilarity),
      },
      explanation: result.explanation,
      references: result.explanation.map((sentence) => {
        const condition = CONTRIBUTION_CONDITIONS.find(
          (c) => c.sentence === sentence,
        );
        return {
          sentence,
          kind: condition ? "supported_contribution" : "fallback",
          feature: condition ? condition.feature : null,
          condition: condition ? condition.condition : "no other condition fired",
          computedValue: condition
            ? featureValue(result.features[condition.feature])
            : null,
        };
      }),
    })),
  });

  // 4. Eligibility references: rule structures with real computed witnesses.
  const byId = new Map(pairResults.map((p) => [p.pairId, p]));
  jsonWrite(outDir, "eligibility-references.json", {
    rules: ELIGIBILITY_RULES.map((rule) => ({
      id: rule.id,
      source: rule.source,
      semantics: rule.semantics,
      witnesses: rule.witnesses.map((w) => ({
        pairId: w.pairId,
        feature: w.feature,
        computedValue: featureValue(byId.get(w.pairId)!.features[w.feature]),
      })),
    })),
  });

  console.log(
    `Emitted baseline: ${PROFILES.length} profiles, ${PAIRS.length} pairs, ` +
      `missing-user case: "${missingUser.errorMessage}"`,
  );
}

/** Run only when invoked directly (tsx emit-baseline.ts). */
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).replace(/\.ts$/, "") === path.resolve(__filename).replace(/\.ts$/, "");

if (invokedDirectly) {
  buildBaseline(path.join(__dirname, "results")).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
