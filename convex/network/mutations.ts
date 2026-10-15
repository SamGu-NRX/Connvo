/**
 * After-the-call "Connect" mutation (docs/plan/MATCHING-PLAN.md, "After the
 * call, two taps").
 *
 * connectWith records the caller's tap for a meeting. A connection row is
 * created only when both people have tapped for the same meeting — the same
 * mutuality rule as stay-in-touch. Until then nobody's tap is ever revealed
 * to anyone else, so the caller learns nothing about the other person's
 * choice by calling again.
 *
 * Both mutations authenticate via requireIdentity and scope access through
 * assertMeetingAccess, so someone who did not take part in the meeting can
 * neither give feedback nor connect — and a nonexistent meeting is refused
 * with the identical error (no existence leak).
 */

import { mutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { Id } from "@convex/_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";

/** Reads per meeting are bounded: a call holds at most a handful of people. */
const MAX_PARTICIPANTS = 50;
/** Reason chips are optional and bounded: enough to answer, not to spam. */
const MAX_REASONS = 8;
const MAX_REASON_LENGTH = 120;

/** Id-string comparator; the deterministic pair order for connections. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderedPair(
  a: Id<"users">,
  b: Id<"users">,
): [Id<"users">, Id<"users">] {
  return compareIds(a, b) <= 0 ? [a, b] : [b, a];
}

/**
 * The "Would you talk again?" answer for one meeting: yes or no, with
 * optional reason chips when it is no. One row per (meeting, user): Convex
 * serializes mutations, so the check-then-write below cannot race — two
 * quick submits land on the same row, and a repeat submit with the same
 * answer leaves identical state.
 */
export const recordTalkAgainFeedback = mutation({
  args: {
    meetingId: v.id("meetings"),
    talkAgain: v.boolean(),
    reasons: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { meetingId, talkAgain, reasons }) => {
    const identity = await requireIdentity(ctx);
    await assertMeetingAccess(ctx, meetingId);

    const cleanedReasons = talkAgain
      ? []
      : (reasons ?? [])
          .map((reason) => reason.slice(0, MAX_REASON_LENGTH).trim())
          .filter((reason) => reason.length > 0)
          .slice(0, MAX_REASONS);

    const existing = await ctx.db
      .query("meetingFeedback")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        talkAgain,
        reasons: cleanedReasons,
      });
    } else {
      await ctx.db.insert("meetingFeedback", {
        meetingId,
        userId: identity.userId,
        talkAgain,
        reasons: cleanedReasons,
        createdAt: Date.now(),
      });
    }

    return { talkAgain, reasons: cleanedReasons };
  },
});

/**
 * The "Connect" tap for one meeting. Idempotent: tapping again returns the
 * same state. When the other person has tapped too, the connection row for
 * the pair is created here, so both people appear in each other's network.
 */
export const connectWith = mutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const identity = await requireIdentity(ctx);
    await assertMeetingAccess(ctx, meetingId);

    const mine = await ctx.db
      .query("connectIntents")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();
    if (!mine) {
      await ctx.db.insert("connectIntents", {
        meetingId,
        userId: identity.userId,
        createdAt: Date.now(),
      });
    }

    // Everyone else from this meeting who already tapped: with my tap now
    // recorded, each of them is connected to me. New taps from the other
    // side do the same from their caller, so one row per pair is created
    // no matter who taps second.
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .take(MAX_PARTICIPANTS);

    const connectedWith: Id<"users">[] = [];
    for (const participant of participants) {
      if (participant.userId === identity.userId) continue;
      const theirs = await ctx.db
        .query("connectIntents")
        .withIndex("by_meeting_and_user", (q) =>
          q.eq("meetingId", meetingId).eq("userId", participant.userId),
        )
        .unique();
      if (!theirs) continue;

      const [userLow, userHigh] = orderedPair(
        identity.userId,
        participant.userId,
      );
      const existing = await ctx.db
        .query("connections")
        .withIndex("by_pair", (q) =>
          q.eq("userLow", userLow).eq("userHigh", userHigh),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("connections", {
          userLow,
          userHigh,
          createdAt: Date.now(),
        });
      }
      connectedWith.push(participant.userId);
    }

    return { connectedWith };
  },
});
