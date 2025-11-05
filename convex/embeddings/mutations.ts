/**
 * Vector Embedding Mutations
 *
 * This module provides mutation functions for creating, updating, and deleting
 * vector embeddings with proper type safety and validation.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Uses new function syntax with proper validators
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "@convex/_generated/server";
import type { Id } from "@convex/_generated/dataModel";
import { ConvexError } from "convex/values";

import {
  EmbeddingV,
  VectorIndexMetaV,
  EmbeddingGenerationV,
  EmbeddingBatchV,
} from "@convex/types/validators/embedding";
import type {
  Embedding,
  EmbeddingGenerationResult,
  EmbeddingBatchResult,
} from "@convex/types/entities/embedding";
import { VectorUtils } from "@convex/types/entities/embedding";

/**
 * @summary Creates or updates an embedding
 * @description Creates a new embedding or updates an existing one if an embedding already exists for the
 * specified source and model. Validates that vector dimensions match the declared dimensions. Returns the
 * embedding ID. Automatically sets creation timestamp and version.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "sourceType": "user",
 *     "sourceId": "user_xyz789",
 *     "vector": "AAECAwQFBg==",
 *     "model": "text-embedding-3-small",
 *     "dimensions": 1536,
 *     "version": "v1",
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
 *   "value": "embedding_abc123"
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Vector dimensions mismatch: expected 1536, got 768"
 *   }
 * }
 * ```
 */
export const createEmbedding = internalMutation({
  args: {
    sourceType: v.union(
      v.literal("user"),
      v.literal("profile"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("transcriptSegment"),
    ),
    sourceId: v.string(),
    vector: v.bytes(), // Use ArrayBuffer for performance
    model: v.string(),
    dimensions: v.number(),
    version: v.optional(v.string()),
    metadata: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
  },
  returns: v.id("embeddings"),
  handler: async (ctx, args): Promise<Id<"embeddings">> => {
    const now = Date.now();

    // Validate vector dimensions match the declared dimensions
    const vectorArray = new Float32Array(args.vector);
    if (vectorArray.length !== args.dimensions) {
      throw new ConvexError(
        `Vector dimensions mismatch: expected ${args.dimensions}, got ${vectorArray.length}`,
      );
    }

    // Check if embedding already exists for this source
    const existingEmbedding = await ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .filter((q) => q.eq(q.field("model"), args.model))
      .first();

    if (existingEmbedding) {
      // Update existing embedding
      await ctx.db.patch(existingEmbedding._id, {
        vector: args.vector,
        dimensions: args.dimensions,
        version: args.version ?? "v1",
        metadata: args.metadata ?? {},
        createdAt: now, // Update timestamp for new embedding
      });
      return existingEmbedding._id;
    }

    // Create new embedding
    return await ctx.db.insert("embeddings", {
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      vector: args.vector,
      model: args.model,
      dimensions: args.dimensions,
      version: args.version ?? "v1",
      metadata: args.metadata ?? {},
      createdAt: now,
    });
  },
});

/**
 * @summary Updates an existing embedding
 * @description Updates vector data, metadata, or version for an existing embedding. When updating the vector,
 * validates that dimensions match the original embedding dimensions. Metadata updates are merged with existing
 * metadata. Returns null on success.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "embeddingId": "embedding_abc123",
 *     "metadata": {
 *       "updatedAt": "1699565400000",
 *       "quality": "high"
 *     },
 *     "version": "v2"
 *   }
 * }
 * ```
 *
 * @example response
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
 *     "message": "Embedding not found"
 *   }
 * }
 * ```
 */
export const updateEmbedding = internalMutation({
  args: {
    embeddingId: v.id("embeddings"),
    vector: v.optional(v.bytes()),
    metadata: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    version: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const embedding = await ctx.db.get(args.embeddingId);
    if (!embedding) {
      throw new ConvexError("Embedding not found");
    }

    const updates: Partial<Embedding> = {};

    if (args.vector) {
      // Validate vector dimensions if updating vector
      const vectorArray = new Float32Array(args.vector);
      if (vectorArray.length !== embedding.dimensions) {
        throw new ConvexError(
          `Vector dimensions mismatch: expected ${embedding.dimensions}, got ${vectorArray.length}`,
        );
      }
      updates.vector = args.vector;
    }

    if (args.metadata) {
      updates.metadata = { ...embedding.metadata, ...args.metadata };
    }

    if (args.version) {
      updates.version = args.version;
    }

    await ctx.db.patch(args.embeddingId, updates);
    return null;
  },
});

/**
 * @summary Deletes an embedding by ID
 * @description Permanently removes an embedding from the database. Throws an error if the embedding does not
 * exist. Returns null on successful deletion.
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
 *     "message": "Embedding not found"
 *   }
 * }
 * ```
 */
export const deleteEmbedding = internalMutation({
  args: { embeddingId: v.id("embeddings") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const embedding = await ctx.db.get(args.embeddingId);
    if (!embedding) {
      throw new ConvexError("Embedding not found");
    }

    await ctx.db.delete(args.embeddingId);
    return null;
  },
});

/**
 * @summary Deletes all embeddings for a source
 * @description Removes all embeddings associated with a specific source. Optionally filters by model to delete
 * only embeddings generated with a specific model. Returns the count of deleted embeddings. Uses indexed query
 * for optimal performance.
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
 *   "value": 3
 * }
 * ```
 */
export const deleteEmbeddingsBySource = internalMutation({
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
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    let query = ctx.db
      .query("embeddings")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      );

    const embeddings = await query.collect();

    let deletedCount = 0;
    for (const embedding of embeddings) {
      if (!args.model || embedding.model === args.model) {
        await ctx.db.delete(embedding._id);
        deletedCount++;
      }
    }

    return deletedCount;
  },
});

