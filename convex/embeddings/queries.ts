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
import type { Id } from "@convex/_generated/dataModel";

import {
  EmbeddingV,
  VectorIndexMetaV,
  SimilaritySearchResultV,
  EmbeddingAnalyticsV,
  VectorSearchV,
} from "@convex/types/validators/embedding";
import { PaginationResultV } from "@convex/types/validators/pagination";
import {
  VectorUtils,
  type Embedding,
  type EmbeddingWithSource,
  type SimilaritySearchResult,
  type VectorSearchResult,
  type EmbeddingAnalytics,
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
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 256);
    const threshold = args.threshold ?? 0.7;

    const baseVector = new Float32Array(args.queryVector);
    if (baseVector.length === 0) {
      return [];
    }

    const candidateLimit = Math.min(limit * 10, 500);

    const query = args.model
      ? ctx.db
          .query("embeddings")
          .withIndex("by_model", (q) => q.eq("model", args.model!))
          .order("desc")
      : ctx.db
          .query("embeddings")
          .withIndex("by_created", (q) => q.gt("createdAt", 0))
          .order("desc");

    let candidates = await query.take(candidateLimit);

    if (args.sourceTypes && args.sourceTypes.length > 0) {
      const allowed = new Set(args.sourceTypes);
      candidates = candidates.filter((candidate) => allowed.has(candidate.sourceType));
    }

    const results: Array<SimilaritySearchResult & { score: number }> = [];
    for (const candidate of candidates) {
      const candidateVector = VectorUtils.bufferToFloatArray(candidate.vector);
      if (candidateVector.length !== baseVector.length) {
        continue;
      }

      const score = VectorUtils.cosineSimilarity(baseVector, candidateVector);
      if (score < threshold) {
        continue;
      }

      results.push({
        embedding: candidate,
        score,
        sourceData: undefined,
      });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
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

    const comparisonVector = VectorUtils.bufferToFloatArray(sourceEmbedding.vector);
    if (comparisonVector.length === 0) {
      return [];
    }

    const candidateLimit = Math.min(limit * 10, 300);

    let queryBuilder = ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) => q.eq("sourceType", sourceEmbedding.sourceType))
      .order("desc");

    let candidates = await queryBuilder.take(candidateLimit);
    candidates = candidates.filter((candidate) => candidate._id !== sourceEmbedding._id);

    const results: Array<SimilaritySearchResult & { score: number }> = [];
    for (const candidate of candidates) {
      const candidateVector = VectorUtils.bufferToFloatArray(candidate.vector);
      if (candidateVector.length !== comparisonVector.length) {
        continue;
      }

      const score = VectorUtils.cosineSimilarity(comparisonVector, candidateVector);
      results.push({
        embedding: candidate,
        score,
        sourceData: undefined,
      });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
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
        const userId = embedding.sourceId as Id<"users">;
        const user = await ctx.db.get(userId);
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
        const meetingId = embedding.sourceId as Id<"meetings">;
        const meeting = await ctx.db.get(meetingId);
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
