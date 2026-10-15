/**
 * Compatibility Scoring Engine
 *
 * Implements multi-factor compatibility scoring using interest overlap,
 * experience gap, industry match, timezone compatibility, and more.
 *
 * Requirements: 12.2 - Multi-Factor Compatibility Scoring Engine
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalQuery,
  type QueryCtx,
} from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConvexError } from "convex/values";

import {
  compatibilityFeaturesV,
  constraintsV,
  UserScoringDataV,
} from "@convex/types/validators/matching";
import type {
  CompatibilityFeatures,
  UserScoringData,
} from "@convex/types/entities/matching";

/**
 * Scoring weights validator (matches CompatibilityFeatures)
 */
const scoringWeightsV = v.object({
  interestOverlap: v.number(),
  experienceGap: v.number(),
  industryMatch: v.number(),
  timezoneCompatibility: v.number(),
  orgConstraintMatch: v.number(),
  languageOverlap: v.number(),
  roleComplementarity: v.number(),
});

/**
 * Default scoring weights (can be adjusted based on analytics)
 */
const DEFAULT_WEIGHTS: CompatibilityFeatures = {
  interestOverlap: 0.25,
  experienceGap: 0.15,
  industryMatch: 0.1,
  timezoneCompatibility: 0.1,
  orgConstraintMatch: 0.05,
  languageOverlap: 0.1,
  roleComplementarity: 0.05,
};

/**
 * @summary Calculate compatibility score between two users
 * @description Calculates a comprehensive compatibility score between two users using multiple
 * factors including interest overlap, experience gap, industry match, timezone compatibility,
 * vector similarity, and more. Returns the overall score (0-1), individual feature scores, and
 * a human-readable explanation. Can optionally use custom weights for scoring factors.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "user1Id": "jd7user123",
 *     "user2Id": "jd7user456",
 *     "user1Constraints": {
 *       "interests": ["technology", "ai", "startups"],
 *       "roles": ["mentor", "founder"]
 *     },
 *     "user2Constraints": {
 *       "interests": ["ai", "machine-learning", "startups"],
 *       "roles": ["mentee", "engineer"]
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "score": 0.82,
 *     "features": {
 *       "interestOverlap": 0.85,
 *       "experienceGap": 1.0,
 *       "industryMatch": 0.7,
 *       "timezoneCompatibility": 1.0,
 *       "orgConstraintMatch": 1.0,
 *       "languageOverlap": 0.9,
 *       "roleComplementarity": 1.0
 *     },
 *     "explanation": [
 *       "Strong interest alignment",
 *       "Ideal experience gap for mentorship",
 *       "Complementary professional roles"
 *     ]
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "CONVEX_ERROR",
 *     "message": "User data not found for scoring"
 *   }
 * }
 * ```
 */
