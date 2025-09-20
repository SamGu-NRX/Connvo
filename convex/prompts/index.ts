/**
 * AI Prompts Module - Public API
 *
 * This module exports the main functions for AI prompt generation and management
 * including pre-call and in-call prompt generation.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Proper module organization and exports
 */

// Re-export public functions from queries
export {
  getPreCallPrompts,
  getInCallPrompts,
  subscribeToInCallPrompts,
} from "./queries";

// Re-export public functions from mutations
export { updatePromptFeedback } from "./mutations";

// Re-export public functions from actions
export { generatePreCallIdeas, detectLullAndGeneratePrompts } from "./actions";

// Export centralized types for client use
export type {
  AIPrompt,
  AIPromptWithStats,
  AIInsight,
  AIInsightWithUser,
  AIContentGenerationRequest,
  AIContentGenerationResult,
  AIModelConfig,
  AIAnalytics,
  AIPromptTemplate,
  AIFeedback,
} from "@convex/types/entities/prompt";
