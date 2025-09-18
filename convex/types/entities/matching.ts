/**
 * Matching System Entity Type Definitions
 *
 * This module defines all matching-related entity types for the AI-powered
 * smart matching system including queue management and analytics.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling for ML systems
 */

import type { Id } from "@convex/_generated/dataModel";

// Matching status types (matches schema exactly)
export type MatchingStatus = "waiting" | "matched" | "expired" | "cancelled";

// Match outcome types (for analytics)
export type MatchOutcome = "accepted" | "declined" | "completed";

// Matching queue entry (matches convex/schema/matching.ts exactly)
export interface MatchingQueueEntry {
  _id: Id<"matchingQueue">;
  _creationTime: number; // Convex system field
  userId: Id<"users">;
  availableFrom: number;
  availableTo: number;
  constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
  };
  status: MatchingStatus;
  matchedWith?: Id<"users">;
  createdAt: number;
  updatedAt: number;
}

// Matching analytics (matches schema exactly)
export interface MatchingAnalytics {
  _id: Id<"matchingAnalytics">;
  _creationTime: number; // Convex system field
  userId: Id<"users">;
  matchId: string;
  outcome: MatchOutcome;
  feedback?: {
    rating: number;
    comments?: string;
  };
  features: Record<string, number>; // Matches numericMapV
  weights: Record<string, number>; // Matches numericMapV
  createdAt: number;
}

// User scoring data for compatibility calculations
export interface UserScoringData {
  user: {
    _id: Id<"users">;
    displayName?: string;
    orgId?: string;
    orgRole?: string;
  };
  profile: {
    experience?: string;
    languages: string[];
    field?: string;
    company?: string;
  } | null;
  interests: string[];
  embedding: {
    vector: ArrayBuffer;
    model: string;
  } | null;
}

// Compatibility features for matching algorithm
export interface CompatibilityFeatures {
  interestOverlap: number;
  experienceGap: number;
  industryMatch: number;
  timezoneCompatibility: number;
  vectorSimilarity?: number;
  orgConstraintMatch: number;
  languageOverlap: number;
  roleComplementarity: number;
}

// Match result from algorithm
export interface MatchResult {
  user1Id: Id<"users">;
  user2Id: Id<"users">;
  score: number;
  features: CompatibilityFeatures;
  explanation: string[];
  matchId: string;
}

// Derived types for API responses

// Queue status with additional metadata
export interface QueueStatus extends MatchingQueueEntry {
  estimatedWaitTime?: number;
  queuePosition?: number;
  potentialMatches?: number;
}

// Match result with user details
export interface MatchResultWithUsers extends MatchResult {
  user1: {
    _id: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
  };
  user2: {
    _id: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
  };
  scheduledMeetingId?: Id<"meetings">;
}

// Matching preferences (user configuration)
export interface MatchingPreferences {
  userId: Id<"users">;
  availableForMatching: boolean;
  preferredMeetingDuration: number; // minutes
  timeZone: string;
  availableHours: {
    start: string; // HH:MM format
    end: string; // HH:MM format
  };
  constraints: {
    interests: string[];
    roles: string[];
    orgConstraints?: string;
    experienceLevel?: "junior" | "mid" | "senior" | "executive";
    industryPreferences?: string[];
  };
  blacklist: Id<"users">[]; // Users to avoid matching with
  whitelist?: Id<"users">[]; // Preferred users (if any)
}

// Matching algorithm configuration
export interface MatchingAlgorithmConfig {
  version: string;
  weights: CompatibilityFeatures;
  thresholds: {
    minimumScore: number;
    maximumMatches: number;
    timeoutMinutes: number;
  };
  features: {
    useVectorSimilarity: boolean;
    useOrgConstraints: boolean;
    useTimeZoneMatching: boolean;
    useFeedbackLearning: boolean;
  };
  updatedAt: number;
}

