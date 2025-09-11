import { internalMutation } from "../_generated/server";
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

