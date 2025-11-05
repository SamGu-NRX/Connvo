/**
 * Vector Embedding Actions
 *
 * This module provides action functions for generating embeddings using external
 * AI services and managing vector operations that require external API calls.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Actions don't access ctx.db, use ctx.runQuery/Mutation
 */

"use node";

import { v } from "convex/values";
import { action, internalAction } from "@convex/_generated/server";
import { internal, api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConvexError } from "convex/values";

import {
  EmbeddingGenerationV,
  EmbeddingBatchV,
  VectorSearchV,
} from "@convex/types/validators/embedding";
import type {
  EmbeddingGenerationResult,
  EmbeddingBatchResult,
  VectorSearchResult,
  SimilaritySearchResult,
} from "@convex/types/entities/embedding";
import { VectorUtils } from "@convex/types/entities/embedding";

// OpenAI client for embedding generation
import OpenAI from "openai";

/**
 * @summary Generates vector embedding for content using OpenAI
 * @description Generates a vector embedding for the provided content using OpenAI's embedding API.
 * The embedding is stored in the database and associated with the specified source. Supports multiple
 * embedding models and includes error handling for API failures. Returns the embedding ID, vector data,
 * and processing metrics.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "sourceType": "user",
 *     "sourceId": "user_abc123",
 *     "content": "Senior software engineer with 10 years of experience in distributed systems and cloud architecture",
 *     "model": "text-embedding-3-small",
 *     "metadata": {
 *       "generatedAt": "1699564800000",
 *       "contentLength": "95"
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "embeddingId": "embedding_xyz789",
 *     "vector": "AAECAwQFBg==",
 *     "dimensions": 1536,
 *     "model": "text-embedding-3-small",
 *     "processingTime": 342,
 *     "success": true
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "EXTERNAL_SERVICE_ERROR",
 *     "message": "OpenAI API key not configured",
 *     "value": {
 *       "embeddingId": "",
 *       "vector": "",
 *       "dimensions": 0,
 *       "model": "text-embedding-3-small",
 *       "processingTime": 12,
 *       "success": false,
 *       "error": "OpenAI API key not configured"
 *     }
 *   }
 * }
 * ```
 */
