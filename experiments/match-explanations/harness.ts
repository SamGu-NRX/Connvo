/**
 * Offline binding to the REAL scoring/explanation entrypoint.
 *
 * The production Convex action `calculateCompatibilityScore`
 * (convex/matching/scoring.ts) is invoked through its registered handler
 * (`_handler` on the function object — the same handler Convex itself runs),
 * with a stub action context whose `runQuery` serves the controlled
 * synthetic profiles in place of `internal.matching.scoring.getUserScoringData`.
 *
 * NOTHING in convex/ is modified or monkey-patched. The only assumption is
 * that the handler reads user data exclusively through `ctx.runQuery`, which
 * is true of the source file recorded in results/source-hashes.json.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { calculateCompatibilityScore } from "@convex/matching/scoring";
import type { CompatibilityFeatures } from "@convex/types/entities/matching";

import {
  MISSING_USER_ID,
  PAIRS,
  PROFILES,
  type SyntheticProfile,
} from "./fixtures";

export interface ScoreOutput {
  score: number;
  features: CompatibilityFeatures;
  explanation: string[];
}

interface ScoringArgs {
  user1Id: string;
  user2Id: string;
  user1Constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
  };
  user2Constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
  };
  customWeights?: CompatibilityFeatures;
}

type RealHandler = (ctx: unknown, args: ScoringArgs) => Promise<ScoreOutput>;

/**
 * The real production handler, taken off the registered Convex function
 * object without modification. Fail fast if the runtime shape changes.
 */
export const REAL_SCORING_HANDLER: RealHandler = (() => {
  const fn = (
    calculateCompatibilityScore as unknown as {
      _handler?: unknown;
      isAction?: boolean;
      isInternal?: boolean;
    }
  )._handler;
  if (typeof fn !== "function") {
    throw new Error(
      "calculateCompatibilityScore no longer exposes _handler; the offline " +
        "binding needs a new approach. convex/ was NOT modified.",
    );
  }
  return fn as RealHandler;
})();

export interface StubContext {
  runQuery: (ref: unknown, args: { userId: string }) => Promise<unknown>;
  /** Audit trail: how the real handler fetched data (filled at runtime). */
  runQueryLog: { argNames: string[] }[];
}

/**
 * Stub action context: resolves `getUserScoringData` by userId from the
 * synthetic fixture store. Records every call for the audit trail.
 */
export function makeStubContext(
  store: SyntheticProfile[] = PROFILES,
): StubContext {
  const runQueryLog: { argNames: string[] }[] = [];
  return {
    runQueryLog,
    runQuery: async (
      _ref: unknown,
      args: { userId: string },
    ): Promise<unknown> => {
      runQueryLog.push({ argNames: Object.keys(args ?? {}) });
      const profile = store.find((p) => p.scoringData.user._id === args.userId);
      return profile ? profile.scoringData : null;
    },
  };
}

export interface PairResult {
  pairId: string;
  leftId: string;
  rightId: string;
  purpose: string;
  /** runQuery calls the real handler made while scoring this pair. */
  runQueryCalls: number;
  score: number;
  features: CompatibilityFeatures;
  explanation: string[];
}

/**
 * Score an arbitrary (possibly mutated) profile pair through the real
 * entrypoint, returning the full output (score, features, explanation).
 */
export async function runHandlerPairFull(
  left: SyntheticProfile,
  right: SyntheticProfile,
): Promise<ScoreOutput> {
  // Serve ONLY this pair's (possibly mutated) profiles, so counterfactual
  // mutations are actually observed by the real handler.
  const ctx = makeStubContext([left, right]);
  return REAL_SCORING_HANDLER(ctx, {
    user1Id: left.scoringData.user._id,
    user2Id: right.scoringData.user._id,
    user1Constraints: left.constraints,
    user2Constraints: right.constraints,
  });
}

/**
 * Score an arbitrary (possibly mutated) profile pair through the real
 * entrypoint and return only the computed features.
 */
export async function runHandlerPair(
  left: SyntheticProfile,
  right: SyntheticProfile,
): Promise<CompatibilityFeatures> {
  return (await runHandlerPairFull(left, right)).features;
}

/** Score every declared pair through the real entrypoint, in fixed order. */
export async function runAllPairs(): Promise<PairResult[]> {
  const results: PairResult[] = [];
  for (const pair of PAIRS) {
    const ctx = makeStubContext();
    const left = PROFILES.find((p) => p.id === pair.leftId) as SyntheticProfile;
    const right = PROFILES.find(
      (p) => p.id === pair.rightId,
    ) as SyntheticProfile;
    const output = await REAL_SCORING_HANDLER(ctx, {
      user1Id: left.scoringData.user._id,
      user2Id: right.scoringData.user._id,
      user1Constraints: left.constraints,
      user2Constraints: right.constraints,
    });
    results.push({
      pairId: pair.pairId,
      leftId: pair.leftId,
      rightId: pair.rightId,
      purpose: pair.purpose,
      runQueryCalls: ctx.runQueryLog.length,
      score: output.score,
      features: output.features,
      explanation: output.explanation,
    });
  }
  return results;
}

/** Outcome of scoring a pair where one user has no scoring data. */
export async function runMissingUserCase(): Promise<{ errorMessage: string }> {
  const ctx = makeStubContext();
  const left = PROFILES[0];
  try {
    await REAL_SCORING_HANDLER(ctx, {
      user1Id: left.scoringData.user._id,
      user2Id: MISSING_USER_ID,
      user1Constraints: left.constraints,
      user2Constraints: { interests: [], roles: [] },
    });
  } catch (error) {
    return { errorMessage: (error as Error).message };
  }
  throw new Error(
    "Expected the real handler to reject when user data is missing",
  );
}

/** Source files whose exact content this experiment is bound to. */
export const HASHED_SOURCES = [
  "convex/matching/scoring.ts",
  "convex/matching/engine.ts",
  "convex/matching/index.ts",
  "convex/types/entities/matching.ts",
  "convex/types/entities/embedding.ts",
  "convex/types/validators/matching.ts",
];

export function sha256File(repoRoot: string, relPath: string): string {
  const bytes = readFileSync(path.join(repoRoot, relPath));
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashAllSources(repoRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of HASHED_SOURCES) out[rel] = sha256File(repoRoot, rel);
  return out;
}

/** Repo root inferred from this file's location (experiments/match-explanations/…). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
