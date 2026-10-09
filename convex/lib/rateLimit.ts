/**
 * Rate Limiting Utilities for Convex
 *
 * This module provides fixed-window rate limiting backed by the `rateLimits`
 * table, plus cleanup and monitoring helpers for high-frequency operations.
 * Each window is a fixed bucket aligned to `windowMs` (not a true sliding
 * window): counters reset at every window boundary.
 *
 * Requirements: 19.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { QueryCtx, MutationCtx, ActionCtx } from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { createError } from "@convex/lib/errors";

// Note: Writes must occur in a MutationCtx. Avoid unsafe casts.

/**
 * Configuration for a fixed-window rate limit checked against the
 * `rateLimits` table.
 *
 * - `maxRequests`: maximum hits allowed per user/action within one window.
 * - `windowMs`: window length in milliseconds. Windows are buckets aligned to
 *   multiples of `windowMs` since the epoch, so counters reset at each
 *   boundary rather than sliding.
 * - `keyPrefix`: optional prefix stored as `${keyPrefix}_${action}`; omit it
 *   to use `action` alone as the storage key.
 * - `skipSuccessfulRequests` / `skipFailedRequests`: declared but never read
 *   anywhere in this module (dead options).
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Outcome of a rate limit check.
 *
 * - `allowed`: whether this call is still under the configured `maxRequests`.
 * - `remaining`: hits left in the current window (never negative).
 * - `resetTime`: epoch ms at which the current fixed window ends and the
 *   counter resets.
 * - `totalHits`: count recorded for this key in the current window,
 *   including any increment performed by the check itself.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalHits: number;
}

/**
 * Preset per-minute limits for common operations. Each preset's `keyPrefix`
 * is joined with the caller's action string as `${keyPrefix}_${action}`.
 * Values (maxRequests per 60000ms window): TRANSCRIPT_INGESTION 50,
 * NOTE_OPERATIONS 100, MEETING_ACTIONS 20, API_CALLS 1000,
 * SEARCH_QUERIES 100.
 */
export const RateLimitConfigs = {
  TRANSCRIPT_INGESTION: {
    maxRequests: 50,
    windowMs: 60000, // 1 minute
    keyPrefix: "transcript_ingestion",
  },
  NOTE_OPERATIONS: {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    keyPrefix: "note_operations",
  },
  MEETING_ACTIONS: {
    maxRequests: 20,
    windowMs: 60000, // 1 minute
    keyPrefix: "meeting_actions",
  },
  API_CALLS: {
    maxRequests: 1000,
    windowMs: 60000, // 1 minute
    keyPrefix: "api_calls",
  },
  SEARCH_QUERIES: {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    keyPrefix: "search_queries",
  },
} as const;

/**
 * Fixed-window, database-backed rate limiter.
 *
 * All state lives in the `rateLimits` table keyed by
 * (userId, action key, windowStartMs) through the `by_user_action_window`
 * index, so counters are consistent for concurrent callers: every check
 * reads and writes inside the caller's Convex transaction. Despite earlier
 * doc wording, this is a fixed-window counter, not a sliding window: usage
 * is measured against one bucket that resets every `windowMs`.
 */