export const calculateCompatibilityScore = action({
  args: {
    user1Id: v.id("users"),
    user2Id: v.id("users"),
    user1Constraints: constraintsV,
    user2Constraints: constraintsV,
    customWeights: v.optional(scoringWeightsV),
  },
  returns: v.object({
    score: v.number(),
    features: compatibilityFeaturesV,
    explanation: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    score: number;
    features: CompatibilityFeatures;
    explanation: string[];
  }> => {
    // Get user profiles and data
    const [user1Data, user2Data] = await Promise.all([
      ctx.runQuery(internal.matching.scoring.getUserScoringData, {
        userId: args.user1Id,
      }),
      ctx.runQuery(internal.matching.scoring.getUserScoringData, {
        userId: args.user2Id,
      }),
    ]);

    if (!user1Data || !user2Data) {
      throw new ConvexError("User data not found for scoring");
    }

    // Calculate individual features
    const features = calculateCompatibilityFeatures(
      user1Data,
      user2Data,
      args.user1Constraints,
      args.user2Constraints,
    );

    // Apply weights and calculate final score
    const weights = args.customWeights ?? DEFAULT_WEIGHTS;
    const score = calculateWeightedScore(features, weights);

    // Generate explanation
    const explanation = generateScoreExplanation(features, weights);

    return {
      score,
      features,
      explanation,
    };
  },
});

/**
 * @summary Calculate compatibility score between two users (internal)
 * @description Internal version of compatibility score calculation used by the matching engine.
 * Identical functionality to the public API but accessible only to internal Convex functions.
 * Calculates multi-factor compatibility score with optional custom weights.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "user1Id": "jd7user123",
 *     "user2Id": "jd7user456",
 *     "user1Constraints": {
 *       "interests": ["technology", "ai"],
 *       "roles": ["mentor"]
 *     },
 *     "user2Constraints": {
 *       "interests": ["ai", "machine-learning"],
 *       "roles": ["mentee"]
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "score": 0.82,
 *     "features": {
 *       "interestOverlap": 0.85,
 *       "experienceGap": 1.0,
 *       "industryMatch": 0.7,
 *       "timezoneCompatibility": 1.0,
 *       "orgConstraintMatch": 1.0,
 *       "languageOverlap": 0.9,
 *       "roleComplementarity": 1.0
 *     },
 *     "explanation": [
 *       "Strong interest alignment",
 *       "Ideal experience gap for mentorship"
 *     ]
 *   }
 * }
 * ```
 */
export const calculateCompatibilityScoreInternal = internalAction({
  args: {
    user1Id: v.id("users"),
    user2Id: v.id("users"),
    user1Constraints: constraintsV,
    user2Constraints: constraintsV,
    customWeights: v.optional(scoringWeightsV),
  },
  returns: v.object({
    score: v.number(),
    features: compatibilityFeaturesV,
    explanation: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get user profiles and data
    const [user1Data, user2Data] = await Promise.all([
      ctx.runQuery(internal.matching.scoring.getUserScoringData, {
        userId: args.user1Id,
      }),
      ctx.runQuery(internal.matching.scoring.getUserScoringData, {
        userId: args.user2Id,
      }),
    ]);

    if (!user1Data || !user2Data) {
      throw new ConvexError("User data not found for scoring");
    }

    // Calculate individual features
    const features = calculateCompatibilityFeatures(
      user1Data,
      user2Data,
      args.user1Constraints,
      args.user2Constraints,
    );

    // Apply weights and calculate final score
    const weights = args.customWeights ?? DEFAULT_WEIGHTS;
    const score = calculateWeightedScore(features, weights);

    // Generate explanation
    const explanation = generateScoreExplanation(features, weights);

    return {
      score,
      features,
      explanation,
    };
  },
});

/**
 * @summary Get user data needed for scoring calculations
 * @description Retrieves all data needed to calculate compatibility scores for a user including
 * profile information and interests. Returns null if user not found.
 * Used internally by scoring functions to gather user data efficiently.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "jd7user123"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "user": {
 *       "_id": "jd7user123",
 *       "displayName": "Alice Johnson",
 *       "orgId": "org_abc123",
 *       "orgRole": "member"
 *     },
 *     "profile": {
 *       "experience": "senior",
 *       "languages": ["English", "Spanish"],
 *       "field": "Technology",
 *       "company": "TechCorp"
 *     },
 *     "interests": ["technology", "ai", "startups", "mentorship"],
 *   }
 * }
 * ```
 *
 * @example response-null
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 */
export const getUserScoringData = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), UserScoringDataV.full),
  handler: async (ctx, args) => readUserScoringData(ctx, args.userId),
});

export async function readUserScoringData(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<UserScoringData | null> {
  const user = await ctx.db.get(userId);
  if (!user) return null;

  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  const userInterests = await ctx.db
    .query("userInterests")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const interests = userInterests.map((ui) => ui.interestKey);

  return {
    user: {
      _id: user._id,
      displayName: user.displayName,
      orgId: user.orgId,
      orgRole: user.orgRole,
    },
    profile: profile
      ? {
          experience: profile.experience,
          languages: profile.languages,
          field: profile.field,
          company: profile.company,
        }
      : null,
    interests,
  };
}

/**
 * Calculate all compatibility features between two users
 */
function calculateCompatibilityFeatures(
  user1Data: UserScoringData,
  user2Data: UserScoringData,
  user1Constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
  },
  user2Constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
  },
): CompatibilityFeatures {
  // Interest overlap calculation
  const interestOverlap = calculateInterestOverlap(
    user1Data.interests,
    user2Data.interests,
    user1Constraints.interests,
    user2Constraints.interests,
  );

  // Experience gap calculation
  const experienceGap = calculateExperienceGap(
    user1Data.profile?.experience,
    user2Data.profile?.experience,
  );

  // Industry/field match
  const industryMatch = calculateIndustryMatch(
    user1Data.profile?.field,
    user2Data.profile?.field,
    user1Data.profile?.company,
    user2Data.profile?.company,
  );

  // Language overlap
  const languageOverlap = calculateLanguageOverlap(
    user1Data.profile?.languages ?? [],
    user2Data.profile?.languages ?? [],
  );

  // Role complementarity
  const roleComplementarity = calculateRoleComplementarity(
    user1Constraints.roles,
    user2Constraints.roles,
  );

  // Org constraint match
  const orgConstraintMatch = calculateOrgConstraintMatch(
    user1Data.user.orgId,
    user2Data.user.orgId,
    user1Constraints.orgConstraints,
    user2Constraints.orgConstraints,
  );

  // Timezone compatibility (simplified - would need actual timezone data)
  const timezoneCompatibility = 1.0; // Placeholder - implement with real timezone logic

  return {
    interestOverlap,
    experienceGap,
    industryMatch,
    timezoneCompatibility,
    orgConstraintMatch,
    languageOverlap,
    roleComplementarity,
  };
}

