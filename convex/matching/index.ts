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