/**
 * @summary Batch creates or updates multiple embeddings
 * @description Processes multiple embedding upsert operations in a single transaction. For each embedding,
 * creates a new record or updates an existing one if it already exists for the source and model. Validates
 * vector dimensions for each embedding. Returns counts of created, updated, and failed operations along with
 * all embedding IDs.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "embeddings": [
 *       {
 *         "sourceType": "user",
 *         "sourceId": "user_abc123",
 *         "vector": "AAECAwQFBg==",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {}
 *       },
 *       {
 *         "sourceType": "meeting",
 *         "sourceId": "meeting_xyz789",
 *         "vector": "AQIDBAUGBw==",
 *         "model": "text-embedding-3-small",
 *         "dimensions": 1536,
 *         "version": "v1",
 *         "metadata": {}
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "created": 2,
 *     "updated": 0,
 *     "failed": 0,
 *     "embeddingIds": [
 *       "embedding_aaa111",
 *       "embedding_bbb222"
 *     ]
 *   }
 * }
 * ```
 */
export const batchUpsertEmbeddings = internalMutation({
  args: {
    embeddings: v.array(
      v.object({
        sourceType: v.union(
          v.literal("user"),
          v.literal("profile"),
          v.literal("meeting"),
          v.literal("note"),
          v.literal("transcriptSegment"),
        ),
        sourceId: v.string(),
        vector: v.bytes(),
        model: v.string(),
        dimensions: v.number(),
        version: v.optional(v.string()),
        metadata: v.optional(
          v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
        ),
      }),
    ),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    failed: v.number(),
    embeddingIds: v.array(v.id("embeddings")),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;
    let failed = 0;
    const embeddingIds: Id<"embeddings">[] = [];

    for (const embeddingData of args.embeddings) {
      try {
        // Validate vector dimensions
        const vectorArray = new Float32Array(embeddingData.vector);
        if (vectorArray.length !== embeddingData.dimensions) {
          failed++;
          continue;
        }

        // Check if embedding exists
        const existingEmbedding = await ctx.db
          .query("embeddings")
          .withIndex("by_source", (q) =>
            q
              .eq("sourceType", embeddingData.sourceType)
              .eq("sourceId", embeddingData.sourceId),
          )
          .filter((q) => q.eq(q.field("model"), embeddingData.model))
          .first();

        if (existingEmbedding) {
          // Update existing
          await ctx.db.patch(existingEmbedding._id, {
            vector: embeddingData.vector,
            dimensions: embeddingData.dimensions,
            version: embeddingData.version ?? "v1",
            metadata: embeddingData.metadata ?? {},
            createdAt: now,
          });
          embeddingIds.push(existingEmbedding._id);
          updated++;
        } else {
          // Create new
          const embeddingId = await ctx.db.insert("embeddings", {
            sourceType: embeddingData.sourceType,
            sourceId: embeddingData.sourceId,
            vector: embeddingData.vector,
            model: embeddingData.model,
            dimensions: embeddingData.dimensions,
            version: embeddingData.version ?? "v1",
            metadata: embeddingData.metadata ?? {},
            createdAt: now,
          });
          embeddingIds.push(embeddingId);
          created++;
        }
      } catch (error) {
        failed++;
        console.error("Failed to upsert embedding:", error);
      }
    }

    return {
      created,
      updated,
      failed,
      embeddingIds,
    };
  },
});

