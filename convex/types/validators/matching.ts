/**
 * Matching System Validators
 *
 * This module provides Convex validators that correspond to the Matching entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns for ML systems
 */

import { v } from "convex/values";
import type {
  MatchingQueueEntry,
  MatchingAnalytics,
  CompatibilityFeatures,
  MatchResult,
  QueueStatus,
  MatchResultWithUsers,
  MatchingPreferences,
  MatchingAlgorithmConfig,
  MatchingStats,
  MatchFeedback,
  MatchingEvent,
} from "../entities/matching";

// Matching status validator
const matchingStatusV = v.union(
  v.literal("waiting"),
  v.literal("matched"),
  v.literal("expired"),
  v.literal("cancelled"),
);

// Match outcome validator
const matchOutcomeV = v.union(
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("completed"),
);

// Numeric map validator (matches lib/validators.ts)
const numericMapV = v.record(v.string(), v.number());

// Constraints validator
export const constraintsV = v.object({
  interests: v.array(v.string()),
  roles: v.array(v.string()),
  orgConstraints: v.optional(v.string()),
});

// Compatibility features validator
export const compatibilityFeaturesV = v.object({
  interestOverlap: v.number(),
  experienceGap: v.number(),
  industryMatch: v.number(),
  timezoneCompatibility: v.number(),
  vectorSimilarity: v.optional(v.number()),
  orgConstraintMatch: v.number(),
  languageOverlap: v.number(),
  roleComplementarity: v.number(),
});