/**
 * Calculate interest overlap score
 */
function calculateInterestOverlap(
  user1Interests: string[],
  user2Interests: string[],
  user1ConstraintInterests: string[],
  user2ConstraintInterests: string[],
): number {
  // Calculate overlap between actual interests
  const actualOverlap = user1Interests.filter((interest) =>
    user2Interests.includes(interest),
  ).length;

  // Calculate overlap between constraint interests
  const constraintOverlap = user1ConstraintInterests.filter((interest) =>
    user2ConstraintInterests.includes(interest),
  ).length;

  // Weight actual interests more heavily than constraints

  const actualWeight = 0.7;
  const constraintWeight = 0.3;

  const actualScore =
    actualOverlap /
    Math.max(Math.min(user1Interests.length, user2Interests.length), 1);
  const constraintScore =
    constraintOverlap /
    Math.max(
      Math.min(
        user1ConstraintInterests.length,
        user2ConstraintInterests.length,
      ),
      1,
    );

  return Math.min(
    actualWeight * actualScore + constraintWeight * constraintScore,
    1.0,
  );
}

/**
 * Calculate experience gap score (complementary experience is good)
 */
function calculateExperienceGap(
  experience1?: string,
  experience2?: string,
): number {
  if (!experience1 || !experience2) return 0.5; // Neutral if missing data

  // Simple experience level mapping
  const experienceLevels: Record<string, number> = {
    entry: 1,
    junior: 2,
    mid: 3,
    senior: 4,
    lead: 5,
    executive: 6,
  };

  const level1 = experienceLevels[experience1.toLowerCase()];
  const level2 = experienceLevels[experience2.toLowerCase()];
  if (level1 === undefined || level2 === undefined) return 0.5;

  const gap = Math.abs(level1 - level2);

  // Optimal gap is 1-2 levels (mentorship opportunity)
  if (gap === 0) return 0.7; // Same level is good
  if (gap === 1 || gap === 2) return 1.0; // Ideal gap
  if (gap === 3) return 0.6; // Acceptable gap
  return 0.3; // Large gap
}

/**
 * Calculate industry/field match score
 */
function calculateIndustryMatch(
  field1?: string,
  field2?: string,
  company1?: string,
  company2?: string,
): number {
  if (!field1 || !field2) return 0.5; // Neutral if missing data

  // Exact field match
  if (field1.toLowerCase() === field2.toLowerCase()) return 1.0;

  // Related fields (simplified - would use more sophisticated matching)
  const relatedFields: Record<string, string[]> = {
    technology: ["software", "engineering", "data", "ai", "ml"],
    business: ["marketing", "sales", "finance", "consulting"],
    design: ["ux", "ui", "product", "creative"],
  };

  for (const [, fields] of Object.entries(relatedFields)) {
    if (
      fields.some((f) => field1.toLowerCase().includes(f)) &&
      fields.some((f) => field2.toLowerCase().includes(f))
    ) {
      return 0.8;
    }
  }

  // Same company bonus
  if (
    company1 &&
    company2 &&
    company1.toLowerCase() === company2.toLowerCase()
  ) {
    return 0.9;
  }

  return 0.3; // Different fields
}

/**
 * Calculate language overlap score
 */
function calculateLanguageOverlap(
  languages1: string[],
  languages2: string[],
): number {
  if (languages1.length === 0 || languages2.length === 0) return 0.5;

  const overlap = languages1.filter((lang) => languages2.includes(lang)).length;
  const maxLanguages = Math.max(languages1.length, languages2.length);

  return overlap / maxLanguages;
}

