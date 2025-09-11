/**
 * Internal auth access checks for use from actions
 */

import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const verifyMeetingAccess = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    requiredRole: v.optional(v.union(v.literal("host"), v.literal("participant"))),
  },
  returns: v.boolean(),
  handler: async (ctx, { meetingId, requiredRole }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    const workosUserId = (identity as any).subject as string | undefined;
    if (!workosUserId) return false;

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!user) return false;

    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", user._id),
      )
      .unique();

    if (!participant) return false;
    if (requiredRole && participant.role !== requiredRole) return false;
    return true;
  },
});