// Core Matching Queue validators (matches schema exactly)
export const MatchingQueueV = {
  // Full queue entry
  full: v.object({
    _id: v.id("matchingQueue"),
    userId: v.id("users"),
    availableFrom: v.number(),
    availableTo: v.number(),
    constraints: constraintsV,
    status: matchingStatusV,
    matchedWith: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  // Queue status with metadata
  status: v.object({
    _id: v.id("matchingQueue"),
    userId: v.id("users"),
    availableFrom: v.number(),
    availableTo: v.number(),
    constraints: constraintsV,
    status: matchingStatusV,
    matchedWith: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    estimatedWaitTime: v.optional(v.number()),
    queuePosition: v.optional(v.number()),
    potentialMatches: v.optional(v.number()),
  }),
} as const;

// Matching Analytics validators (matches schema exactly)
export const MatchingAnalyticsV = {
  full: v.object({
    _id: v.id("matchingAnalytics"),
    userId: v.id("users"),
    matchId: v.string(),
    outcome: matchOutcomeV,
    feedback: v.optional(
      v.object({
        rating: v.number(),
        comments: v.optional(v.string()),
      }),
    ),
    features: numericMapV, // Matches numericMapV
    weights: numericMapV, // Matches numericMapV
    createdAt: v.number(),
  }),
} as const;

// Match Result validators
export const MatchResultV = {
  // Basic match result
  basic: v.object({
    user1Id: v.id("users"),
    user2Id: v.id("users"),
    score: v.number(),
    features: compatibilityFeaturesV,
    explanation: v.array(v.string()),
    matchId: v.string(),
  }),

  // Match result with user details
  withUsers: v.object({
    user1Id: v.id("users"),
    user2Id: v.id("users"),
    score: v.number(),
    features: compatibilityFeaturesV,
    explanation: v.array(v.string()),
    matchId: v.string(),
    user1: v.object({
      _id: v.id("users"),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
    }),
    user2: v.object({
      _id: v.id("users"),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
    }),
    scheduledMeetingId: v.optional(v.id("meetings")),
  }),
} as const;

// Matching Preferences validators
export const MatchingPreferencesV = {
  full: v.object({
    userId: v.id("users"),
    availableForMatching: v.boolean(),
    preferredMeetingDuration: v.number(), // minutes
    timeZone: v.string(),
    availableHours: v.object({
      start: v.string(), // HH:MM format
      end: v.string(), // HH:MM format
    }),
    constraints: v.object({
      interests: v.array(v.string()),
      roles: v.array(v.string()),
      orgConstraints: v.optional(v.string()),
      experienceLevel: v.optional(
        v.union(
          v.literal("junior"),
          v.literal("mid"),
          v.literal("senior"),
          v.literal("executive"),
        ),
      ),
      industryPreferences: v.optional(v.array(v.string())),
    }),
    blacklist: v.array(v.id("users")), // Users to avoid matching with
    whitelist: v.optional(v.array(v.id("users"))), // Preferred users (if any)
  }),
} as const;

// Matching Algorithm Config validators
export const MatchingAlgorithmConfigV = {
  full: v.object({
    version: v.string(),
    weights: compatibilityFeaturesV,
    thresholds: v.object({
      minimumScore: v.number(),
      maximumMatches: v.number(),
      timeoutMinutes: v.number(),
    }),
    features: v.object({
      useVectorSimilarity: v.boolean(),
      useOrgConstraints: v.boolean(),
      useTimeZoneMatching: v.boolean(),
      useFeedbackLearning: v.boolean(),
    }),
    updatedAt: v.number(),
  }),
} as const;

// Matching Statistics validators
export const MatchingStatsV = {
  full: v.object({
    totalMatches: v.number(),
    successfulMatches: v.number(),
    averageWaitTime: v.number(),
    averageMatchScore: v.number(),
    topFeatures: v.array(
      v.object({
        feature: v.string(), // keyof CompatibilityFeatures
        importance: v.number(),
      }),
    ),
    userSatisfaction: v.object({
      averageRating: v.number(),
      totalFeedback: v.number(),
      positiveRate: v.number(),
    }),
    queueMetrics: v.object({
      currentQueueSize: v.number(),
      averageQueueTime: v.number(),
      peakHours: v.array(v.string()),
    }),
  }),
} as const;

// Match Feedback validators
export const MatchFeedbackV = {
  full: v.object({
    matchId: v.string(),
    userId: v.id("users"),
    rating: v.number(), // 1-5 scale
    feedback: v.optional(v.string()),
    categories: v.optional(
      v.object({
        relevance: v.number(),
        personality: v.number(),
        expertise: v.number(),
        communication: v.number(),
      }),
    ),
    wouldMeetAgain: v.boolean(),
    reportIssue: v.optional(
      v.object({
        type: v.union(
          v.literal("inappropriate"),
          v.literal("spam"),
          v.literal("technical"),
          v.literal("other"),
        ),
        description: v.optional(v.string()),
      }),
    ),
    submittedAt: v.number(),
  }),
} as const;

// Matching Event validators
export const MatchingEventV = {
  full: v.object({
    type: v.union(
      v.literal("queue_joined"),
      v.literal("match_found"),
      v.literal("match_accepted"),
      v.literal("match_declined"),
      v.literal("match_expired"),
    ),
    userId: v.id("users"),
    matchId: v.optional(v.string()),
    data: v.any(),
    timestamp: v.number(),
  }),
} as const;

// Advanced ML-powered matching validators

// ML Model Config validators
export const MLModelConfigV = {
  full: v.object({
    modelId: v.string(),
    version: v.string(),
    algorithm: v.union(
      v.literal("xgboost"),
      v.literal("neural_network"),
      v.literal("collaborative_filtering"),
      v.literal("hybrid"),
    ),
    features: v.object({
      enabled: v.array(v.string()), // keyof CompatibilityFeatures
      weights: v.record(v.string(), v.number()), // Partial<CompatibilityFeatures>
      normalization: v.union(
        v.literal("min_max"),
        v.literal("z_score"),
        v.literal("robust"),
        v.literal("none"),
      ),
    }),
    hyperparameters: v.record(
      v.string(),
      v.union(v.number(), v.string(), v.boolean()),
    ),
    performance: v.object({
      accuracy: v.number(),
      precision: v.number(),
      recall: v.number(),
      f1Score: v.number(),
      auc: v.number(),
      lastEvaluated: v.number(),
    }),
    trainingData: v.object({
      sampleCount: v.number(),
      positiveExamples: v.number(),
      negativeExamples: v.number(),
      lastTraining: v.number(),
    }),
  }),
} as const;

// Feature Vector validators
export const FeatureVectorV = {
  full: v.object({
    userId: v.id("users"),
    features: compatibilityFeaturesV,
    metadata: v.object({
      extractedAt: v.number(),
      version: v.string(),
      confidence: v.number(),
      source: v.union(
        v.literal("profile"),
        v.literal("behavior"),
        v.literal("feedback"),
        v.literal("hybrid"),
      ),
    }),
    rawData: v.object({
      profileCompleteness: v.number(),
      activityLevel: v.number(),
      responseRate: v.number(),
      averageSessionDuration: v.number(),
    }),
  }),
} as const;

// Matching Pipeline validators
export const MatchingPipelineV = {
  full: v.object({
    pipelineId: v.string(),
    stages: v.array(
      v.object({
        stageId: v.string(),
        type: v.union(
          v.literal("filtering"),
          v.literal("scoring"),
          v.literal("ranking"),
          v.literal("optimization"),
        ),
        algorithm: v.string(),
        parameters: v.record(v.string(), v.any()),
        enabled: v.boolean(),
        executionTime: v.optional(v.number()),
        outputCount: v.optional(v.number()),
      }),
    ),
    configuration: v.object({
      batchSize: v.number(),
      timeoutMs: v.number(),
      parallelization: v.boolean(),
      caching: v.boolean(),
    }),
    metrics: v.object({
      totalExecutionTime: v.number(),
      candidatesProcessed: v.number(),
      matchesGenerated: v.number(),
      successRate: v.number(),
      lastRun: v.number(),
    }),
  }),
} as const;

// Candidate Score validators
export const CandidateScoreV = {
  full: v.object({
    candidateId: v.id("users"),
    requesterId: v.id("users"),
    overallScore: v.number(),
    featureScores: compatibilityFeaturesV,
    confidenceInterval: v.object({
      lower: v.number(),
      upper: v.number(),
      confidence: v.number(),
    }),
    explanation: v.object({
      topFactors: v.array(
        v.object({
          factor: v.string(), // keyof CompatibilityFeatures
          contribution: v.number(),
          description: v.string(),
        }),
      ),
      concerns: v.array(
        v.object({
          factor: v.string(), // keyof CompatibilityFeatures
          severity: v.union(
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
          ),
          description: v.string(),
        }),
      ),
    }),
    metadata: v.object({
      scoredAt: v.number(),
      modelVersion: v.string(),
      processingTime: v.number(),
    }),
  }),
} as const;

// Matching Experiment validators
export const MatchingExperimentV = {
  full: v.object({
    experimentId: v.string(),
    name: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    variants: v.array(
      v.object({
        variantId: v.string(),
        name: v.string(),
        allocation: v.number(), // percentage 0-100
        configuration: v.record(v.string(), v.any()), // Partial<MatchingAlgorithmConfig>
        metrics: v.object({
          participants: v.number(),
          matches: v.number(),
          successRate: v.number(),
          averageRating: v.number(),
        }),
      }),
    ),
    criteria: v.object({
      startDate: v.number(),
      endDate: v.optional(v.number()),
      minParticipants: v.number(),
      significanceLevel: v.number(),
      primaryMetric: v.union(
        v.literal("success_rate"),
        v.literal("user_satisfaction"),
        v.literal("engagement"),
      ),
    }),
    results: v.optional(
      v.object({
        winningVariant: v.optional(v.string()),
        statisticalSignificance: v.boolean(),
        confidenceInterval: v.number(),
        effectSize: v.number(),
        recommendation: v.string(),
      }),
    ),
  }),
} as const;

// Matching Quality Metrics validators
export const MatchingQualityMetricsV = {
  full: v.object({
    timeWindow: v.object({
      start: v.number(),
      end: v.number(),
    }),
    overallMetrics: v.object({
      totalMatches: v.number(),
      successfulMatches: v.number(),
      averageScore: v.number(),
      averageWaitTime: v.number(),
      userSatisfaction: v.number(),
    }),
    qualityIndicators: v.object({
      scoreDistribution: v.record(v.string(), v.number()), // score ranges -> count
      featureImportance: v.record(v.string(), v.number()), // keyof CompatibilityFeatures -> importance
      diversityIndex: v.number(), // how diverse the matches are
      noveltyScore: v.number(), // how novel/unexpected successful matches are
    }),
    issues: v.array(
      v.object({
        type: v.union(
          v.literal("low_scores"),
          v.literal("high_wait_times"),
          v.literal("poor_feedback"),
          v.literal("algorithm_bias"),
        ),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical"),
        ),
        description: v.string(),
        affectedUsers: v.number(),
        detectedAt: v.number(),
      }),
    ),
    recommendations: v.array(
      v.object({
        priority: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
        ),
        category: v.union(
          v.literal("algorithm"),
          v.literal("features"),
          v.literal("data"),
          v.literal("infrastructure"),
        ),
        action: v.string(),
        expectedImpact: v.string(),
      }),
    ),
  }),
} as const;

