/**
 * Rate Limiting Utilities
 *
 * This module provides rate limiting functionality for Convex functions
 * using a fixed-window counter stored in the "rateLimits" table
 * (defined in convex/schema/system.ts, indexed by "by_user_action_window"
 * on [userId, action, windowStartMs]).
 *
 * Note: windows are FIXED (floor(now / windowMs) * windowMs), not
 * sliding - a client can burst up to ~2x maxRequests across a window
 * boundary.
 *
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { Id } from "@convex/_generated/dataModel";
import { createError } from "@convex/lib/errors";

/**
 * Describes one fixed-window rate limit policy: at most `maxRequests`
 * calls per `windowMs` window.
 *
 * `windowMs` is the window length in milliseconds; a window is identified
 * by its start epoch ms (floor(now / windowMs) * windowMs). `maxRequests`
 * is the number of calls admitted per window before further calls are
 * rejected until the next window opens. `keyPrefix` is accepted for API
 * compatibility with convex/lib/rateLimit.ts but is never read by any
 * function in this module - counters are keyed by
 * (userId, action, windowStartMs) alone.
 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

/**
 * Provides the fallback policy per well-known action name when a caller
 * supplies no explicit `config`.
 *
 * `enforceUserLimit` and `checkUserLimit` look up `DEFAULT_RATE_LIMITS[action]`
 * and throw a plain `Error` when the action is unknown and no explicit
 * config was given, so new action names must be added here before use.
 * These values are independent of the per-environment limits in
 * convex/environments/*.ts (surfaced through convex/lib/config.ts
 * `appConfig.rateLimits` / `getRateLimit`), which this module never reads.
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  transcriptIngestion: {
    windowMs: 60000, // 1 minute
    maxRequests: 50, // 50 requests per minute
    keyPrefix: "transcript_",
  },
  noteOperations: {
    windowMs: 60000, // 1 minute
    maxRequests: 200, // 200 operations per minute
    keyPrefix: "note_ops_",
  },
  promptGeneration: {
    windowMs: 300000, // 5 minutes
    maxRequests: 10, // 10 generations per 5 minutes
    keyPrefix: "prompt_gen_",
  },
  matchingQueue: {
    windowMs: 60000, // 1 minute
    maxRequests: 5, // 5 queue entries per minute
    keyPrefix: "matching_",
  },
  apiCalls: {
    windowMs: 60000, // 1 minute
    maxRequests: 60, // 60 calls per minute
    keyPrefix: "api_",
  },
};

/**
 * Reports the outcome of one rate limit check against a fixed window.
 *
 * `allowed` is whether the call was (or would be) admitted; `remaining`
 * is quota left AFTER a counted call (read-only checks report the quota
 * without consuming); `resetTime` is the epoch ms at which the current
 * window closes and quota refills; `windowStart` is the epoch ms the
 * current window began. All times are wall-clock ms from Date.now().
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  windowStart: number;
}

/**
 * Counts the current call by a user against the limit for an action and
 * throws a ConvexError when the limit is exhausted and `options.throws`
 * is set.
 *
 * Resolves the policy from `options.config`, falling back to
 * `DEFAULT_RATE_LIMITS[action]`; throws a plain `Error` when neither
 * exists. Reads the user's counter row for the current fixed window from
 * the "rateLimits" table and, when under the limit, increments it (a
 * ctx.db.patch of the existing row or a ctx.db.insert for a new window),
 * so calling this function CONSUMES quota as a side effect. When the
 * limit is already exhausted the counter is left untouched and:
 * - with `options.throws: true`, throws the ConvexError built by
 *   createError.rateLimitExceeded, whose data is enriched with
 *   `retryAfterSeconds`, `resetTime`, `windowStart`, `limit`, and
 *   `action` so clients learn when to retry; or
 * - by default (`throws` unset/false), returns the result with
 *   `allowed: false` and does not throw.
 *
 * Returns the RateLimitResult for the current window on every
 * non-throwing path. Requires a MutationCtx because it writes the
 * counter row.
 */
export async function enforceUserLimit(
  ctx: MutationCtx,
  action: string,
  userId: Id<"users">,
  options: {
    config?: RateLimitConfig;
    throws?: boolean;
  } = {},
): Promise<RateLimitResult> {
  const config = options.config || DEFAULT_RATE_LIMITS[action];
  if (!config) {
    throw new Error(`No rate limit configuration found for action: ${action}`);
  }

  const result = await checkRateLimit(ctx, action, userId, config);

  if (!result.allowed && options.throws) {
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((result.resetTime - Date.now()) / 1000),
    );
    const error = createError.rateLimitExceeded(action, config.maxRequests);
    const payload = error.data as {
      message: string;
      metadata?: Record<string, unknown>;
    };
    payload.message = `Rate limit exceeded for ${action}. Try again in ${retryAfterSeconds} seconds.`;
    payload.metadata = {
      ...(payload.metadata ?? {}),
      retryAfterSeconds,
      resetTime: result.resetTime,
      windowStart: result.windowStart,
      limit: config.maxRequests,
      action,
    };
    throw error;
  }

  return result;
}