export const generateEmbedding = action({
  args: EmbeddingGenerationV.request,
  returns: EmbeddingGenerationV.result,
  handler: async (ctx, args): Promise<EmbeddingGenerationResult> => {
    const startTime = Date.now();

    try {
      // Get OpenAI API key from environment
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new ConvexError("OpenAI API key not configured");
      }

      const openai = new OpenAI({ apiKey: openaiApiKey });
      const model = args.model ?? "text-embedding-3-small";

      // Generate embedding using OpenAI
      const response = await openai.embeddings.create({
        model,
        input: args.content,
        encoding_format: "float",
      });

      const embedding = response.data[0];
      if (!embedding || !embedding.embedding) {
        throw new ConvexError("Needs to generate embedding");
      }

      // Convert to Float32Array for better performance
      const vectorArray = new Float32Array(embedding.embedding);
      const vectorBuffer = VectorUtils.floatArrayToBuffer(vectorArray);

      // Store the embedding
      const embeddingId = await ctx.runMutation(
        internal.embeddings.mutations.createEmbedding,
        {
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          vector: vectorBuffer,
          model,
          dimensions: vectorArray.length,
          version: "v1",
          metadata: args.metadata ?? {},
        },
      );

      const processingTime = Date.now() - startTime;

      return {
        embeddingId,
        vector: vectorBuffer,
        dimensions: vectorArray.length,
        model,
        processingTime,
        success: true,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error("Embedding generation failed:", error);

      return {
        embeddingId: "" as any, // Will be undefined in error case
        vector: new ArrayBuffer(0),
        dimensions: 0,
        model: args.model ?? "text-embedding-3-small",
        processingTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * @summary Generates multiple embeddings in batch with rate limiting
 * @description Processes multiple embedding operations (create or delete) in batches to respect OpenAI
 * rate limits. Supports up to 10 operations per batch with 1-second delays between batches. Each operation
 * can either create a new embedding from content or delete existing embeddings by source. Returns detailed
 * results for each operation including success/failure status and error messages.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "batchId": "batch_20231109_001",
 *     "operations": [
 *       {
 *         "type": "create",
 *         "sourceType": "user",
 *         "sourceId": "user_abc123",
 *         "content": "Senior software engineer specializing in backend systems",
 *         "metadata": { "priority": "high" }
 *       },
 *       {
 *         "type": "create",
 *         "sourceType": "meeting",
 *         "sourceId": "meeting_xyz789",
 *         "content": "Discussion about microservices architecture and deployment strategies",
 *         "metadata": { "duration": "3600" }
 *       }
 *     ],
 *     "model": "text-embedding-3-small"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "batchId": "batch_20231109_001",
 *     "totalOperations": 2,
 *     "successfulOperations": 2,
 *     "failedOperations": 0,
 *     "results": [
 *       {
 *         "sourceId": "user_abc123",
 *         "success": true,
 *         "embeddingId": "embedding_aaa111"
 *       },
 *       {
 *         "sourceId": "meeting_xyz789",
 *         "success": true,
 *         "embeddingId": "embedding_bbb222"
 *       }
 *     ],
 *     "processingTime": 1847
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "batchId": "batch_20231109_002",
 *     "totalOperations": 2,
 *     "successfulOperations": 1,
 *     "failedOperations": 1,
 *     "results": [
 *       {
 *         "sourceId": "user_abc123",
 *         "success": true,
 *         "embeddingId": "embedding_ccc333"
 *       },
 *       {
 *         "sourceId": "user_def456",
 *         "success": false,
 *         "error": "Failed to generate embedding"
 *       }
 *     ],
 *     "processingTime": 2134
 *   }
 * }
 * ```
 */
export const generateEmbeddingsBatch = internalAction({
  args: EmbeddingBatchV.request,
  returns: EmbeddingBatchV.result,
  handler: async (ctx, args): Promise<EmbeddingBatchResult> => {
    const startTime = Date.now();
    const results: EmbeddingBatchResult["results"] = [];
    let successfulOperations = 0;
    let failedOperations = 0;

    try {
      // Get OpenAI API key from environment
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new ConvexError("OpenAI API key not configured");
      }

      const openai = new OpenAI({ apiKey: openaiApiKey });
      const model = args.model ?? "text-embedding-3-small";

      // Process operations in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < args.operations.length; i += batchSize) {
        const batch = args.operations.slice(i, i + batchSize);

        for (const operation of batch) {
          try {
            if (operation.type === "create" && operation.content) {
              // Generate embedding
              const response = await openai.embeddings.create({
                model,
                input: operation.content,
                encoding_format: "float",
              });

              const embedding = response.data[0];
              if (!embedding || !embedding.embedding) {
                throw new Error("Failed to generate embedding");
              }

              // Convert to ArrayBuffer
              const vectorArray = new Float32Array(embedding.embedding);
              const vectorBuffer = VectorUtils.floatArrayToBuffer(vectorArray);

              // Store the embedding
              const embeddingId = await ctx.runMutation(
                internal.embeddings.mutations.createEmbedding,
                {
                  sourceType: operation.sourceType,
                  sourceId: operation.sourceId,
                  vector: vectorBuffer,
                  model,
                  dimensions: vectorArray.length,
                  version: "v1",
                  metadata: operation.metadata ?? {},
                },
              );

              results.push({
                sourceId: operation.sourceId,
                success: true,
                embeddingId,
              });
              successfulOperations++;
            } else if (operation.type === "delete") {
              // Delete embeddings by source
              const deletedCount = await ctx.runMutation(
                internal.embeddings.mutations.deleteEmbeddingsBySource,
                {
                  sourceType: operation.sourceType,
                  sourceId: operation.sourceId,
                  model,
                },
              );

              results.push({
                sourceId: operation.sourceId,
                success: deletedCount > 0,
              });

              if (deletedCount > 0) {
                successfulOperations++;
              } else {
                failedOperations++;
              }
            } else {
              throw new Error(`Unsupported operation type: ${operation.type}`);
            }
          } catch (error) {
            results.push({
              sourceId: operation.sourceId,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
            failedOperations++;
          }
        }

        // Add delay between batches to respect rate limits
        if (i + batchSize < args.operations.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error("Batch embedding generation failed:", error);
      // Mark all remaining operations as failed
      for (const operation of args.operations) {
        if (!results.find((r) => r.sourceId === operation.sourceId)) {
          results.push({
            sourceId: operation.sourceId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          failedOperations++;
        }
      }
    }

    const processingTime = Date.now() - startTime;

    return {
      batchId: args.batchId,
      totalOperations: args.operations.length,
      successfulOperations,
      failedOperations,
      results,
      processingTime,
    };
  },
});

/**
 * @summary Generates embedding for user profile data
 * @description Creates a vector embedding from user profile information including name, experience, field,
 * company, languages, and interests. Checks for existing embeddings unless forceRegenerate is true. Combines
 * multiple profile fields into a single content string for embedding generation. Returns null if the embedding
 * already exists or if there is no content to embed.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "user_abc123",
 *     "forceRegenerate": false
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": "embedding_xyz789"
 * }
 * ```
 *
 * @example response-cache
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "NOT_FOUND",
 *     "message": "User data not found"
 *   }
 * }
 * ```
 */
export const generateUserProfileEmbedding = internalAction({
  args: {
    userId: v.id("users"),
    forceRegenerate: v.optional(v.boolean()),
  },
  returns: v.union(v.id("embeddings"), v.null()),
  handler: async (ctx, args): Promise<Id<"embeddings"> | null> => {
    // Check if embedding already exists
    if (!args.forceRegenerate) {
      const existingEmbedding = await ctx.runQuery(
        internal.embeddings.queries.embeddingExistsForSource,
        {
          sourceType: "user",
          sourceId: args.userId,
          model: "text-embedding-3-small",
        },
      );

      if (existingEmbedding) {
        return null; // Already exists
      }
    }

    // Get user data for embedding generation
    const userData = await ctx.runQuery(
      internal.matching.scoring.getUserScoringData,
      { userId: args.userId },
    );

    if (!userData) {
      throw new ConvexError("User data not found");
    }

    // Create content string from user profile
    const contentParts: string[] = [];

    if (userData.user.displayName) {
      contentParts.push(`Name: ${userData.user.displayName}`);
    }

    if (userData.profile) {
      if (userData.profile.experience) {
        contentParts.push(`Experience: ${userData.profile.experience}`);
      }
      if (userData.profile.field) {
        contentParts.push(`Field: ${userData.profile.field}`);
      }
      if (userData.profile.company) {
        contentParts.push(`Company: ${userData.profile.company}`);
      }
      if (userData.profile.languages.length > 0) {
        contentParts.push(
          `Languages: ${userData.profile.languages.join(", ")}`,
        );
      }
    }

    if (userData.interests.length > 0) {
      contentParts.push(`Interests: ${userData.interests.join(", ")}`);
    }

    const content = contentParts.join(". ");
    if (!content.trim()) {
      return null; // No content to embed
    }

    // Generate embedding
    const result = await ctx.runAction(
      api.embeddings.actions.generateEmbedding,
      {
        sourceType: "user",
        sourceId: args.userId,
        content,
        model: "text-embedding-3-small",
        metadata: {
          generatedAt: Date.now().toString(),
          contentLength: content.length.toString(),
        },
      },
    );

    return result.success ? result.embeddingId : null;
  },
});

/**
 * @summary Generates embedding for meeting content and transcripts
 * @description Creates a vector embedding from meeting metadata (title, description) and transcript segments.
 * Limits transcript content to 8000 characters and retrieves up to 50 transcript segments to avoid excessive
 * content length. Checks for existing embeddings unless forceRegenerate is true. Returns null if the embedding
 * already exists or if there is no content to embed.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_xyz789",
 *     "forceRegenerate": false
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": "embedding_abc456"
 * }
 * ```
 *
 * @example response-cache
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "NOT_FOUND",
 *     "message": "Meeting not found"
 *   }
 * }
 * ```
 */
export const generateMeetingEmbedding = internalAction({
  args: {
    meetingId: v.id("meetings"),
    forceRegenerate: v.optional(v.boolean()),
  },
  returns: v.union(v.id("embeddings"), v.null()),
  handler: async (ctx, args): Promise<Id<"embeddings"> | null> => {
    // Check if embedding already exists
    if (!args.forceRegenerate) {
      const existingEmbedding = await ctx.runQuery(
        internal.embeddings.queries.embeddingExistsForSource,
        {
          sourceType: "meeting",
          sourceId: args.meetingId,
          model: "text-embedding-3-small",
        },
      );

      if (existingEmbedding) {
        return null; // Already exists
      }
    }

    // Get meeting data
    const meeting = await ctx.runQuery(
      internal.meetings.queries.getMeetingById,
      {
        meetingId: args.meetingId,
      },
    );

    if (!meeting) {
      throw new ConvexError("Meeting not found");
    }

    // Create content string from meeting data
    const contentParts: string[] = [];

    if (meeting.title) {
      contentParts.push(`Title: ${meeting.title}`);
    }

    if (meeting.description) {
      contentParts.push(`Description: ${meeting.description}`);
    }

    // Get transcript content if available
    const transcripts = await ctx.runQuery(
      internal.transcripts.queries.getTranscriptSegments,
      {
        meetingId: args.meetingId,
        limit: 50, // Limit to avoid too much content
      },
    );

    if (transcripts.length > 0) {
      const transcriptText = transcripts
        .map((t) => t.text)
        .join(" ")
        .slice(0, 8000); // Limit content length
      contentParts.push(`Transcript: ${transcriptText}`);
    }

    const content = contentParts.join(". ");
    if (!content.trim()) {
      return null; // No content to embed
    }

    // Generate embedding
    const result = await ctx.runAction(
      api.embeddings.actions.generateEmbedding,
      {
        sourceType: "meeting",
        sourceId: args.meetingId,
        content,
        model: "text-embedding-3-small",
        metadata: {
          generatedAt: Date.now().toString(),
          contentLength: content.length.toString(),
          hasTranscript: transcripts.length > 0 ? "true" : "false",
        },
      },
    );

    return result.success ? result.embeddingId : null;
  },
});

/**
 * @summary Performs advanced vector similarity search with filtering
 * @description Executes vector similarity search with additional filtering and ranking capabilities.
 * Supports filtering by model, source IDs, and creation time ranges. Calculates cosine similarity scores
 * and applies threshold filtering. Returns up to 256 results sorted by similarity score with detailed
 * query metadata and search performance metrics.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "vector": "AAECAwQFBg==",
 *     "sourceTypes": ["user", "meeting"],
 *     "limit": 10,
 *     "threshold": 0.75,
 *     "filters": {
 *       "model": "text-embedding-3-small",
 *       "createdAfter": 1699564800000
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "results": [
 *       {
 *         "embedding": {
 *           "_id": "embedding_abc123",
 *           "_creationTime": 1699564801000,
 *           "sourceType": "user",
 *           "sourceId": "user_xyz789",
 *           "model": "text-embedding-3-small",
 *           "dimensions": 1536,
 *           "version": "v1",
 *           "metadata": {},
 *           "createdAt": 1699564800000,
 *           "vector": "AAECAwQFBg=="
 *         },
 *         "score": 0.92,
 *         "sourceData": null
 *       },
 *       {
 *         "embedding": {
 *           "_id": "embedding_def456",
 *           "_creationTime": 1699565401000,
 *           "sourceType": "meeting",
 *           "sourceId": "meeting_aaa111",
 *           "model": "text-embedding-3-small",
 *           "dimensions": 1536,
 *           "version": "v1",
 *           "metadata": {},
 *           "createdAt": 1699565400000,
 *           "vector": "AQIDBAUGBw=="
 *         },
 *         "score": 0.87,
 *         "sourceData": null
 *       }
 *     ],
 *     "totalCount": 2,
 *     "searchTime": 145,
 *     "query": {
 *       "dimensions": 1536,
 *       "threshold": 0.75,
 *       "filters": {
 *         "model": "text-embedding-3-small",
 *         "createdAfter": 1699564800000
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "VECTOR_SEARCH_ERROR",
 *     "message": "Vector search failed: Invalid vector dimensions"
 *   }
 * }
 * ```
 */
