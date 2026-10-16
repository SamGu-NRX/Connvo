import {
  internalQuery,
  internalMutation,
  internalAction,
} from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { v } from "convex/values";
import { metadataRecordV } from "@convex/lib/validators";
import type { Id } from "@convex/_generated/dataModel";

export const getKey = internalQuery({
  args: { key: v.string(), scope: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("idempotencyKeys"),
      _creationTime: v.number(),
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

/** Claim or replace an action marker in one transaction, including stale takeover. */
export const claimActionKey = internalMutation({
  args: {
    key: v.string(),
    scope: v.string(),
    ttlMs: v.number(),
    leaseMs: v.number(),
    allowRetry: v.boolean(),
  },
  returns: v.object({
    id: v.union(v.id("idempotencyKeys"), v.null()),
    previousError: v.optional(v.string()),
    result: v.optional(v.union(v.string(), v.number(), v.boolean())),
  }),
  handler: async (ctx, { key, scope, ttlMs, leaseMs, allowRetry }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_scope", (q) => q.eq("key", key).eq("scope", scope))
      .unique();
    if (existing) {
      const meta = existing.metadata ?? {};
      const startedAt =
        typeof meta.startedAt === "number"
          ? meta.startedAt
          : existing.createdAt;
      // A live lease takes precedence even if the completed-marker TTL expired.
      if (meta.status === "executing" && startedAt + leaseMs >= now) {
        return { id: null, previousError: "Operation is currently executing" };
      }
      const expired = existing.createdAt + ttlMs < now;
      const stale = meta.status === "executing" && startedAt + leaseMs < now;
      // retryable: false marks a terminal failure (see isRetryable in
      // convex/lib/idempotency.ts); allowRetry does not clear it.
      const retryable = meta.failed && allowRetry && meta.retryable !== false;
      if (!expired && !stale && !retryable) {
        return meta.failed
          ? {
              id: null,
              previousError: String(meta.error ?? "Previous execution failed"),
            }
          : { id: null, result: meta.result };
      }
      // Delete and insert atomically so competing attempts cannot both acquire.
      await ctx.db.delete(existing._id);
    }
    const id = await ctx.db.insert("idempotencyKeys", {
      key,
      scope,
      createdAt: now,
      metadata: { status: "executing", startedAt: now },
    });
    return { id };
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
      const inlineValue = meta["resultInline"] as
        | string
        | number
        | boolean
        | undefined;
      return { kind: "inline" as const, inlineValue };
    }
    if (resultType === "storage") {
      const rawRef = meta["resultRef"];
      const ref = typeof rawRef === "string" ? rawRef.trim() : "";

      // Validate the reference before attempting to read from storage
      if (!ref) {
        return { kind: "storage" as const, json: "", size: 0 };
      }

      // Narrow to a Convex storage Id after runtime validation
      const storageId = ref as unknown as Id<"_storage">;

      try {
        const blob = await ctx.storage.get(storageId);
        if (!blob) {
          // Blob was not found; return an empty storage result
          return { kind: "storage" as const, json: "", size: 0 };
        }
        const json = await blob.text();

        // Safely compute size: prefer validated numeric metadata, fallback to json length
        const sizeMeta = meta["resultSize"];
        const metaSize =
          typeof sizeMeta === "number" &&
          Number.isFinite(sizeMeta) &&
          sizeMeta >= 0
            ? sizeMeta
            : undefined;

        return {
          kind: "storage" as const,
          json: json ?? "",
          size: metaSize ?? (json ? json.length : 0),
        };
      } catch (err) {
        // Provide a clear error for upstream handling
        throw new Error(
          `STORAGE_READ_FAILED: Unable to read stored idempotency result for key='${key}', scope='${scope}', ref='${ref}'.`,
        );
      }
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
    // Use integer division to avoid floating-point issues
    const windowStartMs = now - (now % windowMs);
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action_window", (q) =>
        q
          .eq("userId", userId)
          .eq("action", action)
          .eq("windowStartMs", windowStartMs),
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

    if (nextCount > maxCount) {
      const resetAt = windowStartMs + windowMs;
      const resetIn = Math.ceil((resetAt - now) / 1000);
      throw new Error(
        `RATE_LIMIT_EXCEEDED: Rate limit exceeded for action '${action}'. Try again in ${resetIn} seconds.`,
      );
    }

    await ctx.db.patch(existing._id, { count: nextCount, updatedAt: now });

    return {
      remaining: maxCount - nextCount,
      resetAt: windowStartMs + windowMs,
    };
  },
});
