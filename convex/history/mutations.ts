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

/**
 * Records or clears the caller's stay-in-touch opt-in for a meeting.
 * Calling twice with the same args leaves identical state. Returns the
 * caller's enabled flag plus the mutual flag computed exactly like
 * getStayInTouchStatus: true only when every participant of the meeting
 * has a stayInTouch row.
 */
export const setStayInTouch = mutation({
  args: { meetingId: v.id("meetings"), enabled: v.boolean() },
  handler: async (ctx, { meetingId, enabled }) => {
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

    // Re-read own row (mutations see their own writes) and compute mutual
    // the same way as getStayInTouchStatus.
    const mine = await ctx.db
      .query("stayInTouch")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();

    const participantRows = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    let mutual = participantRows.length > 0;
    for (const participant of participantRows) {
      const optedIn = await ctx.db
        .query("stayInTouch")
        .withIndex("by_meeting_and_user", (q) =>
          q.eq("meetingId", meetingId).eq("userId", participant.userId),
        )
        .unique();
      if (!optedIn) {
        mutual = false;
        break;
      }
    }

    return { enabled: mine !== null, mutual };
  },
});
