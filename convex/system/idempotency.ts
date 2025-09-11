import { internalQuery, internalMutation, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
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

/**
 * Resolve an idempotency result in a safe, typed way.
 * - If resultType === 'inline', returns inlineValue
 * - If resultType === 'storage', reads the JSON blob and returns json string with size
 */
export const resolveResult = internalAction({
  args: {
    key: v.string(),
    scope: v.string(),
  },
  returns: v.object({
    kind: v.union(v.literal("inline"), v.literal("storage")),
    inlineValue: v.optional(v.union(v.string(), v.number(), v.boolean())),
    json: v.optional(v.string()),
    size: v.optional(v.number()),
  }),
  handler: async (ctx, { key, scope }) => {
    const record = await ctx.runQuery(internal.system.idempotency.getKey, {
      key,
      scope,
    });
    if (!record || !record.metadata) {
      return { kind: "inline" as const, inlineValue: undefined };
    }
    const meta = record.metadata as Record<string, string | number | boolean>;
    const resultType = meta["resultType"];
    if (resultType === "inline") {
      const inlineValue = meta["resultInline"] as string | number | boolean | undefined;
      return { kind: "inline" as const, inlineValue };
    }
    if (resultType === "storage") {
      const ref = String(meta["resultRef"] || "");
      if (!ref) return { kind: "storage" as const, json: "", size: 0 };
      const blob = await ctx.storage.get(ref as any);
      const json = await blob?.text();
      return {
        kind: "storage" as const,
        json: json ?? "",
        size: (meta["resultSize"] as number) || (json ? json.length : 0),
      };
    }
    // Unknown type fallback
    return { kind: "inline" as const, inlineValue: undefined };
  },
});

/**
 * Internal rate limit enforcement colocated with idempotency to avoid codegen churn.
 */
export const enforceRateLimit = internalMutation({
  args: {
    userId: v.id("users"),
    action: v.string(),
    windowMs: v.number(),
    maxCount: v.number(),
  },
  returns: v.object({ remaining: v.number(), resetAt: v.number() }),
  handler: async (ctx, { userId, action, windowMs, maxCount }) => {
    const now = Date.now();
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action_window", (q) =>
        q.eq("userId", userId).eq("action", action).eq("windowStartMs", windowStartMs),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("rateLimits", {
        userId,
        action,
        windowStartMs,
        count: 1,
        createdAt: now,
        updatedAt: now,
      });
      return { remaining: maxCount - 1, resetAt: windowStartMs + windowMs };
    }

    const nextCount = existing.count + 1;
    await ctx.db.patch(existing._id, { count: nextCount, updatedAt: now });

    if (nextCount > maxCount) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    return { remaining: maxCount - nextCount, resetAt: windowStartMs + windowMs };
  },
});