// Matching statistics and metrics
export interface MatchingStats {
  totalMatches: number;
  successfulMatches: number;
  averageWaitTime: number;
  averageMatchScore: number;
  topFeatures: Array<{
    feature: keyof CompatibilityFeatures;
    importance: number;
  }>;
  userSatisfaction: {
    averageRating: number;
    totalFeedback: number;
    positiveRate: number;
  };
  queueMetrics: {
    currentQueueSize: number;
    averageQueueTime: number;
    peakHours: string[];
  };
}

// Match feedback and learning
export interface MatchFeedback {
  matchId: string;
  userId: Id<"users">;
  rating: number; // 1-5 scale
  feedback?: string;
  categories?: {
    relevance: number;
    personality: number;
    expertise: number;
    communication: number;
  };
  wouldMeetAgain: boolean;
  reportIssue?: {
    type: "inappropriate" | "spam" | "technical" | "other";
    description?: string;
  };
  submittedAt: number;
}

// Real-time matching events
export interface MatchingEvent {
  type:
    | "queue_joined"
    | "match_found"
    | "match_accepted"
    | "match_declined"
    | "match_expired";
  userId: Id<"users">;
  matchId?: string;
  data: any;
  timestamp: number;
}

// Advanced ML-powered matching types

// Machine learning model configuration
export interface MLModelConfig {
  modelId: string;
  version: string;
  algorithm:
    | "xgboost"
    | "neural_network"
    | "collaborative_filtering"
    | "hybrid";
  features: {
    enabled: (keyof CompatibilityFeatures)[];
    weights: Partial<CompatibilityFeatures>;
    normalization: "min_max" | "z_score" | "robust" | "none";
  };
  hyperparameters: Record<string, number | string | boolean>;
  performance: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    auc: number;
    lastEvaluated: number;
  };
  trainingData: {
    sampleCount: number;
    positiveExamples: number;
    negativeExamples: number;
    lastTraining: number;
  };
}

// Feature engineering and extraction
export interface FeatureVector {
  userId: Id<"users">;
  features: CompatibilityFeatures;
  metadata: {
    extractedAt: number;
    version: string;
    confidence: number;
    source: "profile" | "behavior" | "feedback" | "hybrid";
  };
  rawData: {
    profileCompleteness: number;
    activityLevel: number;
    responseRate: number;
    averageSessionDuration: number;
  };
}

// Matching algorithm pipeline
export interface MatchingPipeline {
  pipelineId: string;
  stages: Array<{
    stageId: string;
    type: "filtering" | "scoring" | "ranking" | "optimization";
    algorithm: string;
    parameters: Record<string, any>;
    enabled: boolean;
    executionTime?: number;
    outputCount?: number;
  }>;
  configuration: {
    batchSize: number;
    timeoutMs: number;
    parallelization: boolean;
    caching: boolean;
  };
  metrics: {
    totalExecutionTime: number;
    candidatesProcessed: number;
    matchesGenerated: number;
    successRate: number;
    lastRun: number;
  };
}

// Candidate scoring and ranking
export interface CandidateScore {
  candidateId: Id<"users">;
  requesterId: Id<"users">;
  overallScore: number;
  featureScores: CompatibilityFeatures;
  confidenceInterval: {
    lower: number;
    upper: number;
    confidence: number;
  };
  explanation: {
    topFactors: Array<{
      factor: keyof CompatibilityFeatures;
      contribution: number;
      description: string;
    }>;
    concerns: Array<{
      factor: keyof CompatibilityFeatures;
      severity: "low" | "medium" | "high";
      description: string;
    }>;
  };
  metadata: {
    scoredAt: number;
    modelVersion: string;
    processingTime: number;
  };
}

// A/B testing for matching algorithms
export interface MatchingExperiment {
  experimentId: string;
  name: string;
  description: string;
  status: "draft" | "running" | "paused" | "completed" | "cancelled";
  variants: Array<{
    variantId: string;
    name: string;
    allocation: number; // percentage 0-100
    configuration: Partial<MatchingAlgorithmConfig>;
    metrics: {
      participants: number;
      matches: number;
      successRate: number;
      averageRating: number;
    };
  }>;
  criteria: {
    startDate: number;
    endDate?: number;
    minParticipants: number;
    significanceLevel: number;
    primaryMetric: "success_rate" | "user_satisfaction" | "engagement";
  };
  results?: {
    winningVariant?: string;
    statisticalSignificance: boolean;
    confidenceInterval: number;
    effectSize: number;
    recommendation: string;
  };
}

