/**
 * Compatibility Scoring Engine
 *
 * Implements multi-factor compatibility scoring using interest overlap,
 * experience gap, industry match, timezone compatibility, and vector similarity.
 *
 * Requirements: 12.2 - Multi-Factor Compatibility Scoring Engine
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v, ConvexError } from "convex/values";
import type { Infer } from "convex/values";
import {
  action,
  internalAction,
  internalQuery,
} from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import {
  compatibilityFeaturesV,
  constraintsV,
  UserScoringDataV,
} from "@convex/types/validators/matching";
import type {
  CompatibilityFeatures,
  UserScoringData,
} from "@convex/types/entities/matching";
import { VectorUtils } from "@convex/types/entities/embedding";
import { requireIdentity } from "@convex/auth/guards";
import { assertNumberInRange, MATCHING_LIMITS } from "@convex/matching/validators";
import type { MatchingConstraintsInput } from "@convex/matching/validators";
import { createError } from "@convex/lib/errors";

/**
 * Scoring weights validator (matches CompatibilityFeatures)
 */
const scoringWeightsV = v.object({
  interestOverlap: v.number(),
  experienceGap: v.number(),
  industryMatch: v.number(),
  timezoneCompatibility: v.number(),
  vectorSimilarity: v.number(),
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
  vectorSimilarity: 0.2,
  orgConstraintMatch: 0.05,
  languageOverlap: 0.1,
  roleComplementarity: 0.05,
};

/**
 * Weight keys in canonical order, shared by boundary validation and scoring.
 */
const SCORING_WEIGHT_KEYS = [
  "interestOverlap",
  "experienceGap",
  "industryMatch",
  "timezoneCompatibility",
  "vectorSimilarity",
  "orgConstraintMatch",
  "languageOverlap",
  "roleComplementarity",
] as const satisfies readonly (keyof CompatibilityFeatures)[];

/** Weights as accepted at the boundary: every key present (validator-checked). */
type ScoringWeights = Infer<typeof scoringWeightsV>;

/**
 * Throws a VALIDATION_ERROR unless every custom weight is a finite number in
 * [MIN_SCORE, MAX_SCORE] (NaN is rejected by the finite check as well).
 */
function assertValidCustomWeights(weights: ScoringWeights): void {
  for (const key of SCORING_WEIGHT_KEYS) {
    assertNumberInRange(key, weights[key], {
      min: MATCHING_LIMITS.MIN_SCORE,
      max: MATCHING_LIMITS.MAX_SCORE,
    });
  }
}

/** Throws a VALIDATION_ERROR when both ids refer to the same user. */
function assertDistinctUsers(
  user1Id: Id<"users">,
  user2Id: Id<"users">,
): void {
  if (user1Id === user2Id) {
    throw createError.validation("user2Id: must differ from user1Id");
  }
}

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
 *       "vectorSimilarity": 0.88,
 *       "orgConstraintMatch": 1.0,
 *       "languageOverlap": 0.9,
 *       "roleComplementarity": 1.0
 *     },
 *     "explanation": [
 *       "Strong interest alignment",
 *       "Ideal experience gap for mentorship",
 *       "High semantic profile similarity",
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
  handler: async (ctx, args): Promise<ScoreCompatibilityResult> => {
    // Authenticate before anything else: this action derives interest- and
    // role-based data, so unauthenticated callers must not reach it.
    await requireIdentity(ctx);

    assertDistinctUsers(args.user1Id, args.user2Id);
    if (args.customWeights !== undefined) {
      assertValidCustomWeights(args.customWeights);
    }

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

    const weights = args.customWeights ?? DEFAULT_WEIGHTS;
    return scoreCompatibility(
      user1Data,
      user2Data,
      args.user1Constraints,
      args.user2Constraints,
      weights,
    );
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
 *       "vectorSimilarity": 0.88,
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
  handler: async (ctx, args): Promise<ScoreCompatibilityResult> => {
    // Internal callers (the matching engine) are trusted; internal Convex
    // functions skip identity checks by design.
    assertDistinctUsers(args.user1Id, args.user2Id);
    if (args.customWeights !== undefined) {
      assertValidCustomWeights(args.customWeights);
    }

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

    const weights = args.customWeights ?? DEFAULT_WEIGHTS;
    return scoreCompatibility(
      user1Data,
      user2Data,
      args.user1Constraints,
      args.user2Constraints,
      weights,
    );
  },
});

