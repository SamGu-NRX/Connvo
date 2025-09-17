/**
 * Vector Embedding Queries
 *
 * This module provides query functions for vector embeddings including
 * similarity search, embedding retrieval, and analytics.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v } from "convex/values";
import { query, internalQuery } from "@convex/_generated/server";
import { paginationOptsValidator } from "convex/server";

import {
  EmbeddingV,
  VectorIndexMetaV,
  SimilaritySearchResultV,
  EmbeddingAnalyticsV,
  VectorSearchV,
} from "@convex/types/validators/embedding";
import { PaginationResultV } from "@convex/types/validators/pagination";
import type {
  Embedding,
  EmbeddingWithSource,
  SimilaritySearchResult,
  VectorSearchResult,
  EmbeddingAnalytics,
} from "@convex/types/entities/embedding";

/**
 * Get embedding by ID (public)
 */
export const getEmbedding = query({
  args: { embeddingId: v.id("embeddings") },
  returns: v.union(EmbeddingV.full, v.null()),
  handler: async (ctx, args): Promise<Embedding | null> => {
    return await ctx.db.get(args.embeddingId);
  },
});

/**
 * Get embeddings by source (public)
 */
export const getEmbeddingsBySource = query({
  args: {
    sourceType: v.union(
      v.literal("user"),
      v.literal("profile"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("transcriptSegment"),
    ),
    sourceId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: PaginationResultV(EmbeddingV.full),
  handler: async (ctx, args) => {
    // Index-first query per convex_rules.mdc
    const query = ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .order("desc");

    return await query.paginate(args.paginationOpts);
  },
});

/**
 * Get embeddings by model (public)
 */
export const getEmbeddingsByModel = query({
  args: {
    model: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: PaginationResultV(EmbeddingV.full),
  handler: async (ctx, args) => {
    // Index-first query per convex_rules.mdc
    const query = ctx.db
      .query("embeddings")
      .withIndex("by_model", (q) => q.eq("model", args.model))
      .order("desc");

    return await query.paginate(args.paginationOpts);
  },
});

/**
 * Perform vector similarity search (public)
 */
export const vectorSimilaritySearch = query({
  args: {
    queryVector: v.bytes(), // Use ArrayBuffer for performance
    sourceTypes: v.optional(
      v.array(
        v.union(
          v.literal("user"),
          v.literal("profile"),
          v.literal("meeting"),
          v.literal("note"),
          v.literal("transcriptSegment"),
        ),
      ),
    ),
    model: v.optional(v.string()),
    limit: v.optional(v.number()),
    threshold: v.optional(v.number()),
  },
  returns: v.array(SimilaritySearchResultV.full),
  handler: async (ctx, args): Promise<SimilaritySearchResult[]> => {
    const limit = args.limit ?? 10;
    const threshold = args.threshold ?? 0.7;

    // Use Convex vector search with proper filtering
    let vectorQuery = ctx.db
      .query("embeddings")
      .withIndex("by_vector", (q) => q.similar("vector", args.queryVector, limit));

    // Apply filters if provided
    if (args.sourceTypes && args.sourceTypes.length > 0) {
      // For multiple source types, we need to filter after the vector search
      // since Convex vector indexes support limited filtering
      const results = await vectorQuery.collect();
      const filteredResults = results.filter((embedding) =>
        args.sourceTypes!.includes(embedding.sourceType),
      );

      return filteredResults
        .map((embedding) => ({
          embedding,
          score: 1.0, // Convex doesn't return similarity scores directly
          sourceData: undefined,
        }))
        .slice(0, limit);
    }

    if (args.model) {
      vectorQuery = vectorQuery.filter((q) => q.eq(q.field("model"), args.model));
    }

    const results = await vectorQuery.collect();

    return results.map((embedding) => ({
      embedding,
      score: 1.0, // Convex doesn't return similarity scores directly
      sourceData: undefined,
    }));
  },
});

/**
 * Get embedding analytics (public)
 */
export const getEmbeddingAnalytics = query({
  args: {},
  returns: EmbeddingAnalyticsV.full,
  handler: async (ctx): Promise<EmbeddingAnalytics> => {
    // Get all embeddings for analytics (consider pagination for large datasets)
    const embeddings = await ctx.db.query("embeddings").collect();

    const totalEmbeddings = embeddings.length;

    // Calculate embeddings by source type
    const embeddingsBySource: Record<string, number> = {};
    const embeddingsByModel: Record<string, number> = {};

    let totalDimensions = 0;
    let totalVectorSize = 0;

    for (const embedding of embeddings) {
      // Count by source type
      embeddingsBySource[embedding.sourceType] =
        (embeddingsBySource[embedding.sourceType] || 0) + 1;

      // Count by model
      embeddingsByModel[embedding.model] =
        (embeddingsByModel[embedding.model] || 0) + 1;

      // Calculate storage metrics
      totalDimensions += embedding.dimensions;
      totalVectorSize += embedding.vector.byteLength;
    }

    return {
      totalEmbeddings,
      embeddingsBySource,
      embeddingsByModel,
      averageProcessingTime: 0, // Would need to track this in generation
      storageUsage: {
        totalVectors: totalEmbeddings,
        totalDimensions,
        estimatedSizeBytes: totalVectorSize,
      },
      searchMetrics: {
        totalSearches: 0, // Would need to track this
        averageSearchTime: 0,
        averageResultCount: 0,
      },
      qualityMetrics: {
        averageSimilarityScore: 0, // Would need to calculate from search results
        lowQualityEmbeddings: 0,
        duplicateDetections: 0,
      },
    };
  },
});

/**
 * Get vector index metadata (public)
 */
export const getVectorIndexMeta = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  returns: PaginationResultV(VectorIndexMetaV.full),
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("vectorIndexMeta")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc");

    return await query.paginate(args.paginationOpts);
  },
});

