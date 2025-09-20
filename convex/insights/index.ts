/**
 * AI Insights Module - Public API
 *
 * This module exports the main functions for AI insight generation and management
 * including post-call analysis and recommendations.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Proper module organization and exports
 */

// Re-export public functions from queries
export {
  getMeetingInsights,
  getUserInsights,
  getInsightById,
  getConnectionRecommendations,
} from "./queries";

// Re-export public functions from mutations
export { updateInsightsFeedback, deleteInsights } from "./mutations";

// Re-export public functions from actions
export { generateInsights } from "./generation";

// Export centralized types for client use
export type {
  AIInsight,
  AIInsightWithUser,
  AIContentGenerationRequest,
  AIContentGenerationResult,
  AIAnalytics,
  AIFeedback,
} from "@convex/types/entities/prompt";
