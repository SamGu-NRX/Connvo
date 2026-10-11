/**
 * The evaluation's baseline direction calling MAIN's real scoring code.
 *
 * Review fix 2 (PR #32, 2026-10-11): the baseline must be Connvo's
 * production scorer, not a harness reimplementation — otherwise
 * "beats main" comparisons are meaningless. This adapter maps the
 * synthetic EvalProfile onto the inputs convex/matching/scoring.ts
 * actually consumes, calls the exported pure calculators, and scores
 * with main's DEFAULT_WEIGHTS via main's calculateWeightedScore.
 *
 * Documented adapter mappings (synthetic population -> main's inputs):
 * - experienceYears -> main's experience LEVEL strings (<2 entry, <5
 *     junior, <9 mid, <14 senior, <20 lead, else executive). Withheld
 *     or missing experience stays undefined (main returns neutral 0.5).
 * - industry -> profile field; the harness has no company field.
 * - orgPreference "same"/"different" -> main org constraints
 *     "same_org"/"different_org"; "none" stays undefined.
 * - roleFamily -> main role strings: build -> "technical",
 *     gtm/operate -> "business", product -> "product". Main's
 *     complementarity table has no "product" entry, so product pairs
 *     contribute zero there — a documented distortion of the synthetic
 *     vocabulary, not a scorer change.
 * - interests are used for BOTH user interests and constraint
 *     interests (the synthetic population has no separate constraint
 *     set), which collapses main's 0.7/0.3 actual/constraint weighting.
 * - timezone: main hardcodes compatibility to 1.0 — the baseline
 *     reproduces that exactly and consumes no timezone data.
 * - vector similarity: main maps cosine [-1,1] -> [0,1]; the harness
 *     cosine goes through the same mapping; missing embeddings leave
 *     the feature undefined so main's normalization skips it.
 *
 * Permission gating: withheld fields are passed as undefined so main's
 * calculators return their neutral values — no withheld field can move
 * the baseline score. Queue mechanics (cap 3, min score 0.55, top-up)
 * are the shared harness ones so directions differ only in scorer.
 */

import {
  DEFAULT_WEIGHTS,
  calculateExperienceGap,
  calculateIndustryMatch,
  calculateInterestOverlap,
  calculateLanguageOverlap,
  calculateOrgConstraintMatch,
  calculateRoleComplementarity,
  calculateWeightedScore,
} from "../../../convex/matching/scoring";
import type { CompatibilityFeatures } from "@convex/types/entities/matching";
import { buildQueue, type PairScored } from "./metrics";
import { buildReasons, permits } from "./features";
import type { EvalProfile, FeatureKey, MatchReason, Population, SuggestedMatch } from "./types";

export const REAL_PER_USER_CAP = 3;
export const REAL_MIN_SCORE = 0.55;
const TOPUP_FRAC = 0.1;

function experienceLevel(p: EvalProfile): string | undefined {
  const y = p.experienceYears;
  if (y === undefined) return undefined;
  if (y < 2) return "entry";
  if (y < 5) return "junior";
  if (y < 9) return "mid";
  if (y < 14) return "senior";
  if (y < 20) return "lead";
  return "executive";
}

function mainRole(p: EvalProfile): string {
  switch (p.roleFamily) {
    case "build":
      return "technical";
    case "gtm":
    case "operate":
      return "business";
    case "product":
      return "product";
  }
}

function orgConstraint(p: EvalProfile): string | undefined {
  if (p.orgPreference === "same") return "same_org";
  if (p.orgPreference === "different") return "different_org";
  return undefined;
}

/** Main's eight features for a pair, with permission-gated inputs. */
export function realScoringFeatures(
  a: EvalProfile,
  b: EvalProfile,
  cosAB: number | undefined,
): CompatibilityFeatures {
  const expBoth = permits(a, "experience") && permits(b, "experience");
  const indBoth = permits(a, "industry") && permits(b, "industry");
  const orgBoth = permits(a, "organization") && permits(b, "organization");

  return {
    interestOverlap: calculateInterestOverlap(
      a.interests,
      b.interests,
      a.interests,
      b.interests,
    ),
    experienceGap: expBoth
      ? calculateExperienceGap(experienceLevel(a), experienceLevel(b))
      : calculateExperienceGap(undefined, undefined),
    industryMatch: indBoth
      ? calculateIndustryMatch(a.industry, b.industry, undefined, undefined)
      : calculateIndustryMatch(undefined, undefined, undefined, undefined),
    // Main's scorer hardcodes timezone compatibility to 1.0.
    timezoneCompatibility: 1.0,
    vectorSimilarity: cosAB === undefined ? undefined : (cosAB + 1) / 2,
    orgConstraintMatch: orgBoth
      ? calculateOrgConstraintMatch(a.orgId, b.orgId, orgConstraint(a), orgConstraint(b))
      : calculateOrgConstraintMatch(undefined, undefined, undefined, undefined),
    languageOverlap: calculateLanguageOverlap(a.languages, b.languages),
    roleComplementarity: calculateRoleComplementarity([mainRole(a)], [mainRole(b)]),
  };
}

