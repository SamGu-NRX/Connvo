/**
 * Permission-gated pair features.
 *
 * THE enforcement point for who-may-use-what: every feature returns
 * NEUTRAL (0.5) when either side withholds the field it consumes.
 * Neutral must neither help nor hurt relative to "unknown".
 *
 * usedFields is returned per pair so the permission differential test
 * can verify no non-permitted field flowed into the score.
 */

import type { EvalProfile, FeatureKey, MatchReason } from "./types";

export const NEUTRAL = 0.5;

export type FeatureRecord = Record<FeatureKey, number>;

export interface FeatureOutput {
  features: FeatureRecord;
  /** Which permittable fields were actually consumed for this pair. */
  usedFields: string[];
}

export const permits = (p: EvalProfile, field: string): boolean =>
  p.permittedFields.includes(field as EvalProfile["permittedFields"][number]);

/** Role-family complementarity — public knowledge, fixed matrix. */
export const FAMILY_COMPLEMENT: Record<string, Record<string, number>> = {
  build: { build: 0.6, product: 0.95, gtm: 0.85, operate: 0.5 },
  product: { product: 0.6, build: 0.95, gtm: 0.9, operate: 0.7 },
  gtm: { gtm: 0.55, build: 0.85, product: 0.9, operate: 0.75 },
  operate: { operate: 0.6, build: 0.5, product: 0.7, gtm: 0.75 },
};

export function jaccard(a: string[], b: string[]): number {
  const setB = new Set(b);
  let inter = 0;
  for (const x of new Set(a)) if (setB.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function cosineSim(
  u: number[] | undefined,
  v: number[] | undefined,
): number | undefined {
  if (!u || !v || u.length !== v.length) return undefined;
  let dot = 0;
  let nu = 0;
  let nv = 0;
  for (let i = 0; i < u.length; i++) {
    dot += u[i] * v[i];
    nu += u[i] * u[i];
    nv += v[i] * v[i];
  }
  const den = Math.sqrt(nu * nv);
  return den < 1e-12 ? undefined : dot / den;
}

/** Compute all eight features with permission gating. */
export function computeFeatures(
  a: EvalProfile,
  b: EvalProfile,
  embeddingCosine: number | undefined,
): FeatureOutput {
  const usedFields: string[] = [];
  const features = {} as FeatureRecord;

  // 1. interestOverlap (always permitted)
  features.interestOverlap = jaccard(a.interests, b.interests);

  // 2. vectorSimilarity (bio is built from always-permitted content)
  features.vectorSimilarity = embeddingCosine ?? NEUTRAL;

  // 3. experienceGap — complementarity peaks at |delta| = 4y
  if (permits(a, "experience") && permits(b, "experience")) {
    usedFields.push("experience");
    const d = Math.abs((a.experienceYears ?? 0) - (b.experienceYears ?? 0));
    features.experienceGap = Math.exp(-Math.pow(d - 4, 2) / 18);
  } else {
    features.experienceGap = NEUTRAL;
  }

  // 4. industryMatch
  if (permits(a, "industry") && permits(b, "industry")) {
    usedFields.push("industry");
    features.industryMatch = a.industry === b.industry ? 1 : 0.45;
  } else {
    features.industryMatch = NEUTRAL;
  }

  // 5. timezoneCompatibility — plausible shared call hours from offsets
  if (permits(a, "timezone") && permits(b, "timezone")) {
    usedFields.push("timezone");
    const d = Math.abs((a.timezoneOffset ?? 0) - (b.timezoneOffset ?? 0));
    features.timezoneCompatibility = Math.max(0, 1 - Math.pow(d / 10, 1.5));
  } else {
    features.timezoneCompatibility = NEUTRAL;
  }

  // 6. languageOverlap (always permitted)
  const shared = a.languages.filter((l) => b.languages.includes(l)).length;
  const smaller = Math.min(a.languages.length, b.languages.length);
  features.languageOverlap = smaller === 0 ? 0 : shared / smaller;

  // 7. orgPreferenceFit — needs org ids from both sides
  if (permits(a, "organization") && permits(b, "organization")) {
    usedFields.push("organization");
    const sameOrg = a.orgId === b.orgId;
    const wantsSame = a.orgPreference === "same" || b.orgPreference === "same";
    const wantsDiff =
      a.orgPreference === "different" || b.orgPreference === "different";
    if (sameOrg) features.orgPreferenceFit = wantsSame ? 1 : 0.55;
    else features.orgPreferenceFit = wantsDiff ? 1 : 0.7;
  } else {
    features.orgPreferenceFit = NEUTRAL;
  }

  // 8. roleComplementarity (always permitted)
  features.roleComplementarity = FAMILY_COMPLEMENT[a.roleFamily][b.roleFamily];

  return { features, usedFields };
}

/** Sam's current default weights (convex/matching/scoring.ts DEFAULT_WEIGHTS). */
export const SAM_DEFAULT_WEIGHTS: Record<FeatureKey, number> = {
  interestOverlap: 0.3,
  vectorSimilarity: 0.25,
  experienceGap: 0.1,
  industryMatch: 0.05,
  timezoneCompatibility: 0.1,
  languageOverlap: 0.1,
  orgPreferenceFit: 0.05,
  roleComplementarity: 0.05,
};

export function weightedSum(
  features: FeatureRecord,
  weights: Record<FeatureKey, number>,
): number {
  let s = 0;
  let wTotal = 0;
  for (const k of Object.keys(features) as FeatureKey[]) {
    s += weights[k] * features[k];
    wTotal += weights[k];
  }
  return wTotal === 0 ? 0 : s / wTotal;
}

export const REASON_TEXT: Record<FeatureKey, string> = {
  interestOverlap: "You share interests with this person",
  vectorSimilarity: "Your profile descriptions point the same direction",
  experienceGap: "Your experience levels complement each other",
  industryMatch: "You work in related industries",
  timezoneCompatibility: "Your time zones overlap for a call",
  languageOverlap: "You share a language",
  orgPreferenceFit: "Your organization preference fits",
  roleComplementarity: "Your roles complement each other",
};

/** Structured, contribution-grounded reasons for the top features. */
export function buildReasons(
  features: FeatureRecord,
  weights: Record<FeatureKey, number>,
  maxReasons = 3,
): MatchReason[] {
  const contribs = (Object.keys(features) as FeatureKey[])
    .map((k) => ({ key: k, c: weights[k] * features[k] }))
    .sort((x, y) => y.c - x.c);
  const total = contribs.reduce((acc, x) => acc + x.c, 0);
  const reasons: MatchReason[] = [];
  for (const { key, c } of contribs.slice(0, maxReasons)) {
    if (total <= 0) break;
    const share = c / total;
    if (share <= 0.01) continue;
    reasons.push({ feature: key, text: REASON_TEXT[key], contribution: share });
  }
  return reasons;
}
