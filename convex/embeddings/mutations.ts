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
 * Create a new embedding (internal)
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
 * Update an existing embedding (internal)
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
 * Delete an embedding (internal)
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
 * Delete embeddings by source (internal)
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
 * Batch create/update embeddings (internal)
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
 * Create or update vector index metadata (internal)
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
 * Update vector index status (internal)
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
 * Clean up old embeddings (internal)
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
