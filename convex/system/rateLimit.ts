import { internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";

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
