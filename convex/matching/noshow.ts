/**
 * The no-show path for scheduled match meetings (docs/plan/MATCHING-PLAN.md,
 * step 6).
 *
 * If the other person hasn't joined 10 minutes after the start, the person in
 * the call can end it with "They didn't show". The report is recorded here,
 * the absent person gets one strike (two in 30 days pause their matching,
 * convex/matching/strikes.ts), the reporter gets waiting-bonus priority in
 * the next matcher run (convex/matching/run.ts), and the meeting concludes.
 *
 * Everything is server-side and scoped to the meeting: only one of its two
 * participants can report, and only after the 10-minute mark.
 */

import { mutation, query } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import {
  activeStrikes,
  STRIKES_PAUSE_THRESHOLD,
} from "@convex/matching/strikes";

/** A no-show can only be reported this long after the start. */
export const NO_SHOW_GRACE_MS = 10 * 60_000;

/**
 * What the call screen may offer right now, without throwing: the caller is
 * one of the meeting's two participants, the meeting is live-or-scheduled,
 * the 10-minute mark has passed, the other person has not joined, and nobody
 * has reported yet. `canReport.ok` is what turns the "They didn't show"
 * button on; every refusal is a plain reason.
 */
export const canReport = query({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(
      v.union(
        v.literal("not_found"),
        v.literal("not_participant"),
        v.literal("ended"),
        v.literal("too_early"),
        v.literal("partner_joined"),
        v.literal("already_reported"),
      ),
    ),
    /** When reporting becomes possible (start + 10 minutes). */
    dueAt: v.optional(v.number()),
  }),
  handler: async (ctx, { meetingId }) => {
    const identity = await requireIdentity(ctx);
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) return { ok: false, reason: "not_found" as const };
    const mine = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();
    if (!mine) return { ok: false, reason: "not_participant" as const };
    if (meeting.state !== "scheduled" && meeting.state !== "active") {
      return { ok: false, reason: "ended" as const };
    }
    const start = meeting.scheduledAt;
    if (!start) return { ok: false, reason: "ended" as const };
    const dueAt = start + NO_SHOW_GRACE_MS;
    if (Date.now() < dueAt) return { ok: false, reason: "too_early" as const, dueAt };
    const everyone = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const others = everyone.filter((row) => row.userId !== identity.userId);
    if (others.length === 0 || others.every((row) => row.presence === "joined")) {
      return { ok: false, reason: "partner_joined" as const };
    }
    const reports = await ctx.db
      .query("noShowReports")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    if (reports.length > 0) return { ok: false, reason: "already_reported" as const };
    return { ok: true };
  },
});

/**
 * End the meeting with "They didn't show": records the report, gives the
 * absent person one strike, concludes the meeting. Refuses anyone outside
 * the meeting, anything before the 10-minute mark, a second report, and a
 * report when the other person did join.
 */
export const reportNoShow = mutation({
  args: {
    meetingId: v.id("meetings"),
    // What the reporter saw; optional so a thin client can omit it.
    reason: v.optional(
      v.union(
        v.literal("never_joined"),
        v.literal("joined_late"),
        v.literal("left_early"),
      ),
    ),
  },
  returns: v.object({
    absentUserId: v.id("users"),
    /** The absent person's active strikes after this report. */
    strikeCount: v.number(),
    /** True when this report is the strike that pauses their matching. */
    paused: v.boolean(),
  }),
  handler: async (ctx, { meetingId, reason }) => {
    const identity = await requireIdentity(ctx);
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) throw createError.notFound("Meeting", meetingId);

    const mine = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();
    if (!mine) {
      throw createError.forbidden(
        "Only the two people in the meeting can report a no-show",
      );
    }

    // One report per meeting. Checked before the meeting state: the report
    // itself concludes the meeting, so a duplicate is better told "already
    // reported" than "already ended".
    const existing = await ctx.db
      .query("noShowReports")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    if (existing.length > 0) {
      throw createError.validation("This meeting was already reported");
    }

    if (meeting.state !== "scheduled" && meeting.state !== "active") {
      throw createError.validation("This meeting has already ended");
    }
    const start = meeting.scheduledAt;
    if (!start) throw createError.validation("This meeting has no scheduled time");
    const now = Date.now();
    if (now < start + NO_SHOW_GRACE_MS) {
      throw createError.validation(
        "A no-show can be reported 10 minutes after the start",
      );
    }

    const everyone = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const absent = everyone.filter(
      (row) => row.userId !== identity.userId && row.presence !== "joined",
    );
    if (absent.length === 0) {
      throw createError.validation(
        "Everyone else already joined, so there is no no-show to report",
      );
    }

    // One report per meeting; the absent person is the other participant.
    const absentUserId = absent[0]!.userId;
    await ctx.db.insert("noShowReports", {
      meetingId,
      reporterId: identity.userId,
      absentUserId,
      reason,
      createdAt: now,
    });

    // One strike per report. The count drives the matcher pause.
    await ctx.db.insert("matchingStrikes", {
      userId: absentUserId,
      meetingId,
      createdAt: now,
    });
    const theirStrikes = await ctx.db
      .query("matchingStrikes")
      .withIndex("by_user", (q) => q.eq("userId", absentUserId))
      .collect();
    const strikeCount = activeStrikes(theirStrikes, now).length;

    // The meeting is over: the person who showed sees the recap flow.
    await ctx.db.patch(meetingId, {
      state: "concluded",
      updatedAt: now,
    });

    return {
      absentUserId,
      strikeCount,
      paused: strikeCount >= STRIKES_PAUSE_THRESHOLD,
    };
  },
});