/**
 * Calculate role complementarity score
 */
function calculateRoleComplementarity(
  roles1: string[],
  roles2: string[],
): number {
  // Define complementary role pairs
  const complementaryRoles: Record<string, string[]> = {
    mentor: ["mentee", "junior"],
    mentee: ["mentor", "senior"],
    founder: ["investor", "advisor"],
    investor: ["founder", "entrepreneur"],
    technical: ["business", "product"],
    business: ["technical", "engineering"],
  };

  let maxComplementarity = 0;

  for (const role1 of roles1) {
    for (const role2 of roles2) {
      if (role1 === role2) {
        maxComplementarity = Math.max(maxComplementarity, 0.7); // Same role
      } else if (
        complementaryRoles[role1.toLowerCase()]?.includes(role2.toLowerCase())
      ) {
        maxComplementarity = Math.max(maxComplementarity, 1.0); // Complementary
      }
    }
  }

  return maxComplementarity;
}

/**
 * Calculate org constraint match score
 */
function calculateOrgConstraintMatch(
  orgId1?: string,
  orgId2?: string,
  constraint1?: string,
  constraint2?: string,
): number {
  // If no constraints, neutral score
  if (!constraint1 && !constraint2) return 1.0;

  // Same org constraint
  if (constraint1 === constraint2) return 1.0;

  // Actual org matching
  if (orgId1 && orgId2) {
    if (constraint1 === "same_org" || constraint2 === "same_org") {
      return orgId1 === orgId2 ? 1.0 : 0.0;
    }
    if (constraint1 === "different_org" || constraint2 === "different_org") {
      return orgId1 !== orgId2 ? 1.0 : 0.0;
    }
  }

  return 0.5; // Neutral if constraints don't match
}

/**
 * Calculate weighted final score
 */
