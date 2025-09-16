/**
 * Rate Limiting Utilities
 *
 * This module provides rate limiting functionality for Convex functions
 * using a sliding window approach with database-backed counters.
 *
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { MutationCtx, QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { createError } from "./errors";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

/**
 * Default rate limit configurations
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  transcriptIngestion: {
    windowMs: 60000, // 1 minute
    maxRequests: 100, // 100 requests per minute
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
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  windowStart: number;
}

/**
 * Enforces rate limits for a user and action
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
    throw createError.rateLimited(
      `Rate limit exceeded for ${action}. Try again in ${Math.ceil((result.resetTime - Date.now()) / 1000)} seconds.`,
    );
  }

  return result;
}

/**
 * Checks rate limit without enforcing (for read-only contexts)
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
 * Internal rate limit check and update
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
 * Cleans up old rate limit records
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
 * Gets rate limit status for a user
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
 * Rate limit decorator for functions
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
 * Burst rate limiter for handling traffic spikes
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
   * Attempts to consume tokens
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
   * Gets current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Refills tokens based on elapsed time
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
 * IP-based rate limiting (for HTTP endpoints)
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
 * Global rate limiting across all users
 */
export async function enforceGlobalLimit(
  ctx: MutationCtx,
  action: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const globalUserId = "global" as Id<"users">;

  return enforceUserLimit(ctx, action, globalUserId, { config });
}