export const advancedVectorSearch = internalAction({
  args: VectorSearchV.query,
  returns: VectorSearchV.result,
  handler: async (ctx, args): Promise<VectorSearchResult> => {
    const startTime = Date.now();

    try {
      // Convert ArrayBuffer to Float32Array for processing
      const queryVector = VectorUtils.bufferToFloatArray(args.vector);

      // Perform basic vector search using Convex
      const basicResults: SimilaritySearchResult[] = await ctx.runQuery(
        api.embeddings.queries.vectorSimilaritySearch,
        {
          queryVector: args.vector,
          sourceTypes: args.sourceTypes,
          limit: args.limit ?? 20,
          threshold: args.threshold ?? 0.7,
        },
      );

      // Apply additional filtering and ranking if needed
      let filteredResults: SimilaritySearchResult[] = basicResults;

      const filters = args.filters;
      if (filters) {
        filteredResults = basicResults.filter((result) => {
          const embedding = result.embedding;

          // Filter by model
          if (filters.model && embedding.model !== filters.model) {
            return false;
          }

          // Filter by source IDs
          if (
            filters.sourceIds &&
            !filters.sourceIds.includes(embedding.sourceId)
          ) {
            return false;
          }

          // Filter by creation time
          if (
            filters.createdAfter &&
            embedding.createdAt < filters.createdAfter
          ) {
            return false;
          }

          if (
            filters.createdBefore &&
            embedding.createdAt > filters.createdBefore
          ) {
            return false;
          }

          return true;
        });
      }

      // Calculate actual similarity scores using cosine similarity
      const resultsWithScores: Array<
        SimilaritySearchResult & { score: number }
      > = filteredResults.map((result) => {
        const embeddingVector = VectorUtils.bufferToFloatArray(
          result.embedding.vector,
        );
        const similarity = VectorUtils.cosineSimilarity(
          queryVector,
          embeddingVector,
        );

        return {
          ...result,
          score: similarity,
        };
      });

      // Sort by similarity score (descending)
      resultsWithScores.sort((a, b) => b.score - a.score);

      // Apply threshold filtering
      const threshold = args.threshold ?? 0.7;
      const thresholdedResults = resultsWithScores.filter(
        (result) => result.score >= threshold,
      );

      // Limit results
      const limit = Math.min(Math.max(args.limit ?? 10, 1), 256);
      const finalResults = thresholdedResults.slice(0, limit);

      const searchTime = Date.now() - startTime;

      return {
        results: finalResults,
        totalCount: finalResults.length,
        searchTime,
        query: {
          dimensions: queryVector.length,
          threshold,
          filters: args.filters ?? {},
        },
      };
    } catch (error) {
      console.error("Advanced vector search failed:", error);
      throw new ConvexError(
        `Vector search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
