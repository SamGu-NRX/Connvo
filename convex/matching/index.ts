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
export { enterMatchingQueue, cancelQueueEntry, getQueueStatus } from "./queue";

// Re-export public functions from matching engine
export { runMatchingCycle } from "./engine";

// Re-export public functions from scoring
export { calculateCompatibilityScore } from "./scoring";

// Re-export public functions from analytics
export {
  submitMatchFeedback,
  getMatchHistory,
  getMatchingStats,
  getGlobalMatchingAnalytics,
  optimizeMatchingWeights,
} from "./analytics";

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
} from "../types/entities/matching";

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
