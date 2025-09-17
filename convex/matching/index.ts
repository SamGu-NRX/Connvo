/**
 * Intelligent Matching System - Public API
 *
 * Exports the main functions for the intelligent matching system including
 * queue management, match processing, and analytics.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.5 - Complete Intelligent Matching System
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

// Re-export public functions from queue management
export { enterMatchingQueue, cancelQueueEntry, getQueueStatus } from "@convex/matching/queue";

// Re-export public functions from matching engine
export { runMatchingCycle } from "@convex/matching/engine";

// Re-export public functions from scoring
export { calculateCompatibilityScore } from "@convex/matching/scoring";

// Re-export public functions from analytics
export {
  submitMatchFeedback,
  getMatchHistory,
  getMatchingStats,
  getGlobalMatchingAnalytics,
  optimizeMatchingWeights,
} from "@convex/matching/analytics";

// Export centralized types for client use
export type {
  MatchingQueueEntry,
  MatchingAnalytics,
  CompatibilityFeatures,
  MatchResult,
  QueueStatus,
  MatchResultWithUsers,
  MatchingPreferences,
  MatchingStats,
  MatchFeedback,
  MatchingEvent,
} from "@convex/types/entities/matching";

// Feature keys constant for type safety
export const FEATURE_KEYS = [
  "interestOverlap",
  "experienceGap",
  "industryMatch",
  "timezoneCompatibility",
  "vectorSimilarity",
  "orgConstraintMatch",
  "languageOverlap",
  "roleComplementarity",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];