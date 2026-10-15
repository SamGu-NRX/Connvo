/**
 * The home view queries (/app, docs/plan/MATCHING-PLAN.md steps 5-6):
 * everything the home screen needs besides the live proposal card, which
 * convex/matching/proposals.ts myProposal already serves.
 *
 * - myHomeView: the confirmed upcoming chat (with join-window math), the last
 *   declined or expired outcome, the next matcher run, and whether
 *   availability is set up — so an incomplete profile shows a nudge, not a
 *   silent empty state.
 */

import { query } from "@convex/_generated/server";
import { v } from "convex/values";
import type { Id } from "@convex/_generated/dataModel";
import { requireIdentity } from "@convex/auth/guards";
import { formatInZone } from "@convex/matching/proposals";

/** Matcher meetings are 30 minutes (convex/matching/slots.ts). */
const MEETING_DURATION_MS = 30 * 60_000;
/**
 * The join button enables this long before the start (the plan's "join
 * window"); before then the card counts down.
 */
const JOIN_WINDOW_BEFORE_MS = 5 * 60_000;
/** How recently a declined/expired outcome still deserves a notice. */
const OUTCOME_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * The next matcher run: Tuesday or Saturday 15:00 UTC, whichever comes
 * first after `now` (docs/plan/MATCHING-PLAN.md, "When it runs").
 */
export function nextMatcherRunAt(now: number): number {
  const date = new Date(now);
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  // Tuesday=2, Saturday=6 in UTC.
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const dayMidnight = midnight + dayOffset * 86_400_000;
    const weekday = new Date(dayMidnight).getUTCDay();
    if (weekday !== 2 && weekday !== 6) continue;
    const runAt = dayMidnight + 15 * 60 * 60_000;
    if (runAt > now) return runAt;
  }
  // Unreachable: a Tuesday or Saturday always arrives within 7 days.
  return midnight + 7 * 86_400_000 + 15 * 60 * 60_000;
}

/**
 * Everything on the home screen around the proposal card: the upcoming
 * confirmed chat, the last outcome notice, the next run, and the
 * availability nudge.
 */
export const myHomeView = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      /** The confirmed chat still in its join window, if any. */
      upcoming: v.union(
        v.null(),
        v.object({
          meetingId: v.id("meetings"),
          scheduledAt: v.number(),
          scheduledAtLocal: v.string(),
          /** Join unlocks at start minus 5 minutes; the card counts down. */
          joinOpensAt: v.number(),
          /** The meeting is over after start + 30 minutes. */
          endsAt: v.number(),
          partnerName: v.string(),
          partnerUserId: v.id("users"),
          firstQuestion: v.string(),
        }),
      ),
      /** The most recent declined or expired outcome, while still fresh. */
      lastOutcome: v.union(
        v.null(),
        v.object({
          state: v.union(v.literal("declined"), v.literal("expired")),
          declineReason: v.optional(v.string()),
          at: v.number(),
          atLocal: v.string(),
        }),
      ),
      nextRunAt: v.number(),
      nextRunAtLocal: v.string(),
      availabilityReady: v.boolean(),
      missingAvailability: v.array(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    const myProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();
    const timeZone = myProfile?.timezone ?? "UTC";

    // Confirmed proposals of mine, earliest first; the first whose meeting
    // has not ended yet is the upcoming chat.
    const rows = [
      ...(await ctx.db
        .query("matchProposals")
        .withIndex("by_user_a", (q) => q.eq("userAId", identity.userId))
        .collect()),
      ...(await ctx.db
        .query("matchProposals")
        .withIndex("by_user_b", (q) => q.eq("userBId", identity.userId))
        .collect()),
    ];
    const confirmed = rows
      .filter((row) => row.state === "confirmed" && row.meetingId)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    let upcoming = null;
    for (const row of confirmed) {
      const meeting = await ctx.db.get(row.meetingId as Id<"meetings">);
      if (!meeting) continue;
      if (meeting.state !== "scheduled" && meeting.state !== "active") continue;
      if (now >= row.scheduledAt + MEETING_DURATION_MS) continue;
      const partnerId =
        row.userAId === identity.userId ? row.userBId : row.userAId;
      const partnerProfile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", partnerId))
        .unique();
      upcoming = {
        meetingId: meeting._id,
        scheduledAt: row.scheduledAt,
        scheduledAtLocal: formatInZone(row.scheduledAt, timeZone),
        joinOpensAt: row.scheduledAt - JOIN_WINDOW_BEFORE_MS,
        endsAt: row.scheduledAt + MEETING_DURATION_MS,
        partnerName: partnerProfile?.displayName ?? "Connvo member",
        partnerUserId: partnerId,
        firstQuestion: row.firstQuestion,
      };
      break;
    }

    // The freshest declined or expired outcome within the last week; only
    // shown when nothing is coming up, so the home screen stays calm.
    const outcomes = rows
      .filter(
        (row) =>
          (row.state === "declined" || row.state === "expired") &&
          now - row.updatedAt <= OUTCOME_TTL_MS,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const lastRow = outcomes[0];
    const lastOutcome = lastRow
      ? {
          state: lastRow.state as "declined" | "expired",
          ...(lastRow.declineReason
            ? { declineReason: lastRow.declineReason }
            : {}),
          at: lastRow.updatedAt,
          atLocal: formatInZone(lastRow.updatedAt, timeZone),
        }
      : null;

    const blockCount = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .collect();
    const missingAvailability: string[] = [];
    if (!myProfile?.timezone) missingAvailability.push("your timezone");
    if ((myProfile?.chatsPerWeek ?? 0) <= 0)
      missingAvailability.push("your weekly chat cadence");
    if (blockCount.length === 0) missingAvailability.push("your free times");
    const nextRunAt = nextMatcherRunAt(now);

    return {
      upcoming,
      lastOutcome,
      nextRunAt,
      nextRunAtLocal: formatInZone(nextRunAt, timeZone),
      availabilityReady: missingAvailability.length === 0,
      missingAvailability,
    };
  },
});
