import {
  internalQuery,
  internalMutation,
  internalAction,
} from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { v } from "convex/values";
import { metadataRecordV } from "@convex/lib/validators";
import type { Id } from "@convex/_generated/dataModel";

/**
 * @summary Gets idempotency key record
 * @description Retrieves an idempotency key record by key and scope. Used to check if an operation has already been performed and retrieve cached results. Returns null if the key does not exist.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "key": "create-meeting-abc123",
 *     "scope": "meetings"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "jh8xp9r2k5n6q7s8v9w0y1z2",
 *     "key": "create-meeting-abc123",
 *     "scope": "meetings",
 *     "createdAt": 1704067200000,
 *     "metadata": {
 *       "resultType": "inline",
 *       "resultInline": "meeting_xyz789"
 *     }
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
 */
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

/**
 * @summary Creates idempotency key record
 * @description Creates a new idempotency key record to track operation execution. The key-scope combination must be unique. Metadata can store operation results inline or reference storage for large payloads.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "key": "create-meeting-abc123",
 *     "scope": "meetings",
 *     "metadata": {
 *       "resultType": "inline",
 *       "resultInline": "meeting_xyz789"
 *     },
 *     "createdAt": 1704067200000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": "jh8xp9r2k5n6q7s8v9w0y1z2"
 * }
 * ```
 */
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

/**
 * @summary Updates idempotency key metadata
 * @description Updates the metadata of an existing idempotency key record. Used to store operation results after execution or update cached data.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "id": "jh8xp9r2k5n6q7s8v9w0y1z2",
 *     "metadata": {
 *       "resultType": "storage",
 *       "resultRef": "kg0zs1t4m7p8s9u0v1w2x3y4",
 *       "resultSize": 15420
 *     }
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
 */
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

/**
 * @summary Deletes idempotency key record
 * @description Deletes an idempotency key record. Used during cleanup operations or when invalidating cached results.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "id": "jh8xp9r2k5n6q7s8v9w0y1z2"
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
 */
export const deleteKey = internalMutation({
  args: { id: v.id("idempotencyKeys") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return null;
  },
});

/**
 * @summary Resolves idempotency result
 * @description Resolves and retrieves the result of an idempotent operation. For inline results, returns the stored value directly. For storage-backed results, reads the JSON blob from Convex storage and returns the content with size information.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "key": "create-meeting-abc123",
 *     "scope": "meetings"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "kind": "inline",
 *     "inlineValue": "meeting_xyz789"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "kind": "storage",
 *     "json": "{\"meetingId\":\"meeting_xyz789\",\"participants\":[...]}",
 *     "size": 15420
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "STORAGE_READ_FAILED",
 *     "message": "Unable to read stored idempotency result"
 *   }
 * }
 * ```
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
 * @summary Enforces rate limit for user action
 * @description Enforces rate limiting for a specific user action within a time window. Tracks request counts per user-action-window combination and throws an error when the limit is exceeded. Returns remaining quota and reset time.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "action": "create_meeting",
 *     "windowMs": 60000,
 *     "maxCount": 10
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "remaining": 7,
 *     "resetAt": 1704067260000
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "RATE_LIMIT_EXCEEDED",
 *     "message": "Rate limit exceeded for action 'create_meeting'. Try again in 45 seconds."
 *   }
 * }
 * ```
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