function calculateWeightedScore(
  features: CompatibilityFeatures,
  weights: CompatibilityFeatures,
): number {
  let totalScore = 0;
  let totalWeight = 0;

  // Use typed iteration to avoid index signature issues
  const featureKeys: (keyof CompatibilityFeatures)[] = [
    "interestOverlap",
    "experienceGap",
    "industryMatch",
    "timezoneCompatibility",
    "orgConstraintMatch",
    "languageOverlap",
    "roleComplementarity",
  ];

  for (const feature of featureKeys) {
    const value = features[feature];
    const weight = weights[feature];
    if (typeof value === "number" && typeof weight === "number") {
      totalScore += value * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * Generate human-readable explanation of the score
 */
function generateScoreExplanation(
  features: CompatibilityFeatures,
  _weights: CompatibilityFeatures,
): string[] {
  const explanations: string[] = [];

  if (features.interestOverlap > 0.7) {
    explanations.push("Strong interest alignment");
  } else if (features.interestOverlap > 0.4) {
    explanations.push("Some shared interests");
  }

  if (features.experienceGap === 1.0) {
    explanations.push("Ideal experience gap for mentorship");
  } else if (features.experienceGap > 0.7) {
    explanations.push("Similar experience levels");
  }

  if (features.roleComplementarity === 1.0) {
    explanations.push("Complementary professional roles");
  }

  if (features.languageOverlap > 0.8) {
    explanations.push("Strong language compatibility");
  }

  if (explanations.length === 0) {
    explanations.push("Basic compatibility based on available data");
  }

  return explanations;
}

// Functions are available via generated internal API under internal.matching.scoring

/** Queue pairing uses recorded profile evidence; timezone data is not stored yet. */
export function scoreQueuePair(user1: UserScoringData, user2: UserScoringData) {
  const constraints1 = { interests: user1.interests, roles: [] };
  const constraints2 = { interests: user2.interests, roles: [] };
  const features = calculateCompatibilityFeatures(
    user1,
    user2,
    constraints1,
    constraints2,
  );
  const weights = { ...DEFAULT_WEIGHTS, timezoneCompatibility: 0 };
  const factors: Array<{ contribution: number; reason: string }> = [];
  const add = (feature: keyof CompatibilityFeatures, reason: string) => {
    factors.push({
      contribution: (features[feature] ?? 0) * (weights[feature] ?? 0),
      reason,
    });
  };
  if (features.interestOverlap > 0.4)
    add(
      "interestOverlap",
      features.interestOverlap > 0.7
        ? "Strong interest alignment"
        : "Some shared interests",
    );
  if (
    user1.profile?.experience &&
    user2.profile?.experience &&
    features.experienceGap === 1
  )
    add("experienceGap", "Complementary experience levels");
  if (
    user1.profile?.field &&
    user2.profile?.field &&
    features.industryMatch >= 0.8
  )
    add("industryMatch", "Professional background in common");
  if (
    user1.profile?.languages.length &&
    user2.profile?.languages.length &&
    features.languageOverlap > 0
  )
    add("languageOverlap", "A shared language for your conversation");
  return {
    score: calculateWeightedScore(features, weights),
    features,
    reasons: factors
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 2)
      .map((factor) => factor.reason),
  };
}

// ---------------------------------------------------------------------------
// Asynchronous matcher score (docs/plan/MATCHING-PLAN.md, "How matching works").
//
// The weights live here and are starting guesses, not tuned values. They stay
// as written until there are at least 200 outcomes (plan section 9).
// ---------------------------------------------------------------------------

/** The weights of the deterministic matcher score; they sum to 1. */
export const MATCHER_WEIGHTS = {
  interests: 0.45,
  goal: 0.3,
  experience: 0.15,
  field: 0.1,
} as const;

/** A minimal, serializable person for the matcher score. */
export interface MatcherPerson {
  userId: string | Id<"users">;
  intents: string[];
  /** Raw profile-catalog interest keys. */
  interests: string[];
  field?: string | null;
  jobTitle?: string | null;
  experience?: string | null;
}

/** Small synonym/alias map; LinkedUp's normalizer is the starting point. */
const TAG_SYNONYMS: Record<string, string> = {
  ai: "artificial intelligence",
  ml: "machine learning",
  js: "javascript",
  ts: "typescript",
  nodejs: "node",
  reactjs: "react",
  nextjs: "next",
  vc: "venture capital",
  llms: "llm",
};

/** Normalize an interest tag: lowercase, collapse separators, alias, singular. */
export function normalizeInterestTag(tag: string): string {
  const cleaned = tag
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
  const aliased = TAG_SYNONYMS[cleaned] ?? cleaned;
  // Simple singular: "startups" -> "startup", but keep "stress" or "bus".
  if (aliased.length > 4 && aliased.endsWith("s") && !aliased.endsWith("ss")) {
    return aliased.slice(0, -1);
  }
  return aliased;
}

/**
 * Interest overlap weighted by inverse document frequency: sharing "rust" or
 * "bouldering" counts for more than sharing "technology". `docFrequency` maps
 * a normalized tag to the number of eligible profiles holding it; `totalDocs`
 * is the eligible population of the run. The score is the rarity-weighted
 * fraction of the smaller interest set that the pair shares.
 */
export function rarityWeightedInterestOverlap(
  interestsA: string[],
  interestsB: string[],
  docFrequency: Map<string, number>,
  totalDocs: number,
): { score: number; shared: string[] } {
  const tagsA = [...new Set(interestsA.map(normalizeInterestTag))];
  const tagsB = [...new Set(interestsB.map(normalizeInterestTag))];
  if (tagsA.length === 0 || tagsB.length === 0) {
    return { score: 0, shared: [] };
  }
  const idf = (tag: string) =>
    Math.log(1 + totalDocs / (1 + (docFrequency.get(tag) ?? 0)));
  const shared = tagsA.filter((t) => tagsB.includes(t));
  if (shared.length === 0) return { score: 0, shared: [] };
  // Rarest shared tags first, for the reasons.
  shared.sort((a, b) => idf(b) - idf(a) || a.localeCompare(b));
  const smaller = tagsA.length <= tagsB.length ? tagsA : tagsB;
  const denominator = smaller.reduce((sum, t) => sum + idf(t), 0);
  const numerator = shared.reduce((sum, t) => sum + idf(t), 0);
  return { score: denominator > 0 ? numerator / denominator : 0, shared };
}

/**
 * Goal fit from a small explicit table, keyed by the sorted intent pair.
 * Mentor and mentee is the strongest; collaborator pairs and hiring with
 * job-seeking are strong; peers in the same field come next; someone
 * exploring a field paired with someone working in one comes after that;
 * anything else is weak.
 */
export const GOAL_FIT: Record<string, number> = {
  "find_mentor|mentor": 1.0,
  "collaborate|collaborate": 0.9,
  "hiring|job_seeking": 0.9,
  "peers|peers": 0.7,
  "explore_field|find_mentor": 0.6,
  "explore_field|hiring": 0.6,
  "explore_field|mentor": 0.6,
  "explore_field|peers": 0.6,
  "explore_field|collaborate": 0.6,
  "explore_field|explore_field": 0.4,
  "explore_field|job_seeking": 0.4,
  "find_mentor|find_mentor": 0.2,
  "hiring|hiring": 0.2,
  "job_seeking|job_seeking": 0.3,
  "mentor|mentor": 0.2,
  "find_mentor|job_seeking": 0.5,
};

export function goalPairKey(intentsA: string[], intentsB: string[]): string {
  return [intentsA[0] ?? "", intentsB[0] ?? ""].sort().join("|");
}

export function goalFit(intentsA: string[], intentsB: string[]): number {
  const key = goalPairKey(intentsA, intentsB);
  return GOAL_FIT[key] ?? 0.2;
}

/** Rough years of experience per profile level, for mentorship distance. */
const EXPERIENCE_YEARS: Record<string, number> = {
  entry: 1,
  junior: 3,
  mid: 6,
  senior: 9,
  lead: 14,
  executive: 18,
};

function yearsOf(experience?: string | null): number | null {
  if (!experience) return null;
  return EXPERIENCE_YEARS[experience.toLowerCase()] ?? null;
}

function isMentorshipPair(intentsA: string[], intentsB: string[]): boolean {
  return goalPairKey(intentsA, intentsB) === "find_mentor|mentor";
}

/**
 * Experience alignment. For mentorship the mentor should have roughly 3 to 10
 * more years; peers should be close; other pairs are neutral.
 */
export function experienceFit(
  a: MatcherPerson,
  b: MatcherPerson,
): number {
  const yearsA = yearsOf(a.experience);
  const yearsB = yearsOf(b.experience);
  if (yearsA === null || yearsB === null) return 0.5;
  if (isMentorshipPair(a.intents, b.intents)) {
    const mentorYears = a.intents.includes("mentor") ? yearsA : yearsB;
    const menteeYears = mentorYears === yearsA ? yearsB : yearsA;
    const gap = mentorYears - menteeYears;
    if (gap >= 3 && gap <= 10) return 1.0;
    if (gap >= 1 && gap <= 12) return 0.7;
    return 0.3;
  }
  const gap = Math.abs(yearsA - yearsB);
  if (goalPairKey(a.intents, b.intents) === "peers|peers") {
    return gap <= 2 ? 1.0 : gap <= 4 ? 0.6 : 0.3;
  }
  return gap <= 4 ? 0.8 : 0.5;
}

/** Field closeness: exact field match, or neutral when data is missing. */
export function fieldFit(a: MatcherPerson, b: MatcherPerson): number {
  if (!a.field || !b.field) return 0.5;
  return a.field.toLowerCase() === b.field.toLowerCase() ? 1.0 : 0.4;
}

export interface MatcherScore {
  /** 0-1 deterministic score. */
  score: number;
  /** Shared normalized interest tags, rarest first. */
  sharedTags: string[];
  /** The sorted intent pair that drove the goal fit, for the reasons. */
  goalPairKey: string;
  /** Per-feature contributions, for picking the top reasons. */
  features: { interests: number; goal: number; experience: number; field: number };
}

/** The deterministic matcher score for an allowed pair. */
export function scoreMatcherPair(
  a: MatcherPerson,
  b: MatcherPerson,
  docFrequency: Map<string, number>,
  totalDocs: number,
): MatcherScore {
  const interests = rarityWeightedInterestOverlap(
    a.interests,
    b.interests,
    docFrequency,
    totalDocs,
  );
  const goal = goalFit(a.intents, b.intents);
  const experience = experienceFit(a, b);
  const field = fieldFit(a, b);
  const score =
    interests.score * MATCHER_WEIGHTS.interests +
    goal * MATCHER_WEIGHTS.goal +
    experience * MATCHER_WEIGHTS.experience +
    field * MATCHER_WEIGHTS.field;
  return {
    score,
    sharedTags: interests.shared,
    goalPairKey: goalPairKey(a.intents, b.intents),
    features: { interests: interests.score, goal, experience, field },
  };
}