export class RateLimiter {
  /**
   * Records one hit for the user/action pair and reports whether it is
   * still under the configured limit.
   *
   * Computes the current fixed window from `Date.now()`, builds the storage
   * key as `${config.keyPrefix}_${action}` (or plain `action` when no prefix
   * is configured), and looks up the existing `rateLimits` row through the
   * `by_user_action_window` index. When a row exists below `maxRequests` it
   * patches `count`/`updatedAt`; otherwise it inserts a new row with
   * `count: 1`. Both paths write inside the caller's mutation transaction.
   * Returns `allowed: false` without writing once the stored count has
   * reached `maxRequests`. Throws if more than one row matches the index
   * (`.unique()` fails), which would signal duplicate records for a window.
   * Logs each check to the console in non-production environments.
   */
  static async checkRateLimit(
    ctx: MutationCtx,
    userId: Id<"users">,
    action: string,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    // Use fixed-size time buckets to avoid hot partitions and ensure uniqueness
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const key = config.keyPrefix ? `${config.keyPrefix}_${action}` : action;

    // Get existing rate limit record
    const existingLimit = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action_window", (q) =>
        q
          .eq("userId", userId)
          .eq("action", key)
          .eq("windowStartMs", windowStart),
      )
      .unique();

    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[RateLimiter] check",
        JSON.stringify({
          key,
          windowStart,
          existing: !!existingLimit,
          count: existingLimit?.count ?? 0,
        }),
      );
    }

    let currentCount = 0;
    let remaining = config.maxRequests;

    if (existingLimit) {
      currentCount = existingLimit.count;
      remaining = Math.max(0, config.maxRequests - currentCount);

      if (currentCount >= config.maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: windowStart + config.windowMs,
          totalHits: currentCount,
        };
      }

      // Update count within the same mutation (transactional in Convex)
      await ctx.db.patch(existingLimit._id, {
        count: currentCount + 1,
        updatedAt: now,
      });
      currentCount += 1;
    } else {
      // Create new rate limit record
      await ctx.db.insert("rateLimits", {
        userId,
        action: key,
        windowStartMs: windowStart,
        count: 1,
        createdAt: now,
        updatedAt: now,
      });
      currentCount = 1;
    }

    remaining = Math.max(0, config.maxRequests - currentCount);

    return {
      allowed: true,
      remaining,
      resetTime: windowStart + config.windowMs,
      totalHits: currentCount,
    };
  }

  /**
   * Throws a 429 `ConvexError` (from `createError.rateLimitExceeded`, with
   * metadata `{ action, limit }`) when the user/action window has already
   * reached `maxRequests`; otherwise returns the result of the checked
   * increment. A denied call performs no database write.
   */
  static async enforceRateLimit(
    ctx: MutationCtx,
    userId: Id<"users">,
    action: string,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const result = await this.checkRateLimit(ctx, userId, action, config);

    if (!result.allowed) {
      throw createError.rateLimitExceeded(action, config.maxRequests);
    }

    return result;
  }

  /**
   * Enforces a rate limit from an `ActionCtx` (actions cannot write to the
   * database directly) by running the `internal.system.rateLimit.enforce`
   * internal mutation with the resolved key and config values.
   *
   * On success maps the mutation's `{ remaining, resetAt }` into a
   * `RateLimitResult`, deriving `totalHits` as `config.maxRequests -
   * remaining`. Any error thrown by the mutation — including its own
   * "RATE_LIMIT_EXCEEDED" signal, deployment unavailability, or schema
   * failures — is caught and rethrown as a 429 rate-limit-exceeded
   * `ConvexError`, so callers cannot distinguish "limit exhausted" from
   * "enforcement infrastructure failed" by the error type alone.
   */
  static async enforceFromAction(
    ctx: ActionCtx,
    userId: Id<"users">,
    action: string,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const key = config.keyPrefix ? `${config.keyPrefix}_${action}` : action;
    try {
      const { remaining, resetAt } = await ctx.runMutation(
        internal.system.rateLimit.enforce,
        {
          userId,
          action: key,
          windowMs: config.windowMs,
          maxCount: config.maxRequests,
        },
      );
      return {
        allowed: true,
        remaining,
        resetTime: resetAt,
        totalHits: config.maxRequests - remaining,
      };
    } catch (err) {
      throw createError.rateLimitExceeded(action, config.maxRequests);
    }
  }

  /**
   * Reads the current window's usage for a user/action without writing, so
   * it is safe to call from a `QueryCtx`. Uses the same fixed-window bucket
   * math and key building as `checkRateLimit`; reports `allowed` as
   * `currentCount < maxRequests` and `totalHits` as the stored count (0 when
   * no record exists for this window yet).
   */
  static async getRateLimitStatus(
    ctx: QueryCtx,
    userId: Id<"users">,
    action: string,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const key = config.keyPrefix ? `${config.keyPrefix}_${action}` : action;

    const existingLimit = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action_window", (q) =>
        q
          .eq("userId", userId)
          .eq("action", key)
          .eq("windowStartMs", windowStart),
      )
      .unique();

    const currentCount = existingLimit?.count || 0;
    const remaining = Math.max(0, config.maxRequests - currentCount);

    return {
      allowed: currentCount < config.maxRequests,
      remaining,
      resetTime: windowStart + config.windowMs,
      totalHits: currentCount,
    };
  }

  /**
   * Deletes `rateLimits` rows whose `windowStartMs` is older than
   * `olderThanMs` (default 24 hours) and returns how many were deleted.
   *
   * Scans with a full-table `.filter()` because the table has no index on
   * `windowStartMs` alone, so cost grows with total table size; run this
   * from a scheduled internal mutation, not per-request. Requires a
   * `MutationCtx` because it deletes rows.
   */
  static async cleanupExpiredLimits(
    ctx: MutationCtx,
    olderThanMs = 24 * 60 * 60 * 1000, // 24 hours
  ): Promise<number> {
    const cutoff = Date.now() - olderThanMs;

    // Find expired rate limit records
    const expiredLimits = await ctx.db
      .query("rateLimits")
      .filter((q) => q.lt(q.field("windowStartMs"), cutoff))
      .collect();

    // Delete expired records
    for (const limit of expiredLimits) {
      await ctx.db.delete(limit._id);
    }

    return expiredLimits.length;
  }

  /**
   * Aggregates `rateLimits` activity over the trailing `timeRangeMs`
   * (default 1 hour): total recorded hits across all rows, number of
   * distinct users, the top 10 actions by recorded hits, and an approximate
   * count of rate limit hits (exhausted windows).
   *
   * Reads only; safe from a `QueryCtx`. The `rateLimitHits` figure is a
   * heuristic — it counts any row whose `count` reached 50 — so it
   * over-reports for high-limit actions (e.g. API_CALLS allows 1000) and
   * under-reports otherwise, because `maxRequests` is not stored with the
   * row.
   */
  static async getRateLimitStats(
    ctx: QueryCtx,
    timeRangeMs = 60 * 60 * 1000, // 1 hour
  ): Promise<{
    totalRequests: number;
    uniqueUsers: number;
    topActions: Array<{ action: string; requests: number }>;
    rateLimitHits: number;
  }> {
    const since = Date.now() - timeRangeMs;

    const recentLimits = await ctx.db
      .query("rateLimits")
      .filter((q) => q.gte(q.field("windowStartMs"), since))
      .collect();

    const totalRequests = recentLimits.reduce(
      (sum, limit) => sum + limit.count,
      0,
    );
    const uniqueUsers = new Set(recentLimits.map((limit) => limit.userId)).size;

    // Initialize counters
    const actionCounts = new Map<string, number>();
    let rateLimitHits = 0;

    // Check against actual configured limits to detect rate limit hits
    // This would require passing config or storing maxRequests with the limit record
    // For now, this is a limitation that should be documented
    // TODO: Store maxRequests with rate limit records for accurate detection

    for (const limit of recentLimits) {
      const current = actionCounts.get(limit.action) || 0;
      actionCounts.set(limit.action, current + limit.count);

      // Estimate rate limit hits (this is approximate)
      if (limit.count >= 50) {
        // Assuming most limits are around 50-100
        rateLimitHits++;
      }
    }

    const topActions: Array<{ action: string; requests: number }> = Array.from(
      actionCounts.entries(),
    )
      .map(([action, requests]) => ({ action, requests }))
      .sort(
        (
          a: { action: string; requests: number },
          b: { action: string; requests: number },
        ) => b.requests - a.requests,
      )
      .slice(0, 10);

    return {
      totalRequests,
      uniqueUsers,
      topActions,
      rateLimitHits,
    };
  }
}

