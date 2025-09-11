import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { metadataRecordV } from "../lib/validators";

export const getKey = internalQuery({
  args: { key: v.string(), scope: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("idempotencyKeys"),
      key: v.string(),
      scope: v.string(),
      createdAt: v.number(),
      metadata: v.optional(metadataRecordV),
    }),
  ),
  handler: async (ctx, { key, scope }) => {
    return await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_scope", (q) => q.eq("key", key).eq("scope", scope))
      .unique();
  },
});

export const createKey = internalMutation({
  args: {
    key: v.string(),
    scope: v.string(),
    metadata: v.optional(metadataRecordV),
    createdAt: v.number(),
  },
  returns: v.id("idempotencyKeys"),
  handler: async (ctx, { key, scope, metadata, createdAt }) => {
    return await ctx.db.insert("idempotencyKeys", {
      key,
      scope,
      metadata: metadata ?? {},
      createdAt,
    });
  },
});

export const patchKey = internalMutation({
  args: {
    id: v.id("idempotencyKeys"),
    metadata: metadataRecordV,
  },
  returns: v.null(),
  handler: async (ctx, { id, metadata }) => {
    await ctx.db.patch(id, { metadata });
    return null;
  },
});

export const deleteKey = internalMutation({
  args: { id: v.id("idempotencyKeys") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return null;
  },
});
