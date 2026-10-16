/**
 * The proposal state machine and reads for the asynchronous matcher
 * (docs/plan/MATCHING-PLAN.md, step 2).
 *
 * One row per proposed pair in `matchProposals` (convex/schema/
 * matchProposals.ts): proposed -> confirmed | declined | expired. Only the
 * two people in a proposal can act on it — every mutation resolves the
 * caller through requireIdentity and refuses anyone else. Confirmation
 * happens when both sides accept; the mutation that observes the second
 * acceptance creates the meeting through createMeetingRecords, so two
 * simultaneous accepts produce exactly one meeting (Convex mutations
 * serialize). Expiry is scheduled at write time and additionally guarded
 * inline, so an accept can never land after the deadline.
 */

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "@convex/_generated/server";
import type { Id } from "@convex/_generated/dataModel";
import { requireIdentity } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { internal } from "@convex/_generated/api";
import { createMeetingRecords } from "@convex/meetings/lifecycle";

/** Matcher meetings are 30 minutes (convex/matching/slots.ts). */
const MEETING_DURATION_MS = 30 * 60_000;
/** Reminder lead times (docs/plan/MATCHING-PLAN.md, step 4). */
const REMINDERS = [
  { kind: "24h", leadMs: 24 * 60 * 60_000 },
  { kind: "10min", leadMs: 10 * 60_000 },
] as const;
/** Proposals die 2 hours before the proposed time at the latest. */
const PRE_MEETING_TTL_MS = 2 * 60 * 60_000;

const DECLINE_REASONS = [
  "not_relevant",
  "bad_timing",
  "already_met",
  "other",
] as const;

/** Formats one UTC instant in a timezone, e.g. "Mon, Feb 9, 9:00 AM". */
export function formatInZone(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(at);
  } catch {
    return new Date(at).toUTCString();
  }
}

/**
 * Loads the proposal and refuses anyone who is not one of its two people.
 * `matchProposals` rows store userAId as the lexicographically smaller id,
 * so a pair maps to at most one row.
 */
async function proposalForParticipant(
  ctx: MutationCtx,
  callerId: Id<"users">,
  proposalId: Id<"matchProposals">,
) {
  const row = await ctx.db.get(proposalId);
  if (!row) throw createError.notFound("Proposal", proposalId);
  if (row.userAId !== callerId && row.userBId !== callerId) {
    throw createError.forbidden(
      "Only the two people in a proposal can act on it",
    );
  }
  return row;
}

/**
 * Refuses anything but a live proposal: a wrong state is rejected outright,
 * and a proposal past its deadline is rejected too, so an accept can never
 * land after the deadline even if the scheduled expiry has not fired yet.
 * No state flip here: a thrown mutation rolls back its whole transaction,
 * so the "expired" flip belongs to the scheduled function alone.
 */
async function refuseExpired(
  row: { _id: Id<"matchProposals">; state: string; expiresAt: number },
) {
  if (row.state !== "proposed") {
    throw createError.validation(`This proposal is already ${row.state}`);
  }
  if (Date.now() >= row.expiresAt) {
    throw createError.validation("This proposal has expired");
  }
}

/**
 * Scheduled expiry: written proposals schedule this at their expiresAt
 * (earlier of 48 hours out or 2 hours before the time). A no-op when the
 * pair already acted or chose a later time that moved the deadline back.
 */
