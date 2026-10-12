/**
 * After-call history queries
 *
 * Participant-scoped meeting history: a paginated list of the caller's own
 * meetings, the full history payload for a single meeting, and stay-in-touch
 * status. Every query authenticates via requireIdentity and scopes access
 * through assertMeetingAccess, so meeting existence is never revealed to
 * non-participants.
 */

import { query, type MutationCtx, type QueryCtx } from "@convex/_generated/server";
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
/** Reads per meeting are bounded: a call holds at most a handful of people. */
const MAX_PARTICIPANTS = 50;
const MAX_PROMPTS = 100;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Meetings read from the index per page, at most. A page can come back
 * short, or empty, with isDone false: the caller asks for the next one. This
 * keeps each call's reads bounded however few of the scanned meetings are
 * the caller's.
 */
export const HISTORY_SCAN_BUDGET = 100;

/** Where the next page starts: the last meeting READ (not emitted). */
type ListCursor = { t: number | null; c: number };

function decodeCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { t?: unknown; c?: unknown };
    if (typeof parsed.t !== "number" && parsed.t !== null) return null;
    if (typeof parsed.c !== "number") return null;
    return { t: parsed.t, c: parsed.c };
  } catch {
    return null; // an unknown cursor restarts from the top
  }
}

/**
 * Lists the caller's meetings newest-first by MEETING time: scheduledAt
 * descending, then newest-created first; meetings with no scheduled time
 * come last (Convex orders a missing field below every number).
 *
 * Reads walk the meetings by_scheduled index, whose order is exactly
 * (scheduledAt, _creationTime), backwards, with one indexed point check of
 * the caller's participation per meeting. The cursor is the full ordering
 * key of the last meeting read, and the next page seeks strictly past it in
 * the index; it never looks the cursor's meeting up, so that meeting being
 * deleted, or a newer one arriving, cannot repeat or skip anything.
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

    const cursor = decodeCursor(args.paginationOpts.cursor);
    const numItems = Math.min(Math.max(1, args.paginationOpts.numItems), 50);

    // Strictly after the cursor, in descending order: the rest of the
    // cursor's own scheduledAt group, then every earlier scheduledAt
    // (including the unscheduled ones, which sort lowest).
    const segments = cursor
      ? [
          ctx.db
            .query("meetings")
            .withIndex("by_scheduled", (q) =>
              q.eq("scheduledAt", cursor.t ?? undefined).lt("_creationTime", cursor.c),
            )
            .order("desc"),
          ...(cursor.t !== null
            ? [
                ctx.db
                  .query("meetings")
                  .withIndex("by_scheduled", (q) => q.lt("scheduledAt", cursor.t as number))
                  .order("desc"),
              ]
            : []),
        ]
      : [ctx.db.query("meetings").withIndex("by_scheduled").order("desc")];

    const page: MyMeetingItem[] = [];
    let last: ListCursor | null = null;
    let scanned = 0;
    let exhausted = true;
    scan: for (const segment of segments) {
      for await (const meeting of segment) {
        if (page.length >= numItems || scanned >= HISTORY_SCAN_BUDGET) {
          exhausted = false; // more remain; the next page resumes after `last`
          break scan;
        }
        scanned++;
        last = { t: meeting.scheduledAt ?? null, c: meeting._creationTime };
        const participation = await ctx.db
          .query("meetingParticipants")
          .withIndex("by_meeting_and_user", (q) =>
            q.eq("meetingId", meeting._id).eq("userId", identity.userId),
          )
          .unique();
        if (!participation) continue;
        const state = await ctx.db
          .query("meetingState")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
          .unique();
        page.push({
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
    }

    return {
      page,
      isDone: exhausted,
      continueCursor: last ? JSON.stringify(last) : (args.paginationOpts.cursor ?? ""),
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
      .take(MAX_PARTICIPANTS);

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

    // The 200 most recent events (newest by insertion), shown in time order.
    const eventRows = await ctx.db
      .query("meetingEvents")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .order("desc")
      .take(200);
    eventRows.sort(
      (a, b) => a.timestamp - b.timestamp || compareIds(a._id, b._id),
    );
    const lifecycleEvents = eventRows;

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
        .take(MAX_PROMPTS)),
      ...(await ctx.db
        .query("prompts")
        .withIndex("by_meeting_type", (q) =>
          q.eq("meetingId", meetingId).eq("type", "incall"),
        )
        .take(MAX_PROMPTS)),
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
 * Stay in touch is pairwise: the caller sees another participant's contact
 * only when both of them have opted in. Before that, nothing about anyone
 * else's choice is visible to the caller, and nothing of the caller's
 * reaches anyone.
 */
export async function stayInTouchView(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
  userId: Id<"users">,
): Promise<{ enabled: boolean; contacts: Array<{ name: string; email: string }> }> {
  const optedIn = async (who: Id<"users">) =>
    (await ctx.db
      .query("stayInTouch")
      .withIndex("by_meeting_and_user", (q) => q.eq("meetingId", meetingId).eq("userId", who))
      .unique()) !== null;
  const enabled = await optedIn(userId);
  if (!enabled) return { enabled, contacts: [] };
  const contacts: Array<{ name: string; email: string }> = [];
  const others = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .take(MAX_PARTICIPANTS);
  for (const other of others) {
    if (other.userId === userId || !(await optedIn(other.userId))) continue;
    const user = await ctx.db.get(other.userId);
    if (!user) continue;
    contacts.push({ name: user.displayName ?? user.email, email: user.email });
  }
  contacts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { enabled, contacts };
}

/** The caller's stay-in-touch status for a meeting (see stayInTouchView). */
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
    return stayInTouchView(ctx, meetingId, identity.userId);
  },
});
