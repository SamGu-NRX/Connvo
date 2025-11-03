/**
 * Matching Analytics and Feedback System
 *
 * Implements comprehensive match outcome tracking, feedback collection,
 * and model improvement through analytics.
 *
 * Requirements: 12.4, 12.5 - Analytics and feedback loops
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v } from "convex/values";
import {
  mutation,
  query,
  action,
  internalQuery,
} from "@convex/_generated/server";
import { requireIdentity } from "@convex/auth/guards";
import { ConvexError } from "convex/values";
import { Id } from "@convex/_generated/dataModel";
import { internal } from "@convex/_generated/api";
import {
  MatchingAnalyticsV,
  compatibilityFeaturesV,
} from "@convex/types/validators/matching";
import type {
  CompatibilityFeatures,
  MatchOutcome,
} from "@convex/types/entities/matching";
import { FEATURE_KEYS } from "@convex/matching/index";

type FeatureKey = keyof CompatibilityFeatures;

/**
 * @summary Submit feedback for a match
 * @description Allows users to submit feedback and outcome for a match they participated in.
 * Updates the match analytics record with the outcome (accepted, declined, completed) and
 * optional rating and comments. Used to track match success and improve the matching algorithm.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "matchId": "match_jd7user123_jd7user456_1704067200000",
 *     "outcome": "completed",
 *     "feedback": {
 *       "rating": 5,
 *       "comments": "Great conversation, very insightful!"
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "CONVEX_ERROR",
 *     "message": "Rating must be between 1 and 5"
 *   }
 * }
 * ```
 */