/**
 * Reports how much quota a user has left for an action WITHOUT consuming
 * any, which makes it safe to call from read-only queries.
 *
 * Resolves the policy from the explicit `config` argument, falling back
 * to `DEFAULT_RATE_LIMITS[action]`; throws a plain `Error` when neither
 * exists. Reads (never writes) the user's counter row for the current
 * fixed window through the "by_user_action_window" index and computes
 * the result from the stored count. Because it never increments,
 * repeated calls within one window return the same answer.
 * Returns the RateLimitResult for the current window.
 */
export async function checkUserLimit(
  ctx: QueryCtx,
  action: string,
  userId: Id<"users">,
  config?: RateLimitConfig,
): Promise<RateLimitResult> {
  const limitConfig = config || DEFAULT_RATE_LIMITS[action];
  if (!limitConfig) {
    throw new Error(`No rate limit configuration found for action: ${action}`);
  }

  const now = Date.now();
  const windowStart =
    Math.floor(now / limitConfig.windowMs) * limitConfig.windowMs;

  // Get current rate limit record
  const rateLimitRecord = await ctx.db
    .query("rateLimits")
    .withIndex("by_user_action_window", (q) =>
      q
        .eq("userId", userId)
        .eq("action", action)
        .eq("windowStartMs", windowStart),
    )
    .unique();

  const currentCount = rateLimitRecord?.count || 0;
  const remaining = Math.max(0, limitConfig.maxRequests - currentCount);
  const allowed = currentCount < limitConfig.maxRequests;
  const resetTime = windowStart + limitConfig.windowMs;

  return {
    allowed,
    remaining,
    resetTime,
    windowStart,
  };
}

/**
 * Reads the user's counter for the current fixed window and increments
 * it by one, creating the row on the first hit of a window.
 *
 * Looks up the "rateLimits" row matching (userId, action, windowStartMs)
 * via the "by_user_action_window" index. When the row exists and is
 * already at `config.maxRequests`, returns `allowed: false` WITHOUT
 * incrementing (the counter stays at maxRequests until the window
 * rolls over). Otherwise persists count + 1 (ctx.db.patch or
 * ctx.db.insert) and returns `allowed: true` with the post-increment
 * remaining quota. Convex serializes mutations, so this
 * read-increment-write sequence is safe from lost updates between
 * concurrent callers. Not exported - use enforceUserLimit, which adds
 * policy resolution and optional throwing on top of this.
 */
async function checkRateLimit(
  ctx: MutationCtx,
  action: string,
  userId: Id<"users">,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / config.windowMs) * config.windowMs;

  // Get or create rate limit record
  let rateLimitRecord = await ctx.db
    .query("rateLimits")
    .withIndex("by_user_action_window", (q) =>
      q
        .eq("userId", userId)
        .eq("action", action)
        .eq("windowStartMs", windowStart),
    )
    .unique();

  let currentCount = 0;

  if (rateLimitRecord) {
    currentCount = rateLimitRecord.count;

    // Check if limit is exceeded
    if (currentCount >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: windowStart + config.windowMs,
        windowStart,
      };
    }

    // Increment counter
    await ctx.db.patch(rateLimitRecord._id, {
      count: currentCount + 1,
      updatedAt: now,
    });
    currentCount += 1;
  } else {
    // Create new rate limit record
    await ctx.db.insert("rateLimits", {
      userId,
      action,
      windowStartMs: windowStart,
      count: 1,
      createdAt: now,
      updatedAt: now,
    });
    currentCount = 1;
  }

  const remaining = Math.max(0, config.maxRequests - currentCount);
  const resetTime = windowStart + config.windowMs;

  return {
    allowed: true,
    remaining,
    resetTime,
    windowStart,
  };
}

/**
 * Deletes every "rateLimits" row whose `updatedAt` is older than
 * `olderThanMs` and returns how many rows it removed.
 *
 * Finds candidates with a ctx.db.filter comparison against
 * Date.now() - `olderThanMs`, which is a full-table scan (the table has
 * no index on `updatedAt`), then deletes rows one at a time via
 * ctx.db.delete. Nothing in convex/crons.ts invokes this function, so
 * callers must run it from their own mutation (or add a cron) or the
 * table grows without bound as windows roll over.
 */
export async function cleanupOldRateLimits(
  ctx: MutationCtx,
  olderThanMs: number = 24 * 60 * 60 * 1000, // 24 hours
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;

  const oldRecords = await ctx.db
    .query("rateLimits")
    .filter((q) => q.lt(q.field("updatedAt"), cutoff))
    .collect();

  for (const record of oldRecords) {
    await ctx.db.delete(record._id);
  }

  return oldRecords.length;
}

