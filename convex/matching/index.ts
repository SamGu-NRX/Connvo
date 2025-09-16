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

// Export types for client use
export type {} from // Add type exports if needed
"./engine";

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

export type Features = {
  interestOverlap: number;
  experienceGap: number;
  industryMatch: number;
  timezoneCompatibility: number;
  vectorSimilarity?: number;
  orgConstraintMatch: number;
  languageOverlap: number;
  roleComplementarity: number;
};