/**
 * @summary Creates or updates vector index metadata
 * @description Creates new vector index metadata or updates existing metadata if an entry already exists for
 * the provider and index name. Stores configuration details and status. Automatically manages creation and
 * update timestamps. Returns the index metadata ID.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "provider": "convex",
 *     "indexName": "embeddings_v1",
 *     "config": {
 *       "dimensions": "1536",
 *       "metric": "cosine",
 *       "shards": "4"
 *     },
 *     "status": "active"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": "vectorIndexMeta_abc123"
 * }
 * ```
 */
export const upsertVectorIndexMeta = internalMutation({
  args: {
    provider: v.string(),
    indexName: v.string(),
    config: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("migrating"),
    ),
  },
  returns: v.id("vectorIndexMeta"),
  handler: async (ctx, args): Promise<Id<"vectorIndexMeta">> => {
    const now = Date.now();

    // Check if index meta already exists
    const existingMeta = await ctx.db
      .query("vectorIndexMeta")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .filter((q) => q.eq(q.field("indexName"), args.indexName))
      .first();

    if (existingMeta) {
      // Update existing
      await ctx.db.patch(existingMeta._id, {
        config: args.config,
        status: args.status,
        updatedAt: now,
      });
      return existingMeta._id;
    }

    // Create new
    return await ctx.db.insert("vectorIndexMeta", {
      provider: args.provider,
      indexName: args.indexName,
      config: args.config,
      status: args.status,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * @summary Updates vector index status
 * @description Updates the status of a vector index metadata entry. Automatically updates the timestamp.
 * Throws an error if the index metadata does not exist. Returns null on success.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "indexMetaId": "vectorIndexMeta_abc123",
 *     "status": "migrating"
 *   }
 * }
 * ```
 *
 * @example response
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
 *     "message": "Vector index metadata not found"
 *   }
 * }
 * ```
 */
export const updateVectorIndexStatus = internalMutation({
  args: {
    indexMetaId: v.id("vectorIndexMeta"),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("migrating"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const indexMeta = await ctx.db.get(args.indexMetaId);
    if (!indexMeta) {
      throw new ConvexError("Vector index metadata not found");
    }

    await ctx.db.patch(args.indexMetaId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * @summary Cleans up old embeddings based on age
 * @description Removes embeddings older than the specified time threshold. Optionally filters by model and
 * source type. Supports dry-run mode to preview deletions without actually removing data. Returns counts of
 * found and deleted embeddings. Uses indexed query for optimal performance.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "olderThanMs": 2592000000,
 *     "model": "text-embedding-3-small",
 *     "sourceType": "meeting",
 *     "dryRun": false
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "found": 47,
 *     "deleted": 47
 *   }
 * }
 * ```
 *
 * @example response-dryrun
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "found": 47,
 *     "deleted": 0
 *   }
 * }
 * ```
 */
export const cleanupOldEmbeddings = internalMutation({
  args: {
    olderThanMs: v.number(),
    model: v.optional(v.string()),
    sourceType: v.optional(
      v.union(
        v.literal("user"),
        v.literal("profile"),
        v.literal("meeting"),
        v.literal("note"),
        v.literal("transcriptSegment"),
      ),
    ),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    found: v.number(),
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const cutoffTime = Date.now() - args.olderThanMs;

    // Get old embeddings
    let query = ctx.db
      .query("embeddings")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoffTime));

    const oldEmbeddings = await query.collect();

    // Filter by additional criteria
    const filteredEmbeddings = oldEmbeddings.filter((embedding) => {
      if (args.model && embedding.model !== args.model) return false;
      if (args.sourceType && embedding.sourceType !== args.sourceType)
        return false;
      return true;
    });

    let deleted = 0;
    if (!args.dryRun) {
      for (const embedding of filteredEmbeddings) {
        await ctx.db.delete(embedding._id);
        deleted++;
      }
    }

    return {
      found: filteredEmbeddings.length,
      deleted,
    };
  },
});