// Learned Preferences validators
export const LearnedPreferencesV = {
  full: v.object({
    userId: v.id("users"),
    preferences: v.object({
      implicitInterests: v.array(v.string()), // derived from behavior
      preferredMeetingTimes: v.array(
        v.object({
          dayOfWeek: v.number(), // 0-6
          startHour: v.number(), // 0-23
          endHour: v.number(),
          confidence: v.number(),
        }),
      ),
      communicationStyle: v.union(
        v.literal("formal"),
        v.literal("casual"),
        v.literal("technical"),
        v.literal("mixed"),
      ),
      meetingDuration: v.object({
        preferred: v.number(), // minutes
        minimum: v.number(),
        maximum: v.number(),
      }),
    }),
    behaviorPatterns: v.object({
      responseTime: v.number(), // average minutes to respond
      acceptanceRate: v.number(), // 0-1
      completionRate: v.number(), // 0-1
      reschedulingFrequency: v.number(), // 0-1
    }),
    feedback: v.object({
      averageRating: v.number(),
      commonPositiveKeywords: v.array(v.string()),
      commonNegativeKeywords: v.array(v.string()),
      improvementAreas: v.array(v.string()),
    }),
    lastUpdated: v.number(),
    confidence: v.number(), // 0-1, how confident we are in these preferences
  }),
} as const;

