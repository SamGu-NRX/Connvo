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
import { internal } from "@convex/_generated/api";
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
} from "@convex/types/entities/embedding";
import { VectorUtils } from "@convex/types/entities/embedding";

// OpenAI client for embedding generation
import OpenAI from "openai";

/**
 * Generate embedding for content (public)
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
 * Generate embeddings in batch (internal)
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
 * Generate embedding for user profile (internal)
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
        contentParts.push(`Languages: ${userData.profile.languages.join(", ")}`);
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
    const result = await ctx.runAction(internal.embeddings.actions.generateEmbedding, {
      sourceType: "user",
      sourceId: args.userId,
      content,
      model: "text-embedding-3-small",
      metadata: {
        generatedAt: Date.now().toString(),
        contentLength: content.length.toString(),
      },
    });

    return result.success ? result.embeddingId : null;
  },
});

/**
 * Generate embedding for meeting content (internal)
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
    const meeting = await ctx.runQuery(internal.meetings.queries.getMeetingById, {
      meetingId: args.meetingId,
    });

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
      internal.transcripts.queries.getTranscriptsByMeeting,
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
    const result = await ctx.runAction(internal.embeddings.actions.generateEmbedding, {
      sourceType: "meeting",
      sourceId: args.meetingId,
      content,
      model: "text-embedding-3-small",
      metadata: {
        generatedAt: Date.now().toString(),
        contentLength: content.length.toString(),
        hasTranscript: transcripts.length > 0 ? "true" : "false",
      },
    });

    return result.success ? result.embeddingId : null;
  },
});

/**
 * Perform advanced vector search with external processing (internal)
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
      const basicResults = await ctx.runQuery(
        internal.embeddings.queries.vectorSimilaritySearch,
        {
          queryVector: args.vector,
          sourceTypes: args.sourceTypes,
          limit: args.limit ?? 20,
          threshold: args.threshold ?? 0.7,
        },
      );

      // Apply additional filtering and ranking if needed
      let filteredResults = basicResults;

      if (args.filters) {
        filteredResults = basicResults.filter((result) => {
          const embedding = result.embedding;

          // Filter by model
          if (args.filters!.model && embedding.model !== args.filters!.model) {
            return false;
          }

          // Filter by source IDs
          if (
            args.filters!.sourceIds &&
            !args.filters!.sourceIds.includes(embedding.sourceId)
          ) {
            return false;
          }

          // Filter by creation time
          if (
            args.filters!.createdAfter &&
            embedding.createdAt < args.filters!.createdAfter
          ) {
            return false;
          }

          if (
            args.filters!.createdBefore &&
            embedding.createdAt > args.filters!.createdBefore
          ) {
            return false;
          }

          return true;
        });
      }

      // Calculate actual similarity scores using cosine similarity
      const resultsWithScores = filteredResults.map((result) => {
        const embeddingVector = VectorUtils.bufferToFloatArray(result.embedding.vector);
        const similarity = VectorUtils.cosineSimilarity(queryVector, embeddingVector);

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
      const limit = args.limit ?? 10;
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