/**
 * Collects read-only quota status for a user across several actions,
 * keyed by action name.
 *
 * Checks each action in `actions` (defaults to every key of
 * DEFAULT_RATE_LIMITS) via checkUserLimit, which consumes no quota.
 * Unknown action names that have no default config do NOT fail the
 * call: the per-action error is logged with console.warn and replaced
 * by a fabricated `allowed: true, remaining: 100` result, so a lookup
 * failure is indistinguishable from a healthy window in the returned
 * map - do not use it where the real state must be known.
 */
export async function getRateLimitStatus(
  ctx: QueryCtx,
  userId: Id<"users">,
  actions?: string[],
): Promise<Record<string, RateLimitResult>> {
  const actionsToCheck = actions || Object.keys(DEFAULT_RATE_LIMITS);
  const status: Record<string, RateLimitResult> = {};

  for (const action of actionsToCheck) {
    try {
      status[action] = await checkUserLimit(ctx, action, userId);
    } catch (error) {
      console.warn(`Failed to check rate limit for ${action}:`, error);
      // Provide a default "allowed" status if check fails
      status[action] = {
        allowed: true,
        remaining: 100,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
      };
    }
  }

  return status;
}

/**
 * Wraps a class method as a pass-through decorator placeholder that
 * does NOT enforce any rate limit.
 *
 * Returns the descriptor with the method replaced by an async function
 * that simply calls the original - `action` and `config` are accepted
 * but unused, and no counter is read or written. Two behavioral notes
 * for callers: the decorated method always returns a Promise (even if
 * the original was synchronous), and `this` binding is preserved.
 * Nothing in the repo applies this decorator; it exists as a
 * scaffolding point for a future implementation.
 */
export function withRateLimit(action: string, config?: RateLimitConfig) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<T>,
  ) {
    const method = descriptor.value!;

    descriptor.value = async function (this: any, ...args: any[]) {
      // This would need to be implemented based on the specific function context
      // For now, this is a placeholder for the decorator pattern
      return method.apply(this, args);
    } as T;

    return descriptor;
  };
}

/**
 * Implements an in-memory token bucket for smoothing traffic spikes:
 * a call is admitted only when enough tokens have refilled.
 *
 * Starts full at `capacity` tokens and refills continuously at
 * `refillRate` tokens per second, capped at `capacity`. All state
 * (tokens, lastRefill) lives on the instance, so in Convex every
 * function invocation starts with a FRESH bucket - this limiter only
 * throttles calls sharing one instance inside a single isolate and
 * cannot enforce limits across requests or users.
 * Instance methods: `consume` spends tokens and reports admission;
 * `getTokens` reports the refilled balance without spending.
 */
export class BurstRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Refills the bucket from elapsed time, then spends `tokens` if the
   * balance allows, returning true when admission is granted.
   *
   * When the balance is insufficient nothing is spent and false is
   * returned - there is no partial consumption or queueing.
   */
  consume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Returns the current token balance after applying elapsed-time
   * refill, without consuming any tokens.
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Adds `refillRate * elapsedSeconds` tokens (capped at capacity)
   * based on the time since the last refill, then stamps lastRefill
   * with Date.now().
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Counts one call against a per-IP limit by mapping the IP address to a
 * synthetic rate-limit key, for callers that already trust the IP claim.
 *
 * Replaces dots with underscores and prefixes with "ip_" (so "192.0.2.1"
 * becomes "ip_192_0_2_1"), casts that string to an Id<"users">, and
 * delegates to enforceUserLimit with `config` (falling back to
 * DEFAULT_RATE_LIMITS[action] when omitted). Consumes quota as a side
 * effect and returns the RateLimitResult; like enforceUserLimit's
 * default, it does NOT throw when the limit is exceeded. Caveats: rows
 * accumulate under non-existent user ids, only dots are replaced (each
 * IPv6 textual form gets its own counter), and the cast bypasses
 * compile-time checking - whether Convex accepts such ids as
 * v.id("users") on write has not been verified against a deployment.
 */
export async function enforceIPLimit(
  ctx: MutationCtx,
  ipAddress: string,
  action: string,
  config?: RateLimitConfig,
): Promise<RateLimitResult> {
  // Create a synthetic user ID based on IP address for rate limiting
  const ipUserId = `ip_${ipAddress.replace(/\./g, "_")}` as Id<"users">;

  return enforceUserLimit(ctx, action, ipUserId, { config });
}

/**
 * Counts one call against a deployment-wide limit by routing every
 * caller to the shared synthetic user id "global".
 *
 * Delegates to enforceUserLimit with the REQUIRED `config`, so all
 * callers of one action share a single counter row per window in the
 * "rateLimits" table. Because every invocation competes for the same
 * quota, this suits protecting a downstream service rather than
 * per-user fairness. Consumes quota as a side effect and returns the
 * RateLimitResult; like enforceUserLimit's default, it does NOT throw
 * when the limit is exceeded. Caveat: "global" is not a real users row
 * (same v.id("users") write-validation question as enforceIPLimit).
 */
export async function enforceGlobalLimit(
  ctx: MutationCtx,
  action: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const globalUserId = "global" as Id<"users">;

  return enforceUserLimit(ctx, action, globalUserId, { config });
}
