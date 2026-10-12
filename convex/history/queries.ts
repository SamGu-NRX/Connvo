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
 * Candidates stream from the meetings table's by_scheduled index in
 * descending order (unscheduled meetings last) and the scan stops as soon
 * as the page is full; each candidate's participation is a single indexed
 * point check on meetingParticipants(by_meeting_and_user), so a page never
 * materializes every participation, meeting, and state row.
 *
 * Pagination uses a STABLE keyset cursor — the last emitted meeting's
 * (scheduledAt, _id) — never a mutable array offset, so a meeting inserted
 * between two pages can no longer duplicate an item or hide a newer one.
 * Equal-scheduledAt groups (and the unscheduled tail) keep the documented
 * createdAt-descending then _id-ascending tiebreak; the cursor holds the
 * last emitted meeting's key and a stale cursor falls back to its group's
 * start.
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

    type ListCursor = { t: number | null; id: string };

    const decodeCursor = (raw: string | null | undefined): ListCursor | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { t?: unknown; id?: unknown };
        if (typeof parsed.t !== "number" && parsed.t !== null) return null;
        if (typeof parsed.id !== "string") return null;
        return { t: parsed.t, id: parsed.id };
      } catch {
        // Unknown or legacy (numeric offset) cursor: restart from the top.
        return null;
      }
    };

    const cursor = decodeCursor(args.paginationOpts.cursor);
    const numItems = args.paginationOpts.numItems;

    const page: MyMeetingItem[] = [];
    let lastKey: ListCursor | null = null;

    const isParticipant = async (meetingId: Id<"meetings">) =>
      await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_user", (q) =>
          q.eq("meetingId", meetingId).eq("userId", identity.userId),
        )
        .unique();

    const buildItem = async (
      meeting: Doc<"meetings">,
      participation: Doc<"meetingParticipants">,
    ): Promise<MyMeetingItem> => {
      const state = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .unique();
      return {
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
      };
    };

    // Emits one equal-scheduledAt group (groupT === null is the unscheduled
    // tail) in the documented tiebreak order, honoring the keyset position
    // when the cursor points into this group. Returns true when the page
    // filled so the caller can stop scanning.
    const flushGroup = async (
      groupT: number | null,
      group: Doc<"meetings">[],
    ): Promise<boolean> => {
      const sorted = [...group].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
        return compareIds(a._id, b._id);
      });
      let startAt = 0;
      if (cursor && cursor.t === groupT) {
        const idx = sorted.findIndex((m) => m._id === cursor.id);
        if (idx >= 0) startAt = idx + 1;
      }
      for (const meeting of sorted.slice(startAt)) {
        const participation = await isParticipant(meeting._id);
        if (!participation) continue;
        page.push(await buildItem(meeting, participation));
        lastKey = { t: groupT, id: meeting._id };
        if (page.length >= numItems) return true;
      }
      return false;
    };

    let groupT: number | null = null;
    let group: Doc<"meetings">[] = [];
    const flushPending = async (): Promise<boolean> => {
      if (group.length === 0) return false;
      const filled = await flushGroup(groupT, group);
      group = [];
      return filled;
    };

    const scheduledQuery = ctx.db
      .query("meetings")
      .withIndex("by_scheduled", (q) =>
        cursor && cursor.t !== null ? q.lte("scheduledAt", cursor.t) : q,
      )
      .order("desc");

    for await (const meeting of scheduledQuery) {
      const meetingT = meeting.scheduledAt ?? null;
      if (meetingT !== null && meetingT !== groupT) {
        // New scheduled-time group: flush the previous one first.
        if (await flushPending()) break;
        groupT = meetingT;
        group = [meeting];
      } else if (meetingT === null) {
        // Unscheduled meetings sort after every scheduled one; the tail is
        // its own group keyed only by id.
        if (await flushPending()) break;
        groupT = null;
        group.push(meeting);
      } else {
        group.push(meeting);
      }
    }
    await flushPending();

    // Convex page semantics: an exactly-full page cannot know it is the
    // last, so isDone stays false and the next short or empty page
    // completes.
    return {
      page,
      isDone: page.length < numItems,
      continueCursor:
        lastKey === null
          ? args.paginationOpts.cursor ?? ""
          : JSON.stringify(lastKey),
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
