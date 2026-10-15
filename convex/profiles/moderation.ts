/**
 * Block and report (cv6-profile-availability).
 *
 * A blocked person must never see the blocker again. Wherever later code
 * pairs or lists people it calls isBlockedEither first — the helper the
 * matcher (cv6-matcher) is required to use. Blocks and reports are write-
 * only for clients: no query lists another person's blocks or reports.
 */

import { internalQuery, mutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import type { Id } from "@convex/_generated/dataModel";

/**
 * Blocks another person. Idempotent: blocking twice stores one row.
 */
export const blockUser = mutation({
  args: { blockedId: v.id("users") },
  returns: v.id("blocks"),
  handler: async (ctx, { blockedId }): Promise<Id<"blocks">> => {
    const identity = await requireIdentity(ctx);

    if (blockedId === identity.userId) {
      throw createError.validation("You cannot block yourself");
    }
    const blocked = await ctx.db.get(blockedId);
    if (!blocked) {
      throw createError.notFound("User", blockedId);
    }

    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", identity.userId).eq("blockedId", blockedId),
      )
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("blocks", {
      blockerId: identity.userId,
      blockedId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Reports another person, optionally tying the report to a meeting. A
 * meetingId is only accepted from someone who took part in that meeting,
 * so reports cannot be attached to meetings the reporter was never in.
 */
export const reportUser = mutation({
  args: {
    reportedId: v.id("users"),
    meetingId: v.optional(v.id("meetings")),
    reason: v.string(),
  },
  returns: v.id("reports"),
  handler: async (ctx, args): Promise<Id<"reports">> => {
    const identity = await requireIdentity(ctx);

    const reason = args.reason.trim();
    if (reason.length === 0) {
      throw createError.validation("A report needs a reason");
    }
    if (reason.length > 500) {
      throw createError.validation("Keep the reason under 500 characters");
    }
    if (args.reportedId === identity.userId) {
      throw createError.validation("You cannot report yourself");
    }
    const reported = await ctx.db.get(args.reportedId);
    if (!reported) {
      throw createError.notFound("User", args.reportedId);
    }
    if (args.meetingId !== undefined) {
      const meetingId = args.meetingId;
      const participant = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_user", (q) =>
          q.eq("meetingId", meetingId).eq("userId", identity.userId),
        )
        .unique();
      if (!participant) {
        throw createError.forbidden(
          "You can only report conversations you took part in",
        );
      }
    }

    return await ctx.db.insert("reports", {
      reporterId: identity.userId,
      reportedId: args.reportedId,
      meetingId: args.meetingId,
      reason,
      createdAt: Date.now(),
    });
  },
});

/**
 * True when either person has blocked the other. The matcher calls this
 * before proposing a pair and before listing anyone a person can see.
 */
export const isBlockedEither = internalQuery({
  args: { a: v.id("users"), b: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { a, b }): Promise<boolean> => {
    const aBlocksB = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", a).eq("blockedId", b),
      )
      .unique();
    if (aBlocksB) return true;
    const bBlocksA = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", b).eq("blockedId", a),
      )
      .unique();
    return bBlocksA !== null;
  },
});
