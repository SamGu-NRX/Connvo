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
 * @summary Retrieves embedding by ID
 * @description Fetches a single embedding record by its unique identifier. Returns the complete embedding
 * including vector data, model information, dimensions, and metadata. Returns null if the embedding does
 * not exist.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "embeddingId": "embedding_abc123"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "embedding_abc123",
 *     "_creationTime": 1699564801000,
 *     "sourceType": "user",
 *     "sourceId": "user_xyz789",
 *     "model": "text-embedding-3-small",
 *     "dimensions": 1536,
 *     "version": "v1",
 *     "metadata": {
 *       "generatedAt": "1699564800000",
 *       "contentLength": "95"
 *     },
 *     "createdAt": 1699564800000,
 *     "vector": "AAECAwQFBg=="
 *   }
 * }
 * ```
 */
export const getEmbedding = query({
  args: { embeddingId: v.id("embeddings") },
  returns: v.union(EmbeddingV.full, v.null()),
  handler: async (ctx, args): Promise<Embedding | null> => {
    return await ctx.db.get(args.embeddingId);
  },
});

/**
 * @summary Retrieves embeddings for a specific source
 * @description Fetches all embeddings associated with a particular source (user, meeting, note, etc.) using
 * an indexed query for optimal performance. Returns paginated results ordered by creation time (newest first).
 * Supports cursor-based pagination for efficient traversal of large result sets.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "sourceType": "user",
 *     "sourceId": "user_xyz789",
 *     "paginationOpts": {
 *       "numItems": 10,
 *       "cursor": null
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
 *     "page": [
 *       {
 *         "_id": "embedding_abc123",
 *         "_creationTime": 1699564801000,
 *         "_creationTime": 1699564801000,
 *         "sourceType": "user",
 *         "sourceId": "user_xyz789",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {},
 *         "createdAt": 1699564800000,
 *         "vector": "AAECAwQFBg=="
 *       }
 *     ],
 *     "isDone": true,
 *     "continueCursor": ""
 *   }
 * }
 * ```
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
 * @summary Retrieves embeddings by model type
 * @description Fetches all embeddings generated using a specific model (e.g., text-embedding-3-small) using
 * an indexed query for optimal performance. Returns paginated results ordered by creation time (newest first).
 * Useful for model migration, analytics, or comparing embeddings across different models.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "model": "text-embedding-3-small",
 *     "paginationOpts": {
 *       "numItems": 20,
 *       "cursor": null
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
 *     "page": [
 *       {
 *         "_id": "embedding_abc123",
 *         "_creationTime": 1699564801000,
 *         "sourceType": "user",
 *         "sourceId": "user_xyz789",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {},
 *         "createdAt": 1699564800000,
 *         "vector": "AAECAwQFBg=="
 *       },
 *       {
 *         "_id": "embedding_def456",
 *         "_creationTime": 1699565401000,
 *         "sourceType": "meeting",
 *         "sourceId": "meeting_aaa111",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {},
 *         "createdAt": 1699565400000,
 *         "vector": "AQIDBAUGBw=="
 *       }
 *     ],
 *     "isDone": false,
 *     "continueCursor": "cursor_xyz"
 *   }
 * }
 * ```
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
 * @summary Performs vector similarity search using cosine similarity
 * @description Searches for embeddings similar to the provided query vector using cosine similarity calculation.
 * Supports filtering by source types and model. Returns results above the similarity threshold, sorted by score
 * (highest first). Limits candidate set to 500 embeddings for performance. Maximum result limit is 256.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "queryVector": "AAECAwQFBg==",
 *     "sourceTypes": ["user", "meeting"],
 *     "model": "text-embedding-3-small",
 *     "limit": 10,
 *     "threshold": 0.75
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": [
 *     {
 *       "embedding": {
 *         "_id": "embedding_abc123",
 *         "_creationTime": 1699564801000,
 *         "sourceType": "user",
 *         "sourceId": "user_xyz789",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {},
 *         "createdAt": 1699564800000,
 *         "vector": "AAECAwQFBg=="
 *       },
 *       "score": 0.92,
 *       "sourceData": null
 *     },
 *     {
 *       "embedding": {
 *         "_id": "embedding_def456",
 *         "_creationTime": 1699565401000,
 *         "sourceType": "meeting",
 *         "sourceId": "meeting_aaa111",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {},
 *         "createdAt": 1699565400000,
 *         "vector": "AQIDBAUGBw=="
 *       },
 *       "score": 0.87,
 *       "sourceData": null
 *     }
 *   ]
 * }
 * ```
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
      candidates = candidates.filter((candidate) =>
        allowed.has(candidate.sourceType),
      );
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
 * @summary Retrieves embedding analytics and metrics
 * @description Provides comprehensive analytics about embeddings including total count, distribution by source
 * type and model, storage usage metrics, and quality indicators. Collects all embeddings for analysis (consider
 * pagination for large datasets). Returns aggregated statistics useful for monitoring and optimization.
 *
 * @example request
 * ```json
 * {
 *   "args": {}
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "totalEmbeddings": 1247,
 *     "embeddingsBySource": {
 *       "user": 523,
 *       "meeting": 412,
 *       "note": 198,
 *       "transcriptSegment": 114
 *     },
 *     "embeddingsByModel": {
 *       "text-embedding-3-small": 1100,
 *       "text-embedding-ada-002": 147
 *     },
 *     "averageProcessingTime": 0,
 *     "storageUsage": {
 *       "totalVectors": 1247,
 *       "totalDimensions": 1915392,
 *       "estimatedSizeBytes": 7661568
 *     },
 *     "searchMetrics": {
 *       "totalSearches": 0,
 *       "averageSearchTime": 0,
 *       "averageResultCount": 0
 *     },
 *     "qualityMetrics": {
 *       "averageSimilarityScore": 0,
 *       "lowQualityEmbeddings": 0,
 *       "duplicateDetections": 0
 *     }
 *   }
 * }
 * ```
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
 * @summary Retrieves vector index metadata
 * @description Fetches metadata about vector indexes including provider, configuration, and status. Returns
 * only active indexes ordered by creation time (newest first). Supports pagination for efficient traversal.
 * Useful for monitoring index health and configuration management.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "paginationOpts": {
 *       "numItems": 10,
 *       "cursor": null
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
 *     "page": [
 *       {
 *         "_id": "vectorIndexMeta_abc123",
 *         "_creationTime": 1699564800500,
 *         "provider": "convex",
 *         "indexName": "embeddings_v1",
 *         "config": {
 *           "dimensions": "1536",
 *           "metric": "cosine"
 *         },
 *         "status": "active",
 *         "createdAt": 1699564800000,
 *         "updatedAt": 1699564800000
 *       }
 *     ],
 *     "isDone": true,
 *     "continueCursor": ""
 *   }
 * }
 * ```
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
 * @summary Finds embeddings similar to a specific source
 * @description Retrieves the embedding for the specified source and finds similar embeddings of the same type
 * using cosine similarity. Excludes the source embedding from results. Limits candidate set to 300 embeddings
 * for performance. Returns results sorted by similarity score (highest first).
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "sourceType": "user",
 *     "sourceId": "user_xyz789",
 *     "limit": 5
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": [
 *     {
 *       "embedding": {
 *         "_id": "embedding_abc123",
 *         "_creationTime": 1699564801000,
 *         "sourceType": "user",
 *         "sourceId": "user_aaa111",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {},
 *         "createdAt": 1699564800000,
 *         "vector": "AAECAwQFBg=="
 *       },
 *       "score": 0.89,
 *       "sourceData": null
 *     }
 *   ]
 * }
 * ```
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

    const comparisonVector = VectorUtils.bufferToFloatArray(
      sourceEmbedding.vector,
    );
    if (comparisonVector.length === 0) {
      return [];
    }

    const candidateLimit = Math.min(limit * 10, 300);

    let queryBuilder = ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", sourceEmbedding.sourceType),
      )
      .order("desc");

    let candidates = await queryBuilder.take(candidateLimit);
    candidates = candidates.filter(
      (candidate) => candidate._id !== sourceEmbedding._id,
    );

    const results: Array<SimilaritySearchResult & { score: number }> = [];
    for (const candidate of candidates) {
      const candidateVector = VectorUtils.bufferToFloatArray(candidate.vector);
      if (candidateVector.length !== comparisonVector.length) {
        continue;
      }

      const score = VectorUtils.cosineSimilarity(
        comparisonVector,
        candidateVector,
      );
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
 * @summary Retrieves embedding with enriched source details
 * @description Fetches an embedding and enriches it with details from the source entity (user, meeting, etc.).
 * For user sources, includes display name, avatar, and creation time. For meeting sources, includes title,
 * description, and creation time. Returns null if the embedding does not exist.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "embeddingId": "embedding_abc123"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "embedding_abc123",
 *     "_creationTime": 1699564801000,
 *     "sourceType": "user",
 *     "sourceId": "user_xyz789",
 *     "model": "text-embedding-3-small",
 *     "dimensions": 1536,
 *     "version": "v1",
 *     "metadata": {},
 *     "createdAt": 1699564800000,
 *     "vector": "AAECAwQFBg==",
 *     "sourceDetails": {
 *       "title": "John Doe",
 *       "author": {
 *         "_id": "user_xyz789",
 *         "displayName": "John Doe",
 *         "avatarUrl": "https://example.com/avatar.jpg"
 *       },
 *       "createdAt": 1699564800000
 *     }
 *   }
 * }
 * ```
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
 * @summary Checks if embedding exists for a source
 * @description Verifies whether an embedding exists for the specified source and optionally filters by model.
 * Uses indexed query for optimal performance. Returns true if at least one matching embedding exists, false
 * otherwise. Useful for avoiding duplicate embedding generation.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "sourceType": "user",
 *     "sourceId": "user_xyz789",
 *     "model": "text-embedding-3-small"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": true
 * }
 * ```
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