export const expireProposal = internalMutation({
  args: { proposalId: v.id("matchProposals") },
  returns: v.null(),
  handler: async (ctx, { proposalId }) => {
    const row = await ctx.db.get(proposalId);
    if (!row) return null;
    if (row.state !== "proposed") return null;
    if (Date.now() < row.expiresAt) return null;
    await ctx.db.patch(proposalId, {
      state: "expired",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Accept my proposal. Confirmed once both accept; the second acceptance
 * creates the meeting with createMeetingRecords at the chosen slot with
 * both people as participants, and stores the meeting id on the row.
 */
export const accept = mutation({
  args: { proposalId: v.id("matchProposals") },
  returns: v.object({
    state: v.string(),
    meetingId: v.optional(v.id("meetings")),
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const row = await proposalForParticipant(
      ctx,
      identity.userId,
      args.proposalId,
    );
    await refuseExpired(row);

    const now = Date.now();
    const isA = row.userAId === identity.userId;
    const otherAccepted = isA ? row.bAccepted : row.aAccepted;

    let meetingId: Id<"meetings"> | undefined = row.meetingId;
    let state = row.state;
    const patch: Record<string, unknown> = { updatedAt: now };
    if (isA) {
      patch.aAccepted = true;
    } else {
      patch.bAccepted = true;
    }

    if (otherAccepted) {
      // Both sides are in: create the meeting. Mutations serialize, so of
      // two simultaneous accepts exactly one observes the other's flag.
      const [profileA, profileB] = (
        await Promise.all([
          ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", row.userAId)).unique(),
          ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", row.userBId)).unique(),
        ])
      ).map((profile) => profile?.displayName ?? "Connvo member");
      meetingId = await createMeetingRecords(ctx, {
        organizerId: row.userAId,
        title: `Connvo match: ${profileA} & ${profileB}`,
        description: `Suggested first question: ${row.firstQuestion}`,
        scheduledAt: row.scheduledAt,
        duration: MEETING_DURATION_MS,
        webrtcEnabled: true,
        recordingEnabled: false,
        participantIds: [row.userAId, row.userBId],
      });
      patch.state = "confirmed";
      patch.meetingId = meetingId;
      state = "confirmed";
      await ctx.scheduler.runAfter(0, internal.emails.deliver.meetingConfirmed, {
        meetingId,
      });
      // A reminder whose moment has passed would fire now and still say
      // "Tomorrow" or "in about 10 minutes", so it is not scheduled at all.
      for (const { kind, leadMs } of REMINDERS) {
        const sendAt = row.scheduledAt - leadMs;
        if (sendAt <= now) continue;
        await ctx.scheduler.runAt(sendAt, internal.emails.deliver.sendReminder, {
          meetingId,
          kind,
        });
      }
    }

    await ctx.db.patch(row._id, patch);
    return { state, meetingId };
  },
});

/**
 * Switch my proposal to a stored alternative time. The previous time joins
 * the alternatives and the other person's acceptance resets: they accepted
 * the old time, not the new one. The caller's own acceptance stands.
 */
export const chooseAlternative = mutation({
  args: { proposalId: v.id("matchProposals"), index: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const row = await proposalForParticipant(
      ctx,
      identity.userId,
      args.proposalId,
    );
    await refuseExpired(row);

    if (
      !Number.isInteger(args.index) ||
      args.index < 0 ||
      args.index >= row.alternatives.length
    ) {
      throw createError.validation("No such alternative time");
    }

    const chosen = row.alternatives[args.index];
    const rest = row.alternatives.filter((_, i) => i !== args.index);
    const isA = row.userAId === identity.userId;
    await ctx.db.patch(row._id, {
      scheduledAt: chosen,
      alternatives: [row.scheduledAt, ...rest],
      // The deadline keeps tracking the chosen time: 2 hours before it,
      // never later than the 48-hour wall.
      expiresAt: Math.min(row.expiresAt, chosen - PRE_MEETING_TTL_MS),
      ...(isA ? { bAccepted: false } : { aAccepted: false }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Decline my proposal, optionally with one of the reason chips. The other
 * person sees only that it was declined, not who declined first when they
 * never accepted.
 */
export const decline = mutation({
  args: {
    proposalId: v.id("matchProposals"),
    reason: v.optional(
      v.union(
        v.literal("not_relevant"),
        v.literal("bad_timing"),
        v.literal("already_met"),
        v.literal("other"),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const row = await proposalForParticipant(
      ctx,
      identity.userId,
      args.proposalId,
    );
    await refuseExpired(row);

    await ctx.db.patch(row._id, {
      state: "declined",
      declinedById: identity.userId,
      declineReason: args.reason ?? "other",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * My current proposal, in my timezone: the partner's summary (name, title,
 * company, shared interests), the reasons, the first question, the chosen
 * time and the alternatives. Null when nothing is live for me right now.
 */
export const myProposal = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();

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
    const live = rows
      .filter((row) => row.state === "proposed" && row.expiresAt > now)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
    const row = live[0];
    if (!row) return null;

    const otherId =
      row.userAId === identity.userId ? row.userBId : row.userAId;
    const [myProfile, partnerProfile] = await Promise.all([
      ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", identity.userId))
        .unique(),
      ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", otherId))
        .unique(),
    ]);
    const timeZone = myProfile?.timezone ?? "UTC";

    return {
      proposalId: row._id,
      reasons: row.reasons,
      firstQuestion: row.firstQuestion,
      sharedInterests: row.sharedInterestKeys.map((key) =>
        key.replaceAll("_", " "),
      ),
      scheduledAt: row.scheduledAt,
      scheduledAtLocal: formatInZone(row.scheduledAt, timeZone),
      alternatives: row.alternatives.map((at) => ({
        at,
        atLocal: formatInZone(at, timeZone),
      })),
      expiresAt: row.expiresAt,
      expiresAtLocal: formatInZone(row.expiresAt, timeZone),
      myAcceptance:
        row.userAId === identity.userId ? row.aAccepted : row.bAccepted,
      partner: {
        userId: otherId,
        name: partnerProfile?.displayName ?? "Connvo member",
        title: partnerProfile?.jobTitle ?? null,
        company: partnerProfile?.company ?? null,
      },
    };
  },
});

export { DECLINE_REASONS };
