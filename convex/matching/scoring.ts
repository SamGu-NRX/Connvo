/**
 * Compatibility Scoring Engine
 *
 * Implements multi-factor compatibility scoring using interest overlap,
 * experience gap, industry match, timezone compatibility, and vector similarity.
 *
 * Requirements: 12.2 - Multi-Factor Compatibility Scoring Engine
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalQuery,
} from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
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
 * Calculate compatibility score between two users (public API)
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
    const features = await calculateCompatibilityFeatures(
      ctx,
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
 * Calculate compatibility score between two users (internal)
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
    const features = await calculateCompatibilityFeatures(
      ctx,
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
 * Get user data needed for scoring calculations
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
 * Calculate all compatibility features between two users
 */
async function calculateCompatibilityFeatures(
  ctx: any, // Convex action context - keeping as any for simplicity
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
): Promise<CompatibilityFeatures> {
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

  // Vector similarity using Convex vector search
  let vectorSimilarity: number | undefined;
  if (
    user1Data.embedding &&
    user2Data.embedding &&
    user1Data.embedding.model === user2Data.embedding.model
  ) {
    // Convert ArrayBuffer to Float32Array for calculation
    const vector1 = new Float32Array(user1Data.embedding.vector);
    const vector2 = new Float32Array(user2Data.embedding.vector);
    vectorSimilarity = await calculateVectorSimilarity(
      ctx,
      Array.from(vector1),
      Array.from(vector2),
    );
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

/**
 * Calculate vector similarity using cosine similarity
 */
async function calculateVectorSimilarity(
  _ctx: any, // Convex context - not used in this function but kept for consistency
  vector1: number[],
  vector2: number[],
): Promise<number> {
  if (vector1.length !== vector2.length) return 0;

  // Calculate cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vector1.length; i++) {
    dotProduct += vector1[i] * vector2[i];
    norm1 += vector1[i] * vector1[i];
    norm2 += vector2[i] * vector2[i];
  }

  const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (magnitude === 0) return 0;

  // Convert from [-1, 1] to [0, 1] range
  return (dotProduct / magnitude + 1) / 2;
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
    "vectorSimilarity",
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
