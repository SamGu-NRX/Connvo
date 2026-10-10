/**
 * Reference tables used to audit the explanations the REAL entrypoint emits.
 *
 * The contribution table mirrors the explanation thresholds in
 * convex/matching/scoring.ts `generateScoreExplanation` (as of the source
 * hash recorded in results/source-hashes.json). It is used in two
 * directions:
 *  1. predict the explanation from computed features and require the real
 *     handler to agree (explanation fully determined by features);
 *  2. attach to every emitted sentence the feature witness that justifies it.
 *
 * The eligibility table records rule structures the fixtures are designed to
 * exercise. Witness VALUES are always taken from the real handler's output
 * at emit time — never from hand arithmetic.
 */

import type { CompatibilityFeatures } from "@convex/types/entities/matching";

export interface ContributionCondition {
  sentence: string;
  feature: keyof CompatibilityFeatures;
  /** Human-readable form of `holds`, mirroring scoring.ts. */
  condition: string;
  holds: (features: CompatibilityFeatures) => boolean;
}

export const FALLBACK_SENTENCE = "Basic compatibility based on available data";

export const CONTRIBUTION_CONDITIONS: ContributionCondition[] = [
  {
    sentence: "Strong interest alignment",
    feature: "interestOverlap",
    condition: "interestOverlap > 0.7",
    holds: (f) => f.interestOverlap > 0.7,
  },
  {
    sentence: "Some shared interests",
    feature: "interestOverlap",
    condition: "interestOverlap > 0.4 && interestOverlap <= 0.7",
    holds: (f) => f.interestOverlap > 0.4 && f.interestOverlap <= 0.7,
  },
  {
    sentence: "Ideal experience gap for mentorship",
    feature: "experienceGap",
    condition: "experienceGap === 1.0",
    holds: (f) => f.experienceGap === 1.0,
  },
  {
    sentence: "Similar experience levels",
    feature: "experienceGap",
    condition: "experienceGap > 0.7 && experienceGap !== 1.0",
    holds: (f) => f.experienceGap > 0.7 && f.experienceGap !== 1.0,
  },
  {
    sentence: "High semantic profile similarity",
    feature: "vectorSimilarity",
    condition: "vectorSimilarity != null && vectorSimilarity > 0.8",
    holds: (f) => f.vectorSimilarity != null && f.vectorSimilarity > 0.8,
  },
  {
    sentence: "Complementary professional roles",
    feature: "roleComplementarity",
    condition: "roleComplementarity === 1.0",
    holds: (f) => f.roleComplementarity === 1.0,
  },
  {
    sentence: "Strong language compatibility",
    feature: "languageOverlap",
    condition: "languageOverlap > 0.8",
    holds: (f) => f.languageOverlap > 0.8,
  },
];

/** Predict the explanation purely from computed features. */
export function predictedExplanation(
  features: CompatibilityFeatures,
): string[] {
  const fired = CONTRIBUTION_CONDITIONS.filter((c) =>
    c.holds(features),
  ).map((c) => c.sentence);
  return fired.length === 0 ? [FALLBACK_SENTENCE] : fired;
}

export interface RuleWitnessSpec {
  pairId: string;
  feature: keyof CompatibilityFeatures;
}

export interface EligibilityRuleSpec {
  id: string;
  source: string;
  /** Rule semantics AS IMPLEMENTED (not as idealized). */
  semantics: string;
  witnesses: RuleWitnessSpec[];
}

