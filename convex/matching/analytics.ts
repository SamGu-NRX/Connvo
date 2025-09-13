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
import { mutation, query, action, internalQuery } from "../_generated/server";
import { requireIdentity } from "../auth/guards";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/**
 * Submit feedback for a match
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
  handler: async (ctx, args) => {
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
 * Get match history for a user
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
      features: v.object({
        interestOverlap: v.number(),
        experienceGap: v.number(),
        industryMatch: v.number(),
        timezoneCompatibility: v.number(),
        vectorSimilarity: v.optional(v.number()),
        orgConstraintMatch: v.number(),
        languageOverlap: v.number(),
        roleComplementarity: v.number(),
      }),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { userId } = await requireIdentity(ctx);
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    const matches = await ctx.db
      .query("matchingAnalytics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit + offset);

    return matches.slice(offset);
  },
});

/**
 * Get matching statistics for a user
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
  handler: async (ctx, args) => {
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

    // Calculate top features
    const featureStats: Record<string, { sum: number; count: number }> = {};

    matches.forEach((match) => {
      Object.entries(match.features).forEach(([feature, value]) => {
        if (typeof value === "number") {
          if (!featureStats[feature]) {
            featureStats[feature] = { sum: 0, count: 0 };
          }
          featureStats[feature].sum += value;
          featureStats[feature].count += 1;
        }
      });
    });

    const topFeatures = Object.entries(featureStats)
      .map(([feature, stats]) => ({
        feature,
        averageScore: stats.sum / stats.count,
        count: stats.count,
      }))
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
 * Get global matching analytics (admin only)
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
            const featureSum = Object.values(m.features).reduce(
              (s: number, v) => s + (typeof v === "number" ? v : 0),
              0,
            );
            return sum + featureSum / Object.keys(m.features).length;
          }, 0) / matches.length
        : 0;

    // Outcome distribution
    const outcomeDistribution = {
      accepted: matches.filter((m) => m.outcome === "accepted").length,
      declined: matches.filter((m) => m.outcome === "declined").length,
      completed: matches.filter((m) => m.outcome === "completed").length,
    };

    // Feature importance analysis
    const featureStats: Record<
      string,
      { scores: number[]; outcomes: string[] }
    > = {};

    matches.forEach((match) => {
      Object.entries(match.features).forEach(([feature, value]) => {
        if (typeof value === "number") {
          if (!featureStats[feature]) {
            featureStats[feature] = { scores: [], outcomes: [] };
          }
          featureStats[feature].scores.push(value);
          featureStats[feature].outcomes.push(match.outcome);
        }
      });
    });

    const featureImportance = Object.entries(featureStats)
      .map(([feature, stats]) => {
        const averageScore =
          stats.scores.reduce((sum, score) => sum + score, 0) /
          stats.scores.length;

        // Simple correlation with successful outcomes
        const successfulOutcomes = stats.outcomes.filter(
          (o) => o === "completed",
        ).length;
        const correlation = successfulOutcomes / stats.outcomes.length;

        return {
          feature,
          averageScore,
          correlation,
        };
      })
      .sort((a, b) => b.correlation - a.correlation);

    // Matching trends (daily aggregation)
    const dailyStats: Record<string, { count: number; totalScore: number }> =
      {};

    matches.forEach((match) => {
      const date = new Date(match.createdAt).toISOString().split("T")[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { count: 0, totalScore: 0 };
      }
      dailyStats[date].count += 1;

      const featureSum = Object.values(match.features).reduce(
        (s: number, v) => s + (typeof v === "number" ? v : 0),
        0,
      );
      dailyStats[date].totalScore +=
        featureSum / Object.keys(match.features).length;
    });

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
 * Optimize matching weights based on feedback
 */
