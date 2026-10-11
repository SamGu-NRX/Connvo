/**
 * After-call history queries
 *
 * Participant-scoped meeting history: a paginated list of the caller's own
 * meetings, the full history payload for a single meeting, and stay-in-touch
 * status. Every query authenticates via requireIdentity and scopes access
 * through assertMeetingAccess, so meeting existence is never revealed to
 * non-participants.
 */

import { query } from "@convex/_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Doc, Id } from "@convex/_generated/dataModel";
import { internal } from "@convex/_generated/api";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { isAfterCallEnabledServer } from "./flag";

/**
 * Id-string comparator used as a deterministic tiebreak everywhere ordering
 * must be stable across identical inputs.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Lists the caller's meetings newest-first by MEETING time.
 *
 * Meetings are discovered ONLY from the caller's own meetingParticipants
 * rows (by_user index), joined to their meetings and the meeting state.
 * "Newest" is the meeting's own time — scheduledAt descending, with
 * unscheduled meetings last, createdAt descending and then _id ascending
 * as stable tiebreaks — NOT the participant row's creation order, so a
 * late join to an old meeting still sorts by when that meeting happens.
 * The caller's participation list is bounded; it is sorted in memory and
 * sliced into Convex-compatible pages (an exactly-full page reports
 * isDone=false; the next short or empty page reports completion).
 */
export const listMyMeetings = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    // Server-side feature gate: checked before anything else (including
    // identity) so the API surface disappears when the flag is off.
    if (!isAfterCallEnabledServer()) {
      throw createError.forbidden("Access denied: After-call history is disabled");
    }
    const identity = await requireIdentity(ctx);

    const participationRows = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .collect();

    type MyMeetingItem = {
      meeting: {
        _id: Id<"meetings">;
        title: string;
        state: "scheduled" | "active" | "concluded" | "cancelled";
        scheduledAt: number | null;
        duration: number | null;
        createdAt: number;
      };
      role: "host" | "participant" | "observer";
      startedAt: number | null;
      endedAt: number | null;
    };

    const items: MyMeetingItem[] = [];
    for (const participation of participationRows) {
      const meeting = await ctx.db.get(participation.meetingId);
      if (!meeting) continue;
      const state = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();
      items.push({
        meeting: {
          _id: meeting._id,
          title: meeting.title,
          state: meeting.state,
          scheduledAt: meeting.scheduledAt ?? null,
          duration: meeting.duration ?? null,
          createdAt: meeting.createdAt,
        },
        role: participation.role,
        startedAt: state?.startedAt ?? null,
        endedAt: state?.endedAt ?? null,
      });
    }

    // Newest-first by the meeting's own time (not participant-row
    // creation): scheduledAt descending, unscheduled meetings last, then
    // createdAt descending and _id ascending as deterministic tiebreaks.
    items.sort((a, b) => {
      const at = a.meeting.scheduledAt;
      const bt = b.meeting.scheduledAt;
      if (at !== null && bt !== null && at !== bt) return bt - at;
      if ((at === null) !== (bt === null)) return at === null ? 1 : -1;
      if (a.meeting.createdAt !== b.meeting.createdAt) {
        return b.meeting.createdAt - a.meeting.createdAt;
      }
      return compareIds(a.meeting._id, b.meeting._id);
    });

    // Manual pagination over the sorted list, matching Convex page
    // semantics: an exactly-full page cannot know it is the last, so
    // isDone stays false and the next short or empty page completes.
    const start = args.paginationOpts.cursor
      ? Math.max(0, Math.floor(Number(args.paginationOpts.cursor)) || 0)
      : 0;
    const page = items.slice(start, start + args.paginationOpts.numItems);
    return {
      page,
      isDone: page.length < args.paginationOpts.numItems,
      continueCursor: String(start + page.length),
    };
  },
});