/**
 * Legacy-style method decorator that rate limits a class method whose first
 * argument is a Convex context.
 *
 * Before each call it resolves the caller: from `ctx.auth.getUserIdentity()`
 * it prefers `identity.userId`, falling back to a `users` lookup by
 * `workosUserId` (via the `by_workos_id` index). Enforcement is skipped,
 * with a dev-only console warning, when there is no identity or no
 * resolvable user id.
 *
 * Deliberately (but surprisingly) non-blocking: enforcement happens inside
 * a try/catch whose handler only logs, so a rate-limit-exceeded error does
 * not stop the wrapped method from executing. The decorator therefore
 * increments counters and emits warnings but can never deny a request.
 * Currently unused anywhere in the codebase; the descriptor signature
 * requires the legacy `experimentalDecorators` mode, which `tsconfig.json`
 * does not enable.
 */
export function withRateLimit(config: RateLimitConfig) {
  return function <T extends any[], R>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: T) => Promise<R>>,
  ) {
    const originalMethod = descriptor.value!;

    descriptor.value = async function (this: any, ...args: T): Promise<R> {
      // Extract context and user ID from arguments
      // This assumes the first argument is the Convex context
      const ctx = args[0] as MutationCtx;
      if (ctx && (ctx as any).auth && ctx.db) {
        try {
          const identity = await (ctx as any).auth.getUserIdentity();
          if (identity) {
            // Validate and normalize identity to a proper Id<"users">
            let validatedUserId: Id<"users"> | null = null;

            // Prefer provider-populated identity.userId when available
            const possibleUserId = (identity as any).userId;
            if (
              typeof possibleUserId === "string" &&
              possibleUserId.length > 0
            ) {
              validatedUserId = possibleUserId as Id<"users">;
            } else if (
              typeof identity.subject === "string" &&
              identity.subject.length > 0
            ) {
              // Fallback: try to resolve by external subject (e.g., WorkOS user id)
              const user = await ctx.db
                .query("users")
                .withIndex("by_workos_id", (q) =>
                  q.eq("workosUserId", identity.subject as string),
                )
                .unique();
              if (user?._id) validatedUserId = user._id;
            }

            // Only enforce if we have a validated user id
            if (validatedUserId) {
              await RateLimiter.enforceRateLimit(
                ctx,
                validatedUserId,
                propertyKey,
                config,
              );
            } else {
              // No valid user id; skip rate limiting to avoid unsafe casts
              if (process.env.NODE_ENV !== "production") {
                console.warn(
                  "[RateLimiter] Skipping rate limit; invalid identity.userId/subject",
                );
              }
            }
          }
        } catch (error) {
          // If rate limiting fails, log but don't block the operation
          console.warn("Rate limiting failed:", error);
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Binds a config into a reusable enforce function.
 *
 * Returns `async (ctx, userId, action) => RateLimitResult` that delegates
 * to `RateLimiter.enforceRateLimit` — it records a hit and throws a 429
 * `ConvexError` once the window is exhausted. Call it at the top of a
 * mutation body with an already-authenticated user id.
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  return async (ctx: MutationCtx, userId: Id<"users">, action: string) => {
    return await RateLimiter.enforceRateLimit(ctx, userId, action, config);
  };
}

/**
 * Read-only "burst" checker over the shared `rateLimits` table.
 *
 * Despite the token-bucket vocabulary, it never consumes tokens: it takes a
 * `QueryCtx` (so no writes are possible) and only compares whatever count
 * is already stored under the `burst_${action}` key against
 * `config.burstSize`. Counts stay at zero unless some other component
 * writes that key, and `bucketSize`/`refillRate` are accepted but never
 * used.
 */
export class BurstRateLimiter {
  /**
   * Reports whether the stored count for `burst_${action}` is below
   * `config.burstSize`, without modifying anything.
   *
   * Returns `allowed: false` only when a row already exists at or above
   * `burstSize`; `tokensRemaining` is `burstSize - storedCount` and can
   * overstate availability (or go negative) because nothing here
   * decrements it.
   */
  static async checkBurstLimit(
    ctx: QueryCtx,
    userId: Id<"users">,
    action: string,
    config: {
      bucketSize: number;
      refillRate: number; // tokens per second
      burstSize: number;
    },
  ): Promise<{ allowed: boolean; tokensRemaining: number }> {
    const key = `burst_${action}`;
    const existingLimit = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action_window", (q) =>
        q.eq("userId", userId).eq("action", key),
      )
      .first();

    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[BurstRateLimiter] check",
        JSON.stringify({
          key,
          exists: !!existingLimit,
          count: existingLimit?.count ?? 0,
        }),
      );
    }

    // Simplified burst logic - would need more sophisticated implementation
    const allowed = !existingLimit || existingLimit.count < config.burstSize;
    const tokensRemaining = config.burstSize - (existingLimit?.count || 0);

    return { allowed, tokensRemaining };
  }
}

/**
 * Placeholder "distributed" limiter: despite the name, it delegates to the
 * same single-table fixed-window counter as `RateLimiter` (Convex
 * transactions already serialize writes, so no extra coordination exists
 * or is needed).
 *
 * Do not call: `checkDistributedLimit` casts an arbitrary string key to
 * `Id<"users">`, which would violate the `rateLimits.userId` field
 * validator (`v.id("users")`) at runtime on insert.
 */
export class DistributedRateLimiter {
  /**
   * Unimplemented shim that forwards to `RateLimiter.checkRateLimit` with
   * the `key` string cast to `Id<"users">` and the action hardcoded to
   * "distributed". The cast is unsafe (any non-Id key violates the
   * `userId` validator) and the method adds nothing over
   * `checkRateLimit`.
   */
  static async checkDistributedLimit(
    ctx: MutationCtx,
    key: string,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    // This would implement distributed rate limiting
    // using the database as a coordination layer
    // For now, falls back to regular rate limiting
    const userId = key as Id<"users">; // Simplified placeholder
    return await RateLimiter.checkRateLimit(ctx, userId, "distributed", config);
  }
}