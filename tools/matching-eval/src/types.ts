/**
 * Shared types for the matching-quality evaluation harness.
 *
 * DESIGN INVARIANT (README §threat-model): matchers receive EvalProfile
 * and may read ONLY fields their subjects permitted. Latents and ground
 * truth live in separate modules that no matcher imports.
 */

export type RoleFamily = "build" | "product" | "gtm" | "operate";

/** Fields a subject may withhold from the matcher. */
export type PermittableField =
  | "experience"
  | "industry"
  | "timezone"
  | "organization";

export const ALL_FIELDS: PermittableField[] = [
  "experience",
  "industry",
  "timezone",
  "organization",
];

/** The eight pairwise features — Sam's current defaults, kept fixed. */
export const FEATURE_KEYS = [
  "interestOverlap",
  "vectorSimilarity",
  "experienceGap",
  "industryMatch",
  "timezoneCompatibility",
  "languageOverlap",
  "orgPreferenceFit",
  "roleComplementarity",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  interestOverlap: "Interest overlap",
  vectorSimilarity: "Profile-description similarity",
  experienceGap: "Experience complementarity",
  industryMatch: "Industry fit",
  timezoneCompatibility: "Timezone compatibility",
  languageOverlap: "Shared language",
  orgPreferenceFit: "Organization preference fit",
  roleComplementarity: "Role complementarity",
};

/** What the matcher sees. `permittedFields` gates feature extraction. */
export interface EvalProfile {
  id: string;
  displayName: string;
  roleFamily: RoleFamily;
  roleTitle: string;
  interests: string[];
  bio: string;
  /** Always-permitted coarse signal. */
  experienceBand: "0-2" | "3-6" | "7-12" | "13+";
  languages: string[];
  orgPreference: "same" | "different" | "none";
  /** Fields the subject allowed the matcher to use. */
  permittedFields: PermittableField[];
  /** Present only if "experience" is permitted. */
  experienceYears?: number;
  /** Present only if "industry" is permitted. */
  industry?: string;
  /** UTC offset in hours, only if "timezone" is permitted. */
  timezoneOffset?: number;
  /** Opaque org id, only if "organization" is permitted. */
  orgId?: string;
}

/** Hidden state — NEVER visible to matchers. */
export interface Latent {
  /** 16-dim taste vector; drives interests, bio phrasing, and G. */
  taste: number[];
  /** Response propensity multiplier. */
  sociability: number;
}

export interface Population {
  profiles: EvalProfile[];
  latents: Latent[];
  interests: string[];
  industries: string[];
  orgIds: string[];
}

export type MatchReasonFeature = FeatureKey;

export interface MatchReason {
  feature: MatchReasonFeature;
  /** Human sentence grounded in the contribution math. */
  text: string;
  /** Share of the positive score mass this feature contributed. */
  contribution: number;
}

export interface SuggestedMatch {
  userA: string;
  userB: string;
  score: number;
  reasons: MatchReason[];
}

export interface MatcherOutput {
  matches: SuggestedMatch[];
  /** Pairs the matcher explicitly declined to score (e.g. sparse data). */
  skipped?: Array<{ userA: string; userB: string; why: string }>;
}

export interface Matcher {
  readonly name: string;
  /** Human one-liner for the README comparison table. */
  readonly blurb: string;
  /** One-time setup (e.g. learning from outcomes). No-op for static matchers. */
  readonly adaptive: boolean;
  observe?(ctx: {
    population: Population;
    outcome: { userA: string; userB: string; outcome: "completed" | "no_show" | "declined" };
    features?: Record<FeatureKey, number>;
  }): void;
  round(ctx: {
    population: Population;
    round: number;
    embeddingCosine?: (a: string, b: string) => number | undefined;
  }): MatcherOutput;
}

export type PairOutcome = {
  userA: string;
  userB: string;
  outcome: "completed" | "no_show" | "declined";
};

export interface DirunResult {
  direction: string;
  matcher: string;
  /** Eight headline metrics, keyed for the dashboard. */
  metrics: Record<string, number>;
  /** Per-feature breakdown for the weights page. */
  featureStats?: Record<string, { mean: number; sd: number; usage: number }>;
  /** Raw per-round aggregates, kept for replay/debug. */
  rounds: Array<{
    round: number;
    matches: number;
    accepted: number;
    completed: number;
  }>;
}
