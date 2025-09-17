/**
 * Vector Embeddings Module - Public API
 *
 * This module exports the main functions for vector embeddings including
 * similarity search, embedding generation, and analytics.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Proper module organization and exports
 */

// Re-export public functions from queries
export {
  getEmbedding,
  getEmbeddingsBySource,
  getEmbeddingsByModel,
  vectorSimilaritySearch,
  getEmbeddingAnalytics,
  getVectorIndexMeta,
} from "./queries";

// Re-export public functions from actions
export { generateEmbedding } from "./actions";

// Export centralized types for client use
export type {
  Embedding,
  EmbeddingWithSource,
  SimilaritySearchResult,
  VectorSearchResult,
  EmbeddingAnalytics,
  EmbeddingGenerationRequest,
  EmbeddingGenerationResult,
  VectorSearchQuery,
  EmbeddingBatchRequest,
  EmbeddingBatchResult,
  EmbeddingModelConfig,
  VectorIndexMeta,
} from "@convex/types/entities/embedding";

// Export utility functions
export { VectorUtils } from "@convex/types/entities/embedding";