export const ELIGIBILITY_RULES: EligibilityRuleSpec[] = [
  {
    id: "ROLE_COMPLEMENTARY_PAIRS",
    source: "convex/matching/scoring.ts calculateRoleComplementarity",
    semantics:
      "Known complementary role pairs (mentor/mentee, founder/investor-advisor, " +
      "technical/business-engineering) contribute 1.0.",
    witnesses: [
      { pairId: "mentee-x-mentor", feature: "roleComplementarity" },
      { pairId: "mentor-x-peer", feature: "roleComplementarity" },
    ],
  },
  {
    id: "ROLE_SAME_ROLE",
    source: "convex/matching/scoring.ts calculateRoleComplementarity",
    semantics: "Identical roles on both sides contribute 0.7.",
    witnesses: [{ pairId: "mentee-x-design", feature: "roleComplementarity" }],
  },
  {
    id: "ROLE_UNRELATED",
    source: "convex/matching/scoring.ts calculateRoleComplementarity",
    semantics: "Roles with no known relation contribute 0.",
    witnesses: [{ pairId: "mentee-x-sparse", feature: "roleComplementarity" }],
  },
  {
    id: "EXPERIENCE_LEVEL_GAP",
    source: "convex/matching/scoring.ts calculateExperienceGap",
    semantics:
      "Experience levels map entry..executive to 1..6; gap 1-2 contributes 1.0, " +
      "gap 3 contributes 0.6, larger gaps contribute 0.3, gap 0 contributes 0.7.",
    witnesses: [
      { pairId: "mentee-x-mentor", feature: "experienceGap" },
      { pairId: "mentor-x-peer", feature: "experienceGap" },
      { pairId: "mentee-x-design", feature: "experienceGap" },
      { pairId: "mentee-x-sparse", feature: "experienceGap" },
    ],
  },
  {
    id: "PROFILE_MISSING_NEUTRAL",
    source: "convex/matching/scoring.ts calculateExperienceGap / calculateIndustryMatch / calculateLanguageOverlap",
    semantics:
      "A null profile document (or missing fields) yields the 0.5 neutral " +
      "for experience, industry, and language features.",
    witnesses: [
      { pairId: "mentee-x-sparse", feature: "experienceGap" },
      { pairId: "mentee-x-sparse", feature: "industryMatch" },
      { pairId: "mentee-x-sparse", feature: "languageOverlap" },
    ],
  },
  {
    id: "INDUSTRY_RELATED_FIELDS",
    source: "convex/matching/scoring.ts calculateIndustryMatch",
    semantics:
      "Fields whose names contain tokens from a related-field group " +
      "(technology/business/design) contribute 0.8.",
    witnesses: [{ pairId: "mentor-x-peer", feature: "industryMatch" }],
  },
  {
    id: "ORG_SAME_ORG_MISMATCH",
    source: "convex/matching/scoring.ts calculateOrgConstraintMatch",
    semantics:
      "When both sides declare constraints and either says same_org, the " +
      "outcome resolves by org equality: differing orgIds contribute 0.0. " +
      "(Note: identical constraint strings on both sides short-circuit " +
      "before this comparison — see ORG_IDENTICAL_CONSTRAINT_SHORT_CIRCUIT.)",
    witnesses: [{ pairId: "mentee-x-design", feature: "orgConstraintMatch" }],
  },
  {
    id: "ORG_IDENTICAL_CONSTRAINT_SHORT_CIRCUIT",
    source: "convex/matching/scoring.ts calculateOrgConstraintMatch",
    semantics:
      "Identical constraint strings short-circuit to 1.0 even when the " +
      "underlying orgIds differ (as-implemented behavior; recorded, not endorsed).",
    witnesses: [
      { pairId: "mentee-x-mentor", feature: "orgConstraintMatch" },
      { pairId: "mentor-x-peer", feature: "orgConstraintMatch" },
    ],
  },
  {
    id: "ORG_ONE_SIDED_SAME_ORG_DIFFERENT_ORGS",
    source: "convex/matching/scoring.ts calculateOrgConstraintMatch",
    semantics:
      "A one-sided same_org constraint against a differing org contributes 0.0.",
    witnesses: [{ pairId: "mentee-x-sparse", feature: "orgConstraintMatch" }],
  },
  {
    id: "TIMEZONE_PLACEHOLDER",
    source: "convex/matching/scoring.ts calculateCompatibilityFeatures",
    semantics:
      "timezoneCompatibility is hardcoded to 1.0: it derives from no " +
      "user-controlled data, so no explanation sentence can truthfully cite it.",
    witnesses: [
      { pairId: "mentee-x-mentor", feature: "timezoneCompatibility" },
      { pairId: "mentor-x-peer", feature: "timezoneCompatibility" },
      { pairId: "mentee-x-design", feature: "timezoneCompatibility" },
      { pairId: "mentee-x-sparse", feature: "timezoneCompatibility" },
    ],
  },
  {
    id: "VECTOR_MISSING_UNDEFINED",
    source: "convex/matching/scoring.ts calculateCompatibilityFeatures",
    semantics:
      "When either profile lacks an embedding (or the models differ), " +
      "vectorSimilarity is undefined and is excluded from the weighted score.",
    witnesses: [{ pairId: "mentee-x-mentor", feature: "vectorSimilarity" }],
  },
];

/**
 * Features computed but never surfaced by any explanation sentence, recorded
 * as an honest finding of the experiment.
 */
export const COMPUTED_BUT_UNSURFACED: { feature: keyof CompatibilityFeatures; note: string }[] = [
  {
    feature: "industryMatch",
    note:
      "industryMatch is computed (exact match 1.0, related fields 0.8, same " +
      "company 0.9, different 0.3) but no explanation sentence references it.",
  },
  {
    feature: "timezoneCompatibility",
    note:
      "timezoneCompatibility is a hardcoded 1.0 placeholder and no sentence " +
      "references it.",
  },
  {
    feature: "orgConstraintMatch",
    note:
      "orgConstraintMatch is computed (including the 0.0 falsified-same_org " +
      "case) but no explanation sentence references it.",
  },
];