// Matching Optimization validators
export const MatchingOptimizationV = {
  full: v.object({
    optimizationId: v.string(),
    type: v.union(
      v.literal("global"),
      v.literal("user_specific"),
      v.literal("time_based"),
      v.literal("load_balancing"),
    ),
    parameters: v.object({
      targetMetric: v.union(
        v.literal("wait_time"),
        v.literal("match_quality"),
        v.literal("user_satisfaction"),
        v.literal("throughput"),
      ),
      constraints: v.record(v.string(), v.number()),
      optimizationWindow: v.number(), // minutes
    }),
    currentState: v.object({
      queueSize: v.number(),
      averageWaitTime: v.number(),
      processingCapacity: v.number(),
      systemLoad: v.number(),
    }),
    adjustments: v.array(
      v.object({
        parameter: v.string(),
        oldValue: v.number(),
        newValue: v.number(),
        reason: v.string(),
        timestamp: v.number(),
        impact: v.optional(
          v.object({
            metric: v.string(),
            change: v.number(),
            confidence: v.number(),
          }),
        ),
      }),
    ),
    performance: v.object({
      improvementPercent: v.number(),
      stabilityScore: v.number(), // 0-1
      lastOptimization: v.number(),
    }),
  }),
} as const;

// Fairness Metrics validators
export const FairnessMetricsV = {
  full: v.object({
    timeWindow: v.object({
      start: v.number(),
      end: v.number(),
    }),
    demographics: v.object({
      gender: v.record(
        v.string(),
        v.object({
          matchRate: v.number(),
          averageWaitTime: v.number(),
          satisfactionScore: v.number(),
        }),
      ),
      experience: v.record(
        v.string(),
        v.object({
          matchRate: v.number(),
          averageWaitTime: v.number(),
          satisfactionScore: v.number(),
        }),
      ),
      industry: v.record(
        v.string(),
        v.object({
          matchRate: v.number(),
          averageWaitTime: v.number(),
          satisfactionScore: v.number(),
        }),
      ),
    }),
    biasIndicators: v.array(
      v.object({
        type: v.union(
          v.literal("demographic_disparity"),
          v.literal("algorithmic_bias"),
          v.literal("feedback_bias"),
        ),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical"),
        ),
        description: v.string(),
        affectedGroups: v.array(v.string()),
        metrics: v.record(v.string(), v.number()),
        detectedAt: v.number(),
      }),
    ),
    mitigationStrategies: v.array(
      v.object({
        strategy: v.string(),
        targetBias: v.string(),
        implementation: v.union(
          v.literal("active"),
          v.literal("planned"),
          v.literal("considered"),
        ),
        effectiveness: v.optional(v.number()), // 0-1
      }),
    ),
  }),
} as const;
