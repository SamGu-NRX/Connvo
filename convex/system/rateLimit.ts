import { internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";

/**
 * @summary Enforces rate limit for user action
 * @description Enforces rate limiting for a specific user action within a rolling time window. Tracks request counts and throws an error when the limit is exceeded. Uses window-aligned timestamps for consistent rate limiting across distributed requests.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "action": "send_message",
 *     "windowMs": 60000,
 *     "maxCount": 20
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "remaining": 15,
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
 *     "message": "Rate limit exceeded for action 'send_message'. Try again in 32 seconds."
 *   }
 * }
 * ```
 */
export const enforce = internalMutation({
  args: {
    userId: v.id("users"),
    action: v.string(),
    windowMs: v.number(),
    maxCount: v.number(),
  },
  returns: v.object({ remaining: v.number(), resetAt: v.number() }),
  handler: async (ctx, { userId, action, windowMs, maxCount }) => {
    const now = Date.now();
    // Use integer division to align to window boundary
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