/** Main's feature record in harness FeatureKey slots (display mapping:
 *  orgConstraintMatch surfaces as orgPreferenceFit). */
function mainToHarnessKeys(f: CompatibilityFeatures): Record<FeatureKey, number> {
  return {
    interestOverlap: f.interestOverlap,
    vectorSimilarity: f.vectorSimilarity ?? 0.5,
    experienceGap: f.experienceGap,
    industryMatch: f.industryMatch,
    timezoneCompatibility: f.timezoneCompatibility,
    languageOverlap: f.languageOverlap,
    orgPreferenceFit: f.orgConstraintMatch,
    roleComplementarity: f.roleComplementarity,
  };
}

/** Main's DEFAULT_WEIGHTS in harness FeatureKey slots (same mapping). */
export const REAL_WEIGHTS: Record<FeatureKey, number> = {
  interestOverlap: DEFAULT_WEIGHTS.interestOverlap,
  vectorSimilarity: DEFAULT_WEIGHTS.vectorSimilarity,
  experienceGap: DEFAULT_WEIGHTS.experienceGap,
  industryMatch: DEFAULT_WEIGHTS.industryMatch,
  timezoneCompatibility: DEFAULT_WEIGHTS.timezoneCompatibility,
  languageOverlap: DEFAULT_WEIGHTS.languageOverlap,
  orgPreferenceFit: DEFAULT_WEIGHTS.orgConstraintMatch,
  roleComplementarity: DEFAULT_WEIGHTS.roleComplementarity,
};

function usedFieldsFor(a: EvalProfile, b: EvalProfile): string[] {
  const used: string[] = [];
  if (permits(a, "experience") && permits(b, "experience")) used.push("experience");
  if (permits(a, "industry") && permits(b, "industry")) used.push("industry");
  if (permits(a, "organization") && permits(b, "organization")) used.push("organization");
  return used;
}

/** Same top-up semantics as the shared selector (sparse-user fill). */
function realTopUp(
  pairs: PairScored[],
  matches: SuggestedMatch[],
  perUserCap: number,
  populationSize: number,
): SuggestedMatch[] {
  const chosen = new Set<string>();
  const count = new Map<string, number>();
  for (const m of matches) {
    chosen.add(`${m.userA}|${m.userB}`);
    count.set(m.userA, (count.get(m.userA) ?? 0) + 1);
    count.set(m.userB, (count.get(m.userB) ?? 0) + 1);
  }
  const eligible = pairs.filter((p) => p.score > 0.3).sort((x, y) => y.score - x.score);
  const out = matches.slice();
  const cap = Math.ceil(TOPUP_FRAC * populationSize);
  for (const p of eligible) {
    if (out.length >= cap && out.length >= matches.length + 15) break;
    const key = `${p.a.id}|${p.b.id}`;
    if (chosen.has(key)) continue;
    if ((count.get(p.a.id) ?? 0) >= perUserCap) continue;
    if ((count.get(p.b.id) ?? 0) >= perUserCap) continue;
    chosen.add(key);
    count.set(p.a.id, (count.get(p.a.id) ?? 0) + 1);
    count.set(p.b.id, (count.get(p.b.id) ?? 0) + 1);
    out.push({ userA: p.a.id, userB: p.b.id, score: p.score, reasons: [] });
  }
  return out;
}

function realFinish(
  pairs: PairScored[],
  matches: Array<{ userA: string; userB: string; score: number }>,
): SuggestedMatch[] {
  const byPair = new Map<string, PairScored>();
  for (const p of pairs) byPair.set(`${p.a.id}|${p.b.id}`, p);
  return matches.map((m) => {
    const p = byPair.get(`${m.userA}|${m.userB}`);
    const reasons: MatchReason[] = p
      ? buildReasons(p.features, REAL_WEIGHTS)
      : [];
    return { ...m, reasons };
  });
}

/** Score every pair with main's real scorer, queue with shared mechanics. */
export function realScoringSelect(
  population: Population,
  cos: ((a: string, b: string) => number | undefined) | undefined,
): { matches: SuggestedMatch[]; pairs: PairScored[] } {
  const pairs: PairScored[] = [];
  const profiles = population.profiles;
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i];
      const b = profiles[j];
      const cosAB = cos ? cos(a.id, b.id) : undefined;
      const mainFeatures = realScoringFeatures(a, b, cosAB);
      const score = calculateWeightedScore(mainFeatures, DEFAULT_WEIGHTS);
      pairs.push({
        a,
        b,
        features: mainToHarnessKeys(mainFeatures),
        score,
        usedFields: usedFieldsFor(a, b),
      });
    }
  }
  const raw = buildQueue(pairs, { perUserCap: REAL_PER_USER_CAP, minScore: REAL_MIN_SCORE });
  const withTopUp = realTopUp(pairs, raw, REAL_PER_USER_CAP, profiles.length);
  return { matches: realFinish(pairs, withTopUp), pairs };
}