export const optimizeMatchingWeights = action({
  args: {
    minSamples: v.optional(v.number()),
  },
  returns: v.object({
    optimizedWeights: v.object({
      interestOverlap: v.number(),
      experienceGap: v.number(),
      industryMatch: v.number(),
      timezoneCompatibility: v.number(),
      vectorSimilarity: v.number(),
      orgConstraintMatch: v.number(),
      languageOverlap: v.number(),
      roleComplementarity: v.number(),
    }),
    improvement: v.number(),
    sampleSize: v.number(),
  }),
  handler: async (ctx, args) => {
    const minSamples = args.minSamples ?? 100;

    // Get recent match data with feedback
    const matches = await ctx.runQuery(
      internal.matching.analytics.getMatchesForOptimization,
      { minSamples },
    );

    if (matches.length < minSamples) {
      throw new ConvexError(
        `Insufficient data for optimization. Need at least ${minSamples} samples, got ${matches.length}`,
      );
    }

    // Simple weight optimization using success correlation
    const features = [
      "interestOverlap",
      "experienceGap",
      "industryMatch",
      "timezoneCompatibility",
      "vectorSimilarity",
      "orgConstraintMatch",
      "languageOverlap",
      "roleComplementarity",
    ];

    const optimizedWeights: Record<string, number> = {};
    let totalWeight = 0;

    // Calculate correlation between each feature and successful outcomes
    features.forEach((feature) => {
      const featureValues = matches.map((m) => m.features[feature] || 0);
      const successValues = matches.map((m) =>
        m.outcome === "completed" ? 1 : 0,
      );

      const correlation = calculateCorrelation(featureValues, successValues);
      const weight = Math.max(0.01, correlation); // Minimum weight of 0.01

      optimizedWeights[feature] = weight;
      totalWeight += weight;
    });

    // Normalize weights to sum to 1
    Object.keys(optimizedWeights).forEach((feature) => {
      optimizedWeights[feature] /= totalWeight;
    });

    // Calculate improvement estimate
    const currentWeights = {
      interestOverlap: 0.25,
      experienceGap: 0.15,
      industryMatch: 0.1,
      timezoneCompatibility: 0.1,
      vectorSimilarity: 0.2,
      orgConstraintMatch: 0.05,
      languageOverlap: 0.1,
      roleComplementarity: 0.05,
    };

    const improvement = calculateWeightImprovement(
      matches,
      currentWeights,
      optimizedWeights,
    );

    const normalized: {
      interestOverlap: number;
      experienceGap: number;
      industryMatch: number;
      timezoneCompatibility: number;
      vectorSimilarity: number;
      orgConstraintMatch: number;
      languageOverlap: number;
      roleComplementarity: number;
    } = {
      interestOverlap: optimizedWeights["interestOverlap"] ?? 0,
      experienceGap: optimizedWeights["experienceGap"] ?? 0,
      industryMatch: optimizedWeights["industryMatch"] ?? 0,
      timezoneCompatibility: optimizedWeights["timezoneCompatibility"] ?? 0,
      vectorSimilarity: optimizedWeights["vectorSimilarity"] ?? 0,
      orgConstraintMatch: optimizedWeights["orgConstraintMatch"] ?? 0,
      languageOverlap: optimizedWeights["languageOverlap"] ?? 0,
      roleComplementarity: optimizedWeights["roleComplementarity"] ?? 0,
    };

    return {
      optimizedWeights: normalized,
      improvement,
      sampleSize: matches.length,
    };
  },
});

/**
 * Get matches for weight optimization (internal)
 */
export const getMatchesForOptimization = internalQuery({
  args: {
    minSamples: v.number(),
  },
  returns: v.array(
    v.object({
      features: v.object({
        interestOverlap: v.number(),
        experienceGap: v.number(),
        industryMatch: v.number(),
        timezoneCompatibility: v.number(),
        vectorSimilarity: v.optional(v.number()),
        orgConstraintMatch: v.number(),
        languageOverlap: v.number(),
        roleComplementarity: v.number(),
      }),
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
    const matches = await ctx.db
      .query("matchingAnalytics")
      .filter((q) => q.neq(q.field("outcome"), "accepted")) // Only declined or completed
      .order("desc")
      .take(args.minSamples * 2); // Get more to ensure we have enough good samples

    return matches
      .filter((m) => m.outcome === "completed" || m.outcome === "declined")
      .slice(0, args.minSamples)
      .map((m) => ({
        features: m.features as {
          interestOverlap: number;
          experienceGap: number;
          industryMatch: number;
          timezoneCompatibility: number;
          vectorSimilarity?: number;
          orgConstraintMatch: number;
          languageOverlap: number;
          roleComplementarity: number;
        },
        outcome: m.outcome,
        feedback: m.feedback,
      }));
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