/**
 * @summary Get user data needed for scoring calculations
 * @description Retrieves all data needed to calculate compatibility scores for a user including
 * profile information, interests, and latest embedding vector. Returns null if user not found.
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
 *     "embedding": {
 *       "vector": "<ArrayBuffer>",
 *       "model": "text-embedding-3-small"
 *     }
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
  handler: async (ctx, args): Promise<UserScoringData | null> => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      // `.unique()` throws if more than one profile matches this user: the
      // schema assumes one profile per user without enforcing it, so a
      // duplicate fails loudly here instead of scoring arbitrary profile data.
      .unique();

    const userInterests = await ctx.db
      .query("userInterests")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const interests = userInterests.map((ui) => ui.interestKey);

    // Get latest user embedding for vector similarity
    const embedding = await ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", "user").eq("sourceId", args.userId),
      )
      .order("desc")
      .first();

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
      embedding: embedding
        ? {
            vector: embedding.vector, // Already ArrayBuffer from schema
            model: embedding.model,
          }
        : null,
    };
  },
});

/**
 * Shared pure scoring core used by both the public and internal actions.
 * Takes already-loaded user data and returns the full result — no ctx, no I/O.
 */
function scoreCompatibility(
  user1Data: UserScoringData,
  user2Data: UserScoringData,
  user1Constraints: MatchingConstraintsInput,
  user2Constraints: MatchingConstraintsInput,
  weights: CompatibilityFeatures,
): ScoreCompatibilityResult {
  const features = calculateCompatibilityFeatures(
    user1Data,
    user2Data,
    user1Constraints,
    user2Constraints,
  );
  const score = calculateWeightedScore(features, weights);
  const explanation = generateScoreExplanation(features);
  return { score, features, explanation };
}

interface ScoreCompatibilityResult {
  score: number;
  features: CompatibilityFeatures;
  explanation: string[];
}

/**
 * Calculate all compatibility features between two users.
 * Pure: derives every feature from the loaded user data and constraints.
 */
function calculateCompatibilityFeatures(
  user1Data: UserScoringData,
  user2Data: UserScoringData,
  user1Constraints: MatchingConstraintsInput,
  user2Constraints: MatchingConstraintsInput,
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

  // Vector similarity using centralized utilities
  let vectorSimilarity: number | undefined;
  if (
    user1Data.embedding &&
    user2Data.embedding &&
    user1Data.embedding.model === user2Data.embedding.model
  ) {
    // Convert ArrayBuffer to Float32Array using centralized utilities
    const vector1 = VectorUtils.bufferToFloatArray(user1Data.embedding.vector);
    const vector2 = VectorUtils.bufferToFloatArray(user2Data.embedding.vector);

    // Calculate cosine similarity using centralized utility
    const similarity = VectorUtils.cosineSimilarity(vector1, vector2);
    // Convert from [-1, 1] to [0, 1] range
    vectorSimilarity = (similarity + 1) / 2;
  }

  return {
    interestOverlap,
    experienceGap,
    industryMatch,
    timezoneCompatibility,
    vectorSimilarity,
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

  const level1 = experienceLevels[experience1.toLowerCase()] ?? 3;
  const level2 = experienceLevels[experience2.toLowerCase()] ?? 3;

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

// Vector similarity calculation is now handled by centralized VectorUtils

/**
 * Calculate weighted final score.
 *
 * The iteration is precisely typed: every feature except vectorSimilarity is
 * a required number, so no runtime type checks are needed here. An absent
 * vectorSimilarity skips both the feature and its weight, re-normalizing the
 * score over the features actually present.
 */
function calculateWeightedScore(
  features: CompatibilityFeatures,
  weights: CompatibilityFeatures,
): number {
  let totalScore = 0;
  let totalWeight = 0;

  for (const key of SCORING_WEIGHT_KEYS) {
    if (key === "vectorSimilarity") {
      const similarity = features.vectorSimilarity;
      if (similarity === undefined) continue;
      // Validated custom weights and DEFAULT_WEIGHTS always define this;
      // 0 contributes nothing, matching the skip semantics.
      const weight = weights.vectorSimilarity ?? 0;
      totalScore += similarity * weight;
      totalWeight += weight;
    } else {
      const value = features[key];
      const weight = weights[key];
      totalScore += value * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * Generate human-readable explanation of the score
 */
function generateScoreExplanation(features: CompatibilityFeatures): string[] {
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

  if (features.vectorSimilarity && features.vectorSimilarity > 0.8) {
    explanations.push("High semantic profile similarity");
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