export const submitMatchFeedback = mutation({
  args: {
    matchId: v.string(),
    outcome: v.union(
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("completed"),
    ),
    feedback: v.optional(
      v.object({
        rating: v.number(),
        comments: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireIdentity(ctx);

    // Validate rating if provided
    if (args.feedback?.rating !== undefined) {
      if (args.feedback.rating < 1 || args.feedback.rating > 5) {
        throw new ConvexError("Rating must be between 1 and 5");
      }
    }

    // Update the match outcome directly in analytics (safe fallback)
    const analyticsForMatch = await ctx.db
      .query("matchingAnalytics")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .collect();
    for (const doc of analyticsForMatch) {
      if (doc.userId === userId) {
        await ctx.db.patch(doc._id, {
          outcome: args.outcome,
          feedback: args.feedback,
        });
      }
    }

    return null;
  },
});

/**
 * @summary Get match history for a user
 * @description Retrieves the authenticated user's match history including outcomes, feedback,
 * and compatibility features for each match. Supports pagination with limit and offset.
 * Orders matches by creation time (most recent first).
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "limit": 20,
 *     "offset": 0
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": [
 *     {
 *       "_id": "jd7analytics123",
 *       "matchId": "match_jd7user123_jd7user456_1704067200000",
 *       "outcome": "completed",
 *       "feedback": {
 *         "rating": 5,
 *         "comments": "Great conversation!"
 *       },
 *       "features": {
 *         "interestOverlap": 0.85,
 *         "experienceGap": 1.0,
 *         "industryMatch": 0.7,
 *         "timezoneCompatibility": 1.0,
 *         "vectorSimilarity": 0.88,
 *         "orgConstraintMatch": 1.0,
 *         "languageOverlap": 0.9,
 *         "roleComplementarity": 1.0
 *       },
 *       "createdAt": 1704067200000
 *     }
 *   ]
 * }
 * ```
 */
export const getMatchHistory = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("matchingAnalytics"),
      matchId: v.string(),
      outcome: v.union(
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("completed"),
      ),
      feedback: v.optional(
        v.object({
          rating: v.number(),
          comments: v.optional(v.string()),
        }),
      ),
      features: compatibilityFeaturesV,
      createdAt: v.number(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"matchingAnalytics">;
      matchId: string;
      outcome: MatchOutcome;
      feedback?: { rating: number; comments?: string };
      features: CompatibilityFeatures;
      createdAt: number;
    }>
  > => {
    const { userId } = await requireIdentity(ctx);
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    const rows = await ctx.db
      .query("matchingAnalytics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit + offset);

    const mapped = rows.map((doc) => {
      const f = doc.features as Record<string, number | undefined>;

      const features: CompatibilityFeatures = {
        interestOverlap: f.interestOverlap ?? 0,
        experienceGap: f.experienceGap ?? 0,
        industryMatch: f.industryMatch ?? 0,
        timezoneCompatibility: f.timezoneCompatibility ?? 0,
        vectorSimilarity:
          typeof f.vectorSimilarity === "number"
            ? f.vectorSimilarity
            : undefined,
        orgConstraintMatch: f.orgConstraintMatch ?? 0,
        languageOverlap: f.languageOverlap ?? 0,
        roleComplementarity: f.roleComplementarity ?? 0,
      };

      return {
        _id: doc._id,
        matchId: doc.matchId,
        outcome: doc.outcome,
        feedback: doc.feedback,
        features,
        createdAt: doc.createdAt,
      };
    });

    return mapped.slice(offset);
  },
});

/**
 * @summary Get matching statistics for a user
 * @description Retrieves comprehensive matching statistics for the authenticated user including
 * total matches, success rate, average rating, and top compatibility features. Analyzes all
 * historical matches to provide insights into matching performance.
 *
 * @example request
 * ```json
 * {
 *   "args": {}
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "totalMatches": 15,
 *     "acceptedMatches": 12,
 *     "completedMatches": 10,
 *     "averageRating": 4.5,
 *     "successRate": 0.83,
 *     "topFeatures": [
 *       {
 *         "feature": "interestOverlap",
 *         "averageScore": 0.85,
 *         "count": 15
 *       },
 *       {
 *         "feature": "vectorSimilarity",
 *         "averageScore": 0.82,
 *         "count": 15
 *       },
 *       {
 *         "feature": "roleComplementarity",
 *         "averageScore": 0.78,
 *         "count": 15
 *       }
 *     ]
 *   }
 * }
 * ```
 */
export const getMatchingStats = query({
  args: {},
  returns: v.object({
    totalMatches: v.number(),
    acceptedMatches: v.number(),
    completedMatches: v.number(),
    averageRating: v.optional(v.number()),
    successRate: v.number(),
    topFeatures: v.array(
      v.object({
        feature: v.string(),
        averageScore: v.number(),
        count: v.number(),
      }),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    totalMatches: number;
    acceptedMatches: number;
    completedMatches: number;
    averageRating?: number;
    successRate: number;
    topFeatures: Array<{
      feature: string;
      averageScore: number;
      count: number;
    }>;
  }> => {
    const { userId } = await requireIdentity(ctx);

    const matches = await ctx.db
      .query("matchingAnalytics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const totalMatches = matches.length;
    const acceptedMatches = matches.filter(
      (m) => m.outcome === "accepted",
    ).length;
    const completedMatches = matches.filter(
      (m) => m.outcome === "completed",
    ).length;

    // Calculate average rating
    const ratingsWithFeedback = matches.filter((m) => m.feedback?.rating);
    const averageRating =
      ratingsWithFeedback.length > 0
        ? ratingsWithFeedback.reduce(
            (sum, m) => sum + (m.feedback?.rating ?? 0),
            0,
          ) / ratingsWithFeedback.length
        : undefined;

    // Calculate success rate (completed / accepted)
    const successRate =
      acceptedMatches > 0 ? completedMatches / acceptedMatches : 0;

    // Calculate top features (use FEATURE_KEYS to keep typing safe)
    const featureStats: Partial<
      Record<FeatureKey, { sum: number; count: number }>
    > = {};

    matches.forEach((match) => {
      const f = match.features as Record<string, number | undefined>;
      FEATURE_KEYS.forEach((feature) => {
        const value = f[feature];
        if (typeof value === "number") {
          if (!featureStats[feature]) {
            featureStats[feature] = { sum: 0, count: 0 };
          }
          featureStats[feature]!.sum += value;
          featureStats[feature]!.count += 1;
        }
      });
    });

    type TopFeature = {
      feature: FeatureKey;
      averageScore: number;
      count: number;
    };

    const topFeatures: TopFeature[] = FEATURE_KEYS.map((feature) => {
      const stats = featureStats[feature];
      if (!stats || stats.count <= 0) return null;
      const averageScore = stats.sum / stats.count;
      if (!Number.isFinite(averageScore)) return null;
      return { feature, averageScore, count: stats.count };
    })
      .filter((x): x is TopFeature => x !== null)
      .sort((a, b) => b.averageScore - a.averageScore)
      .slice(0, 5);

    return {
      totalMatches,
      acceptedMatches,
      completedMatches,
      averageRating,
      successRate,
      topFeatures,
    };
  },
});

/**
 * @summary Get global matching analytics (admin only)
 * @description Retrieves system-wide matching analytics including total matches, outcome distribution,
 * feature importance analysis, and matching trends over time. Requires admin permissions. Used for
 * monitoring matching system performance and identifying optimization opportunities.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "timeRange": 604800000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "totalMatches": 1250,
 *     "averageScore": 0.75,
 *     "outcomeDistribution": {
 *       "accepted": 980,
 *       "declined": 150,
 *       "completed": 820
 *     },
 *     "featureImportance": [
 *       {
 *         "feature": "interestOverlap",
 *         "averageScore": 0.82,
 *         "correlation": 0.78
 *       },
 *       {
 *         "feature": "vectorSimilarity",
 *         "averageScore": 0.79,
 *         "correlation": 0.75
 *       }
 *     ],
 *     "matchingTrends": [
 *       {
 *         "date": "2024-01-01",
 *         "matchCount": 180,
 *         "averageScore": 0.76
 *       },
 *       {
 *         "date": "2024-01-02",
 *         "matchCount": 175,
 *         "averageScore": 0.74
 *       }
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
 *     "message": "Admin access required"
 *   }
 * }
 * ```
 */
export const getGlobalMatchingAnalytics = query({
  args: {
    timeRange: v.optional(v.number()), // milliseconds
  },
  returns: v.object({
    totalMatches: v.number(),
    averageScore: v.number(),
    outcomeDistribution: v.object({
      accepted: v.number(),
      declined: v.number(),
      completed: v.number(),
    }),
    featureImportance: v.array(
      v.object({
        feature: v.string(),
        averageScore: v.number(),
        correlation: v.number(),
      }),
    ),
    matchingTrends: v.array(
      v.object({
        date: v.string(),
        matchCount: v.number(),
        averageScore: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { userId, orgRole } = await requireIdentity(ctx);

    // Check admin permissions
    if (orgRole !== "admin") {
      throw new ConvexError("Admin access required");
    }

    const timeRange = args.timeRange ?? 7 * 24 * 60 * 60 * 1000; // 7 days default
    const cutoffTime = Date.now() - timeRange;

    const matches = await ctx.db
      .query("matchingAnalytics")
      .filter((q) => q.gt(q.field("createdAt"), cutoffTime))
      .collect();

    const totalMatches = matches.length;
    const averageScore =
      matches.length > 0
        ? matches.reduce((sum, m) => {
            const f = m.features as Record<string, number | undefined>;
            const featureSum = FEATURE_KEYS.reduce(
              (s, key) =>
                s + (typeof f[key] === "number" ? (f[key] as number) : 0),
              0,
            );
            return sum + featureSum / FEATURE_KEYS.length;
          }, 0) / matches.length
        : 0;

    // Outcome distribution
    const outcomeDistribution = {
      accepted: matches.filter((m) => m.outcome === "accepted").length,
      declined: matches.filter((m) => m.outcome === "declined").length,
      completed: matches.filter((m) => m.outcome === "completed").length,
    };

    // Feature importance analysis
    const featureStats: Partial<
      Record<FeatureKey, { scores: number[]; outcomes: string[] }>
    > = {};

    matches.forEach((match) => {
      const f = match.features as Record<string, number | undefined>;
      FEATURE_KEYS.forEach((feature) => {
        const val = f[feature];
        if (typeof val === "number") {
          if (!featureStats[feature]) {
            featureStats[feature] = { scores: [], outcomes: [] };
          }
          featureStats[feature]!.scores.push(val);
          featureStats[feature]!.outcomes.push(match.outcome);
        }
      });
    });

    type FeatureImportance = {
      feature: FeatureKey;
      averageScore: number;
      correlation: number;
    };

    const featureImportance: FeatureImportance[] = FEATURE_KEYS.reduce<
      FeatureImportance[]
    >((acc, feature) => {
      const stats = featureStats[feature];
      if (!stats || stats.scores.length === 0 || stats.outcomes.length === 0) {
        return acc;
      }

      const total = stats.scores.reduce((s, score) => s + score, 0);
      const averageScore = total / stats.scores.length;
      if (!Number.isFinite(averageScore)) return acc;

      const successfulOutcomes = stats.outcomes.filter(
        (o) => o === "completed",
      ).length;
      const outcomesLen = stats.outcomes.length;
      const correlation =
        outcomesLen > 0 ? successfulOutcomes / outcomesLen : 0;
      if (!Number.isFinite(correlation)) return acc;

      acc.push({ feature, averageScore, correlation });
      return acc;
    }, []).sort((a, b) => b.correlation - a.correlation);

    // Matching trends (daily aggregation)
    const dailyStats: Record<string, { count: number; totalScore: number }> =
      {};

    for (const match of matches) {
      // Prefer explicit createdAt; fall back to system _creationTime or now.
      const ts =
        typeof match.createdAt === "number"
          ? match.createdAt
          : typeof match._creationTime === "number"
            ? match._creationTime
            : Date.now();

      const date = new Date(ts).toISOString().split("T")[0];

      if (!dailyStats[date]) {
        dailyStats[date] = { count: 0, totalScore: 0 };
      }
      dailyStats[date].count += 1;

      const f = match.features as Partial<CompatibilityFeatures>;
      let featureSum = 0;
      let numericCount = 0;

      // Iterate FEATURE_KEYS so indexing is typed (FeatureKey), not a plain string
      for (const key of FEATURE_KEYS) {
        const val = f[key];
        if (typeof val === "number" && Number.isFinite(val)) {
          featureSum += val;
          numericCount += 1;
        }
      }

      const avgForMatch = numericCount > 0 ? featureSum / numericCount : 0;
      dailyStats[date].totalScore += Number.isFinite(avgForMatch)
        ? avgForMatch
        : 0;
    }

    const matchingTrends = Object.entries(dailyStats)
      .map(([date, stats]) => ({
        date,
        matchCount: stats.count,
        averageScore: stats.totalScore / stats.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalMatches,
      averageScore,
      outcomeDistribution,
      featureImportance,
      matchingTrends,
    };
  },
});

/**
 * @summary Optimize matching weights based on feedback
 * @description Analyzes historical match outcomes and feedback to calculate optimized weights
 * for compatibility scoring factors. Uses correlation analysis to identify which features best
 * predict successful matches. Returns optimized weights, estimated improvement, and sample size.
 * Requires minimum number of samples for statistical validity.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "minSamples": 100
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "optimizedWeights": {
 *       "interestOverlap": 0.28,
 *       "experienceGap": 0.12,
 *       "industryMatch": 0.08,
 *       "timezoneCompatibility": 0.09,
 *       "vectorSimilarity": 0.24,
 *       "orgConstraintMatch": 0.04,
 *       "languageOverlap": 0.11,
 *       "roleComplementarity": 0.04
 *     },
 *     "improvement": 0.08,
 *     "sampleSize": 250
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
 *     "message": "Insufficient data for optimization. Need at least 100 samples, got 45"
 *   }
 * }
 * ```
 */
export const optimizeMatchingWeights = action({
  args: {
    minSamples: v.optional(v.number()),
  },
  returns: v.object({
    optimizedWeights: compatibilityFeaturesV,
    improvement: v.number(),
    sampleSize: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    optimizedWeights: CompatibilityFeatures;
    improvement: number;
    sampleSize: number;
  }> => {
    const minSamples = args.minSamples ?? 100;

    // Get recent match data with feedback
    const matches: Array<{
      features: CompatibilityFeatures;
      outcome: MatchOutcome;
      feedback?: { rating: number; comments?: string };
    }> = await ctx.runQuery(
      internal.matching.analytics.getMatchesForOptimization,
      { minSamples },
    );

    if (matches.length < minSamples) {
      throw new ConvexError(
        `Insufficient data for optimization. Need at least ${minSamples} samples, got ${matches.length}`,
      );
    }

    // Simple weight optimization using success correlation
    const featuresList = FEATURE_KEYS;
    const optimizedWeights: Partial<Record<FeatureKey, number>> = {};
    let totalWeight = 0;

    // Calculate correlation between each feature and successful outcomes
    featuresList.forEach((feature) => {
      const featureValues = matches.map(
        (m) => (m.features as any)[feature] || 0,
      );
      const successValues = matches.map((m) =>
        m.outcome === "completed" ? 1 : 0,
      );

      const correlation = calculateCorrelation(featureValues, successValues);
      const weight = Math.max(0.01, correlation); // Minimum weight of 0.01

      optimizedWeights[feature] = weight;
      totalWeight += weight;
    });

    // Normalize weights to sum to 1
    Object.keys(optimizedWeights).forEach((f) => {
      const k = f as FeatureKey;
      optimizedWeights[k] = (optimizedWeights[k] ?? 0) / totalWeight;
    });

    // Calculate improvement estimate
    const currentWeights: CompatibilityFeatures = {
      interestOverlap: 0.25,
      experienceGap: 0.15,
      industryMatch: 0.1,
      timezoneCompatibility: 0.1,
      vectorSimilarity: 0.2,
      orgConstraintMatch: 0.05,
      languageOverlap: 0.1,
      roleComplementarity: 0.05,
    };

    // coerce partial optimizedWeights into full record with defaults
    const optimizedFull: CompatibilityFeatures = FEATURE_KEYS.reduce(
      (acc, key) => {
        acc[key] = optimizedWeights[key] ?? 0;
        return acc;
      },
      {} as CompatibilityFeatures,
    );

    const improvement = calculateWeightImprovement(
      matches,
      currentWeights,
      optimizedFull,
    );

    const normalized: CompatibilityFeatures = {
      interestOverlap: optimizedFull.interestOverlap,
      experienceGap: optimizedFull.experienceGap,
      industryMatch: optimizedFull.industryMatch,
      timezoneCompatibility: optimizedFull.timezoneCompatibility,
      vectorSimilarity: optimizedFull.vectorSimilarity,
      orgConstraintMatch: optimizedFull.orgConstraintMatch,
      languageOverlap: optimizedFull.languageOverlap,
      roleComplementarity: optimizedFull.roleComplementarity,
    };

    return {
      optimizedWeights: normalized,
      improvement,
      sampleSize: matches.length,
    };
  },
});

/**
 * @summary Get matches for weight optimization (internal)
 * @description Retrieves recent match data with outcomes and feedback for use in weight optimization.
 * Filters for matches that have been declined or completed (not just accepted). Used internally
 * by the weight optimization algorithm to analyze match success patterns.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "minSamples": 100
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": [
 *     {
 *       "features": {
 *         "interestOverlap": 0.85,
 *         "experienceGap": 1.0,
 *         "industryMatch": 0.7,
 *         "timezoneCompatibility": 1.0,
 *         "vectorSimilarity": 0.88,
 *         "orgConstraintMatch": 1.0,
 *         "languageOverlap": 0.9,
 *         "roleComplementarity": 1.0
 *       },
 *       "outcome": "completed",
 *       "feedback": {
 *         "rating": 5,
 *         "comments": "Great match!"
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export const getMatchesForOptimization = internalQuery({
  args: {
    minSamples: v.number(),
  },
  returns: v.array(
    v.object({
      features: compatibilityFeaturesV,
      outcome: v.union(
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("completed"),
      ),
      feedback: v.optional(
        v.object({ rating: v.number(), comments: v.optional(v.string()) }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    // Get recent matches with feedback
    const rows = await ctx.db
      .query("matchingAnalytics")
      .filter((q) => q.neq(q.field("outcome"), "accepted")) // Only declined or completed
      .order("desc")
      .take(args.minSamples * 2); // Get more to ensure we have enough good samples

    // Map DB documents to the exact return shape the validator expects.
    return rows
      .filter((m) => m.outcome === "completed" || m.outcome === "declined")
      .slice(0, args.minSamples)
      .map((m) => {
        const f = m.features as Record<string, number | undefined>;
        return {
          features: {
            interestOverlap: f.interestOverlap ?? 0,
            experienceGap: f.experienceGap ?? 0,
            industryMatch: f.industryMatch ?? 0,
            timezoneCompatibility: f.timezoneCompatibility ?? 0,
            vectorSimilarity: f.vectorSimilarity,
            orgConstraintMatch: f.orgConstraintMatch ?? 0,
            languageOverlap: f.languageOverlap ?? 0,
            roleComplementarity: f.roleComplementarity ?? 0,
          },
          outcome: m.outcome as "completed" | "declined",
          feedback: m.feedback,
        };
      });
  },
});

/**
 * Helper functions
 */

function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const sumX = x.reduce((sum, val) => sum + val, 0);
  const sumY = y.reduce((sum, val) => sum + val, 0);
  const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
  const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
  const sumY2 = y.reduce((sum, val) => sum + val * val, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );

  return denominator === 0 ? 0 : numerator / denominator;
}

function calculateWeightImprovement(
  matches: any[],
  currentWeights: any,
  newWeights: any,
): number {
  // Simplified improvement calculation
  // In practice, this would use more sophisticated ML evaluation metrics

  let currentAccuracy = 0;
  let newAccuracy = 0;

  matches.forEach((match) => {
    const currentScore = Object.entries(match.features).reduce(
      (sum: number, [feature, value]) => {
        return (
          sum +
          (typeof value === "number" ? value : 0) *
            (currentWeights[feature] || 0)
        );
      },
      0,
    );

    const newScore = Object.entries(match.features).reduce(
      (sum: number, [feature, value]) => {
        return (
          sum +
          (typeof value === "number" ? value : 0) * (newWeights[feature] || 0)
        );
      },
      0,
    );

    const isSuccess = match.outcome === "completed";

    // Simple threshold-based accuracy
    if (currentScore > 0.6 === isSuccess) currentAccuracy += 1;
    if (newScore > 0.6 === isSuccess) newAccuracy += 1;
  });

  currentAccuracy /= matches.length;
  newAccuracy /= matches.length;

  return newAccuracy - currentAccuracy;
}

// Export internal functions
// Removed local `internal` export to avoid collisions with generated API
