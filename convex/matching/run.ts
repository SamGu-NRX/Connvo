/**
 * The matcher run (docs/plan/MATCHING-PLAN.md, "How matching works").
 *
 * `matchup` gathers a snapshot of everyone eligible, runs the pure pipeline
 * (hard rules -> deterministic score -> shortlist -> optional Decisions
 * rerank -> greedy assignment), and writes proposal drafts. Fired twice a
 * week from convex/crons.ts, or on demand via Convex function calls.
 *
 * The snapshot lives in an internal query, the drafts in an internal
 * mutation, and the action in between; without OPENAI_API_KEY, or when the
 * Decisions API fails, the run is the deterministic pipeline alone.
 */

import { v } from "convex/values";
import type { ActionCtx, QueryCtx } from "@convex/_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "@convex/_generated/server";
import type { Id } from "@convex/_generated/dataModel";
import { internal } from "@convex/_generated/api";
import {
  assign,
  prepare,
  REMATCH_WINDOW_MS,
  type MatcherSnapshot,
  type MatcherSnapshotPerson,
  type ProposalDraft,
  type RerankFn,
} from "./pipeline";
import type { WeeklyBlock } from "./slots";
import { candidatesKeyHash, rerankShortlist } from "./decisions";

/** Cache lifetime for Decisions answers (plan: "answers are cached for 7 days"). */
const DECISIONS_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
/** Proposals expire the earlier of 48 hours out or 2 hours before the time. */
const PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000;
const PRE_MEETING_TTL_MS = 2 * 60 * 60 * 1000;

/** Build one snapshot person from the profile plus related tables. */
async function snapshotPerson(
  ctx: QueryCtx,
  profile: {
    userId: Id<"users">;
    displayName: string;
    intents?: string[];
    timezone?: string;
    chatsPerWeek?: number;
    languages: string[];
    field?: string;
    jobTitle?: string;
    experience?: string;
  },
  now: number,
): Promise<MatcherSnapshotPerson | null> {
  const user = await ctx.db.get(profile.userId);
  if (!user || !user.isActive) return null;
  const chatsPerWeek = profile.chatsPerWeek ?? 0;
  if (chatsPerWeek <= 0) return null;
  const timezone = profile.timezone;
  if (!timezone) return null;

  const interests = (
    await ctx.db
      .query("userInterests")
      .withIndex("by_user", (q) => q.eq("userId", profile.userId))
      .collect()
  ).map((row) => row.interestKey);

  const blocks: WeeklyBlock[] = (
    await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_user", (q) => q.eq("userId", profile.userId))
      .collect()
  ).map((row) => ({
    weekday: row.weekday,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
  }));

  // Meetings in the last 90 days: partners, talk-again pairs, cadence count.
  const weekStart = weekStartUtc(now);
  const metRecently = new Set<string>();
  const talkAgainYes = new Set<string>();
  let meetingsThisWeek = 0;
  const participants = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_user", (q) => q.eq("userId", profile.userId))
    .collect();
  for (const participant of participants) {
    const meeting = await ctx.db.get(participant.meetingId);
    if (!meeting) continue;
    if (meeting.state === "cancelled") continue;
    const scheduledAt = meeting.scheduledAt;
    if (!scheduledAt) continue;
    if (now - scheduledAt <= REMATCH_WINDOW_MS && scheduledAt <= now) {
      const others = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();
      for (const other of others) {
        if (other.userId !== profile.userId) metRecently.add(other.userId);
      }
    }
    if (scheduledAt >= weekStart && scheduledAt < weekStart + 7 * 86400_000) {
      meetingsThisWeek += 1;
    }
  }

  // Talk-again feedback: pairs from this window where BOTH sides said yes.
  const feedbacks = await ctx.db
    .query("meetingFeedback")
    .withIndex("by_user", (q) => q.eq("userId", profile.userId))
    .collect();
  for (const feedback of feedbacks) {
    if (!feedback.talkAgain) continue;
    const meeting = await ctx.db.get(feedback.meetingId);
    if (!meeting || !meeting.scheduledAt) continue;
    if (now - meeting.scheduledAt > REMATCH_WINDOW_MS) continue;
    const others = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", feedback.meetingId))
      .collect();
    for (const other of others) {
      if (other.userId === profile.userId) continue;
      const theirFeedback = await ctx.db
        .query("meetingFeedback")
        .withIndex("by_user", (q) => q.eq("userId", other.userId))
        .collect();
      if (theirFeedback.some((f) => f.meetingId === feedback.meetingId && f.talkAgain)) {
        talkAgainYes.add(other.userId);
      }
    }
  }

  // Waiting runs: distinct runs that produced an unconfirmed proposal.
  const waitingRuns = new Set<number>();
  for (const row of [
    ...(await ctx.db
      .query("matchProposals")
      .withIndex("by_user_a", (q) => q.eq("userAId", profile.userId))
      .collect()),
    ...(await ctx.db
      .query("matchProposals")
      .withIndex("by_user_b", (q) => q.eq("userBId", profile.userId))
      .collect()),
  ]) {
    if (row.state !== "confirmed") waitingRuns.add(row.runAt);
  }

  return {
    userId: profile.userId,
    displayName: profile.displayName,
    intents: profile.intents ?? ["peers"],
    interests,
    field: profile.field ?? null,
    jobTitle: profile.jobTitle ?? null,
    experience: profile.experience ?? null,
    languages: profile.languages,
    timezone,
    chatsPerWeek,
    blocks,
    meetingsThisWeek,
    waitingRuns: waitingRuns.size,
    metRecently: [...metRecently],
    talkAgainBoth: [...talkAgainYes],
  };
}

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStartUtc(now: number): number {
  const date = new Date(now);
  const day = (date.getUTCDay() + 6) % 7; // 0 = Monday
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return midnight - day * 86400_000;
}

