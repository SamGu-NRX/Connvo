/**
 * After-the-call network queries (docs/plan/MATCHING-PLAN.md, "After the
 * call, two taps").
 *
 * - getMeetingAfterCallState: the caller's own after-call state for one
 *   meeting — their talk-again answer and where their Connect tap stands.
 *   Only the caller's own choices and the mutual outcome are returned; the
 *   other person's individual answer or tap is never revealed.
 * - listMyConnections: the caller's network — real connections only, each
 *   with the other person's name, role, company, shared interests, and the
 *   meeting where they met, linked to its recap.
 *
 * Every query authenticates via requireIdentity; the meeting query scopes
 * access through assertMeetingAccess, so meeting existence is never revealed
 * to non-participants.
 */

import { query, type QueryCtx } from "@convex/_generated/server";
import { v } from "convex/values";
import { Id } from "@convex/_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";

/** Reads are bounded: a call holds a handful of people; a network, a page. */
const MAX_PARTICIPANTS = 50;
const MAX_CONNECTIONS = 500;
const MAX_MY_MEETINGS = 200;
const MAX_INTERESTS = 100;

/** Id-string comparator; the deterministic tiebreak for stable ordering. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderedPair(
  a: Id<"users">,
  b: Id<"users">,
): [Id<"users">, Id<"users">] {
  return a < b ? [a, b] : [b, a];
}

/**
 * The caller's own after-call state for one meeting. `connected` becomes
 * true only once both sides have tapped Connect for this meeting — before
 * that, the caller sees only their own tap, never the other person's.
 */
export const getMeetingAfterCallState = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const identity = await requireIdentity(ctx);
    await assertMeetingAccess(ctx, meetingId);

    const feedback = await ctx.db
      .query("meetingFeedback")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();

    const myIntent = await ctx.db
      .query("connectIntents")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", identity.userId),
      )
      .unique();

    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .take(MAX_PARTICIPANTS);

    let connected = false;
    for (const participant of participants) {
      if (participant.userId === identity.userId) continue;
      const [userLow, userHigh] = orderedPair(
        identity.userId,
        participant.userId,
      );
      const connection = await ctx.db
        .query("connections")
        .withIndex("by_pair", (q) =>
          q.eq("userLow", userLow).eq("userHigh", userHigh),
        )
        .unique();
      if (connection) {
        connected = true;
        break;
      }
    }

    return {
      feedback: feedback
        ? { talkAgain: feedback.talkAgain, reasons: feedback.reasons }
        : null,
      connectTapped: myIntent !== null,
      connected,
    };
  },
});

/** The interests a user has picked, as a bounded key set. */
async function interestKeysOf(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Set<string>> {
  const rows = await ctx.db
    .query("userInterests")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_INTERESTS);
  return new Set(rows.map((row) => row.interestKey));
}

/**
 * The most recent non-cancelled meeting two people share: the "when and how
 * you met" line of a connection. Walks the caller's own participant rows
 * newest-first and stops at the first shared meeting, so the usual case is
 * one or two index lookups.
 */
async function latestMeetingBetween(
  ctx: QueryCtx,
  aId: Id<"users">,
  bId: Id<"users">,
): Promise<{ meetingId: Id<"meetings">; metAt: number | null } | null> {
  const mine = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_user", (q) => q.eq("userId", aId))
    .order("desc")
    .take(MAX_MY_MEETINGS);
  for (const row of mine) {
    const shared = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", row.meetingId).eq("userId", bId),
      )
      .unique();
    if (!shared) continue;
    const meeting = await ctx.db.get(row.meetingId);
    if (!meeting || meeting.state === "cancelled") continue;
    return {
      meetingId: row.meetingId,
      metAt: meeting.scheduledAt ?? meeting.createdAt,
    };
  }
  return null;
}

/** Shared interest keys, labeled through the canonical interests table. */
async function sharedInterestLabels(
  ctx: QueryCtx,
  mine: Set<string>,
  theirs: Set<string>,
): Promise<string[]> {
  const shared = [...mine].filter((key) => theirs.has(key)).sort(compareIds);
  const labels: string[] = [];
  for (const key of shared) {
    const interest = await ctx.db
      .query("interests")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    labels.push(interest?.label ?? key);
  }
  return labels;
}

/**
 * The caller's network: every connection, newest first, each with the other
 * person's name, role, company and shared interests, and the meeting where
 * they met (linked to its recap on the page).
 */
export const listMyConnections = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    const [asLow, asHigh] = await Promise.all([
      ctx.db
        .query("connections")
        .withIndex("by_user_low", (q) => q.eq("userLow", identity.userId))
        .take(MAX_CONNECTIONS),
      ctx.db
        .query("connections")
        .withIndex("by_user_high", (q) => q.eq("userHigh", identity.userId))
        .take(MAX_CONNECTIONS),
    ]);

    const rows = [...asLow, ...asHigh].sort(
      (a, b) =>
        b.createdAt - a.createdAt ||
        compareIds(a.userLow, b.userLow) ||
        compareIds(a.userHigh, b.userHigh),
    );

    const myInterests = await interestKeysOf(ctx, identity.userId);

    return await Promise.all(
      rows.map(async (row) => {
        const otherId =
          row.userLow === identity.userId ? row.userHigh : row.userLow;
        const [user, profile, theirInterests, met] = await Promise.all([
          ctx.db.get(otherId),
          ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", otherId))
            .unique(),
          interestKeysOf(ctx, otherId),
          latestMeetingBetween(ctx, identity.userId, otherId),
        ]);
        const sharedInterests = await sharedInterestLabels(
          ctx,
          myInterests,
          theirInterests,
        );
        return {
          userId: otherId,
          name: user?.displayName ?? profile?.displayName ?? null,
          avatarUrl: user?.avatarUrl ?? null,
          jobTitle: profile?.jobTitle ?? null,
          company: profile?.company ?? null,
          sharedInterests,
          connectedAt: row.createdAt,
          meetingId: met?.meetingId ?? null,
          metAt: met?.metAt ?? null,
        };
      }),
    );
  },
});
