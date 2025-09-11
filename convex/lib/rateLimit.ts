import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { createError } from "./errors";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * Enforce a sliding-window rate limit per user and action.
 * Uses `rateLimits` table indexed by (userId, action, windowStartMs).
 */
export async function enforceRateLimit(
  ctx: MutationCtx,
  userId: Id<"users">,
  action: string,
  windowMs: number,
  maxCount: number,
): Promise<RateLimitResult> {
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
    return { allowed: true, remaining: maxCount - 1, resetAt: windowStartMs + windowMs };
  }

  const nextCount = existing.count + 1;
  await ctx.db.patch(existing._id, { count: nextCount, updatedAt: now });

  if (nextCount > maxCount) {
    throw createError.rateLimitExceeded(action, maxCount);
  }

  return { allowed: true, remaining: maxCount - nextCount, resetAt: windowStartMs + windowMs };
}