/** Snapshot of everyone potentially eligible for this run. */
export const gatherSnapshot = internalQuery({
  args: {},
  handler: async (ctx): Promise<MatcherSnapshot> => {
    const now = Date.now();
    const profiles = await ctx.db.query("profiles").collect();
    const people: MatcherSnapshotPerson[] = [];
    for (const profile of profiles) {
      const person = await snapshotPerson(ctx, profile, now);
      if (person) people.push(person);
    }
    return { now, people };
  },
});

/** Look up a cached Decisions answer, unless it expired. */
export const lookupDecisionsCache = internalQuery({
  args: { personId: v.id("users"), candidatesKey: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("decisionsCache")
      .withIndex("by_person_and_key", (q) =>
        q.eq("personId", args.personId).eq("candidatesKey", args.candidatesKey),
      )
      .unique();
    if (!row) return null;
    if (row.expiresAt <= Date.now()) return null;
    return row.probabilities;
  },
});

/** Store a Decisions answer for 7 days; opportunistically drop expired rows. */
export const storeDecisionsCache = internalMutation({
  args: {
    personId: v.id("users"),
    candidatesKey: v.string(),
    probabilities: v.array(v.object({ candidateId: v.id("users"), probability: v.number() })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("decisionsCache", {
      personId: args.personId,
      candidatesKey: args.candidatesKey,
      probabilities: args.probabilities,
      createdAt: now,
      expiresAt: now + DECISIONS_CACHE_MS,
    });
    for (const expired of await ctx.db
      .query("decisionsCache")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(20)) {
      await ctx.db.delete(expired._id);
    }
  },
});

/** Write proposal drafts, skipping pairs that already have a live proposal. */
export const writeProposals = internalMutation({
  args: {
    drafts: v.array(
      v.object({
        userAId: v.string(),
        userBId: v.string(),
        scheduledAt: v.number(),
        alternatives: v.array(v.number()),
        reasons: v.array(v.string()),
        firstQuestion: v.string(),
        score: v.number(),
        sharedInterestKeys: v.array(v.string()),
        goalPair: v.string(),
      }),
    ),
    runAt: v.number(),
  },
  handler: async (ctx, args) => {
    let created = 0;
    let skipped = 0;
    for (const draft of args.drafts) {
      const userAId = draft.userAId as Id<"users">;
      const userBId = draft.userBId as Id<"users">;
      const existing = await ctx.db
        .query("matchProposals")
        .withIndex("by_user_a", (q) => q.eq("userAId", userAId))
        .collect();
      if (
        existing.some(
          (row) => row.userBId === userBId && (row.state === "proposed" || row.state === "confirmed"),
        )
      ) {
        skipped += 1;
        continue;
      }
      const expiresAt = Math.min(
        args.runAt + PROPOSAL_TTL_MS,
        draft.scheduledAt - PRE_MEETING_TTL_MS,
      );
      const inserted = await ctx.db.insert("matchProposals", {
        userAId,
        userBId,
        state: "proposed",
        aAccepted: false,
        bAccepted: false,
        scheduledAt: draft.scheduledAt,
        alternatives: draft.alternatives,
        reasons: draft.reasons,
        firstQuestion: draft.firstQuestion,
        score: draft.score,
        sharedInterestKeys: draft.sharedInterestKeys,
        goalPair: draft.goalPair,
        runAt: args.runAt,
        expiresAt: expiresAt,
        createdAt: args.runAt,
        updatedAt: args.runAt,
      });
      const proposalId = inserted;
      // The proposal dies on its own at expiresAt: state flips to "expired"
      // unless a person has already acted. The accept mutation still guards
      // on expiresAt, so a late accept can never slip through.
      await ctx.scheduler.runAt(
        expiresAt,
        internal.matching.proposals.expireProposal,
        { proposalId },
      );
      created += 1;
    }
    return { created, skipped };
  },
});

/** Cache-backed rerank: DB first, then the Decisions API, then null. */
function makeCachedRerank(ctx: ActionCtx, key: string): RerankFn {
  return async (person, candidates) => {
    const candidatesKey = candidatesKeyHash(
      person,
      candidates.map((c) => c.userId),
    );
    const personId = person.userId as Id<"users">;
    const cached = await ctx.runQuery(internal.matching.run.lookupDecisionsCache, {
      personId,
      candidatesKey,
    });
    if (cached) {
      return new Map(cached.map((p) => [p.candidateId, p.probability]));
    }
    const result = await rerankShortlist(person, candidates, { key });
    if (!result) return null;
    await ctx.runMutation(internal.matching.run.storeDecisionsCache, {
      personId,
      candidatesKey,
      probabilities: [...result].map(([candidateId, probability]) => ({
        candidateId: candidateId as Id<"users">,
        probability,
      })),
    });
    return result;
  };
}

/** What a run reports back for logs and the cron record. */
interface MatchupResult {
  eligibleCount: number;
  created: number;
  skipped: number;
  reranked: boolean;
}

/** Shared run body for the public action and the cron wrapper. */
async function runMatchup(ctx: ActionCtx, useDecisions?: boolean): Promise<MatchupResult> {
  const snapshot: MatcherSnapshot = await ctx.runQuery(
    internal.matching.run.gatherSnapshot,
    {},
  );
  // Blocks gate pairing through the canonical helper, so the matcher always
  // agrees with what profiles/moderation enforces elsewhere.
  const prepared = await prepare(snapshot, {
    isBlocked: (a, b) =>
      ctx.runQuery(internal.profiles.moderation.isBlockedEither, {
        a: a as Id<"users">,
        b: b as Id<"users">,
      }),
  });
  const apiKey =
    useDecisions === false ? undefined : process.env.OPENAI_API_KEY;
  const rerank = apiKey ? makeCachedRerank(ctx, apiKey) : undefined;
  const drafts: ProposalDraft[] = await assign(snapshot, prepared, rerank);
  const result = await ctx.runMutation(internal.matching.run.writeProposals, {
    drafts: drafts.map((d) => ({ ...d })),
    runAt: snapshot.now,
  });
  return {
    eligibleCount: prepared.eligible.length,
    created: result.created,
    skipped: result.skipped,
    reranked: rerank !== undefined,
  };
}

/**
 * Run the matcher once and write proposals. Without OPENAI_API_KEY, or when
 * the Decisions API fails, the run is deterministic alone; the return value
 * reports eligible people, created and skipped drafts.
 */
export const matchup = action({
  args: { useDecisions: v.optional(v.boolean()) },
  handler: async (ctx, args) => runMatchup(ctx, args.useDecisions),
});

/** Cron entry: the same run, on the twice-weekly schedule in crons.ts. */
export const matchupCron = internalAction({
  args: {},
  handler: async (ctx) => runMatchup(ctx, true),
});

/** Internal "run now": the cron run, on demand for development. */
export const runNow = internalAction({
  args: {},
  handler: async (ctx) => runMatchup(ctx, true),
});