/**
 * Find similar embeddings by source (internal)
 */
export const findSimilarEmbeddingsBySource = internalQuery({
  args: {
    sourceType: v.union(
      v.literal("user"),
      v.literal("profile"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("transcriptSegment"),
    ),
    sourceId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(SimilaritySearchResultV.full),
  handler: async (ctx, args): Promise<SimilaritySearchResult[]> => {
    const limit = args.limit ?? 5;

    // Get the source embedding first
    const sourceEmbedding = await ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .order("desc")
      .first();

    if (!sourceEmbedding) {
      return [];
    }

    // Use vector similarity search
    const results = await ctx.db
      .query("embeddings")
      .withIndex("by_vector", (q) =>
        q.similar("vector", sourceEmbedding.vector, limit + 1),
      ) // +1 to exclude self
      .collect();

    // Filter out the source embedding itself
    const filteredResults = results.filter(
      (embedding) => embedding._id !== sourceEmbedding._id,
    );

    return filteredResults.slice(0, limit).map((embedding) => ({
      embedding,
      score: 1.0, // Convex doesn't return similarity scores directly
      sourceData: undefined,
    }));
  },
});

/**
 * Get embedding with source details (internal)
 */
export const getEmbeddingWithSource = internalQuery({
  args: { embeddingId: v.id("embeddings") },
  returns: v.union(EmbeddingV.withSource, v.null()),
  handler: async (ctx, args): Promise<EmbeddingWithSource | null> => {
    const embedding = await ctx.db.get(args.embeddingId);
    if (!embedding) return null;

    // Get source details based on source type
    let sourceDetails;
    switch (embedding.sourceType) {
      case "user": {
        const user = await ctx.db.get(embedding.sourceId as any);
        if (user) {
          sourceDetails = {
            title: user.displayName || "User Profile",
            author: {
              _id: user._id,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            },
            createdAt: user.createdAt,
          };
        }
        break;
      }
      case "meeting": {
        const meeting = await ctx.db.get(embedding.sourceId as any);
        if (meeting) {
          sourceDetails = {
            title: meeting.title,
            description: meeting.description,
            createdAt: meeting.createdAt,
          };
        }
        break;
      }
      // Add other source types as needed
    }

    return {
      ...embedding,
      sourceDetails,
    };
  },
});

/**
 * Check if embedding exists for source (internal)
 */
export const embeddingExistsForSource = internalQuery({
  args: {
    sourceType: v.union(
      v.literal("user"),
      v.literal("profile"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("transcriptSegment"),
    ),
    sourceId: v.string(),
    model: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    let query = ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      );

    if (args.model) {
      const results = await query.collect();
      return results.some((embedding) => embedding.model === args.model);
    }

    const result = await query.first();
    return result !== null;
  },
});