/**
 * Full after-call history for one meeting. The caller must be a
 * participant; a nonexistent meeting and a non-participant caller produce
 * the identical forbidden error so the API never leaks meeting existence.
 */
export const getMeetingHistory = query({
  args: { meetingId: v.id("meetings") },
  handler: async (
    ctx,
    { meetingId },
  ): Promise<{
    meeting: Doc<"meetings">;
    myRole: Doc<"meetingParticipants">["role"];
    participants: Array<{
      userId: Id<"users">;
      displayName: string | null;
      role: Doc<"meetingParticipants">["role"];
      presence: Doc<"meetingParticipants">["presence"];
      joinedAt: number | null;
      leftAt: number | null;
    }>;
    state: Doc<"meetingState"> | null;
    lifecycleEvents: Doc<"meetingEvents">[];
    notes: Doc<"meetingNotes"> | null;
    prompts: Doc<"prompts">[];
  }> => {
    // Server-side feature gate: checked before anything else (including
    // identity) so the API surface disappears when the flag is off.
    if (!isAfterCallEnabledServer()) {
      throw createError.forbidden("Access denied: After-call history is disabled");
    }
    const identity = await requireIdentity(ctx);

    // Throws the same createError.forbidden("Access denied: Not a meeting
    // participant") when the meeting does not exist (no participant rows)
    // and when the caller is not a participant.
    const myParticipation = await assertMeetingAccess(ctx, meetingId);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      // Participant row exists but the meeting row is gone: identical error.
      throw createError.forbidden("Access denied: Not a meeting participant", {
        meetingId,
        userId: identity.userId,
      });
    }

    const participantRows = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    const participants = await Promise.all(
      participantRows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        let displayName = user?.displayName;
        if (!displayName) {
          // Fall back to the profile displayName only when the users row
          // lacks one.
          const profile = await ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", row.userId))
            .unique();
          displayName = profile?.displayName;
        }
        return {
          userId: row.userId,
          displayName: displayName ?? null,
          role: row.role,
          presence: row.presence,
          joinedAt: row.joinedAt ?? null,
          leftAt: row.leftAt ?? null,
        };
      }),
    );

    const stateRow = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    const eventRows = await ctx.db
      .query("meetingEvents")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    eventRows.sort(
      (a, b) => a.timestamp - b.timestamp || compareIds(a._id, b._id),
    );
    // Cap at the 200 most recent events, kept in chronological order.
    const lifecycleEvents = eventRows.slice(-200);

    // Notes are read ONLY through the existing internal notes query.
    const notes = await ctx.runQuery(
      internal.notes.queries.getMeetingNotesInternal,
      { meetingId },
    );

    const promptRows = [
      ...(await ctx.db
        .query("prompts")
        .withIndex("by_meeting_type", (q) =>
          q.eq("meetingId", meetingId).eq("type", "precall"),
        )
        .collect()),
      ...(await ctx.db
        .query("prompts")
        .withIndex("by_meeting_type", (q) =>
          q.eq("meetingId", meetingId).eq("type", "incall"),
        )
        .collect()),
    ];
    promptRows.sort(
      (a, b) => a.createdAt - b.createdAt || compareIds(a._id, b._id),
    );

    return {
      meeting,
      myRole: myParticipation.role,
      participants,
      state: stateRow ?? null,
      lifecycleEvents,
      notes: notes ?? null,
      prompts: promptRows,
    };
  },
});

/**
 * The caller's stay-in-touch status for a meeting. Reports only the
 * caller's own opt-in and whether every participant has opted in; never
 * reveals which specific others opted in.
 */
export const getStayInTouchStatus = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    // Server-side feature gate: checked before anything else (including
    // identity) so the API surface disappears when the flag is off.
    if (!isAfterCallEnabledServer()) {
      throw createError.forbidden("Access denied: After-call history is disabled");
    }
    const identity = await requireIdentity(ctx);
    await assertMeetingAccess(ctx, meetingId);

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