// Matching quality assurance
export interface MatchingQualityMetrics {
  timeWindow: {
    start: number;
    end: number;
  };
  overallMetrics: {
    totalMatches: number;
    successfulMatches: number;
    averageScore: number;
    averageWaitTime: number;
    userSatisfaction: number;
  };
  qualityIndicators: {
    scoreDistribution: Record<string, number>; // score ranges -> count
    featureImportance: Record<keyof CompatibilityFeatures, number>;
    diversityIndex: number; // how diverse the matches are
    noveltyScore: number; // how novel/unexpected successful matches are
  };
  issues: Array<{
    type: "low_scores" | "high_wait_times" | "poor_feedback" | "algorithm_bias";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    affectedUsers: number;
    detectedAt: number;
  }>;
  recommendations: Array<{
    priority: "low" | "medium" | "high";
    category: "algorithm" | "features" | "data" | "infrastructure";
    action: string;
    expectedImpact: string;
  }>;
}

// Personalized matching preferences learned from behavior
export interface LearnedPreferences {
  userId: Id<"users">;
  preferences: {
    implicitInterests: string[]; // derived from behavior
    preferredMeetingTimes: Array<{
      dayOfWeek: number; // 0-6
      startHour: number; // 0-23
      endHour: number;
      confidence: number;
    }>;
    communicationStyle: "formal" | "casual" | "technical" | "mixed";
    meetingDuration: {
      preferred: number; // minutes
      minimum: number;
      maximum: number;
    };
  };
  behaviorPatterns: {
    responseTime: number; // average minutes to respond
    acceptanceRate: number; // 0-1
    completionRate: number; // 0-1
    reschedulingFrequency: number; // 0-1
  };
  feedback: {
    averageRating: number;
    commonPositiveKeywords: string[];
    commonNegativeKeywords: string[];
    improvementAreas: string[];
  };
  lastUpdated: number;
  confidence: number; // 0-1, how confident we are in these preferences
}

// Real-time matching optimization
export interface MatchingOptimization {
  optimizationId: string;
  type: "global" | "user_specific" | "time_based" | "load_balancing";
  parameters: {
    targetMetric:
      | "wait_time"
      | "match_quality"
      | "user_satisfaction"
      | "throughput";
    constraints: Record<string, number>;
    optimizationWindow: number; // minutes
  };
  currentState: {
    queueSize: number;
    averageWaitTime: number;
    processingCapacity: number;
    systemLoad: number;
  };
  adjustments: Array<{
    parameter: string;
    oldValue: number;
    newValue: number;
    reason: string;
    timestamp: number;
    impact?: {
      metric: string;
      change: number;
      confidence: number;
    };
  }>;
  performance: {
    improvementPercent: number;
    stabilityScore: number; // 0-1
    lastOptimization: number;
  };
}

// Matching fairness and bias detection
export interface FairnessMetrics {
  timeWindow: {
    start: number;
    end: number;
  };
  demographics: {
    gender: Record<
      string,
      {
        matchRate: number;
        averageWaitTime: number;
        satisfactionScore: number;
      }
    >;
    experience: Record<
      string,
      {
        matchRate: number;
        averageWaitTime: number;
        satisfactionScore: number;
      }
    >;
    industry: Record<
      string,
      {
        matchRate: number;
        averageWaitTime: number;
        satisfactionScore: number;
      }
    >;
  };
  biasIndicators: Array<{
    type: "demographic_disparity" | "algorithmic_bias" | "feedback_bias";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    affectedGroups: string[];
    metrics: Record<string, number>;
    detectedAt: number;
  }>;
  mitigationStrategies: Array<{
    strategy: string;
    targetBias: string;
    implementation: "active" | "planned" | "considered";
    effectiveness?: number; // 0-1
  }>;
}
