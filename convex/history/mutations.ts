/**
 * After-call history mutations
 *
 * setStayInTouch records the caller's stay-in-touch opt-in for a meeting.
 * It is idempotent and never sends anything to anyone; it only records the
 * caller's own opt-in state.
 */

import { mutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { isAfterCallEnabledServer } from "./flag";
import { createError } from "@convex/lib/errors";
import { stayInTouchView } from "./queries";

/**
 * Records or clears the caller's stay-in-touch opt-in for a meeting.
 * Calling twice with the same args leaves identical state. Returns what
 * getStayInTouchStatus returns: the caller's opt-in, and the contacts of
 * the people who opted in too (pairwise: nobody else's choice shows before
 * the caller's own opt-in).
 */
export const setStayInTouch = mutation({
  args: { meetingId: v.id("meetings"), enabled: v.boolean() },
  handler: async (ctx, { meetingId, enabled }) => {
    // Server-side feature gate: checked before anything else (including
    // identity) so the API surface disappears when the flag is off.
    if (!isAfterCallEnabledServer()) {
      throw createError.forbidden("Access denied: After-call history is disabled");
    }
    const identity = await requireIdentity(ctx);
    await assertMeetingAccess(ctx, meetingId);

    const existing = await ctx.db
      .query("stayInTouch")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();

    if (enabled && !existing) {
      await ctx.db.insert("stayInTouch", {
        meetingId,
        userId: identity.userId,
        createdAt: Date.now(),
      });
    } else if (!enabled && existing) {
      await ctx.db.delete(existing._id);
    }

    return stayInTouchView(ctx, meetingId, identity.userId);
  },
});

