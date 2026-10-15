// Internal fixtures for the local queue-to-call browser proof. Never client-callable.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { entryForUser, leaveQueue } from "../matching/callQueue";

function requireLocalTestBackend() {
  if (!process.env.CONNVO_LOCAL_TEST_JWKS)
    throw new Error("queueProof requires the local test identity backend");
}

export const prepare = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireLocalTestBackend();
    for (const subject of [
      "local-test-a",
      "local-test-b",
      "local-test-c",
      "local-test-o",
    ]) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
        .unique();
      if (!user) throw new Error(`Run devEval/seed first: ${subject} missing`);
      await leaveQueue(ctx, user._id);
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      if (!profile)
        await ctx.db.insert("profiles", {
          userId: user._id,
          displayName: user.displayName ?? subject,
          languages: ["English"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      const interests = await ctx.db
        .query("userInterests")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      if (!interests.some((i) => i.interestKey === "technology"))
        await ctx.db.insert("userInterests", {
          userId: user._id,
          interestKey: "technology",
          createdAt: Date.now(),
        });
    }
    return { prepared: 4 };
  },
});

export const expire = internalMutation({
  args: {
    subject: v.string(),
    kind: v.union(v.literal("queue"), v.literal("match")),
  },
  handler: async (ctx, { subject, kind }) => {
    requireLocalTestBackend();
    if (!/^local-test-[abco]$/.test(subject))
      throw new Error("Only harness identities may be expired");
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
      .unique();
    if (!user) throw new Error("Seeded user missing");
    const entry = await entryForUser(ctx, user._id);
    if (!entry) throw new Error("Queue entry missing");
    const expiresAt = Date.now();
    if (kind === "queue") {
      await ctx.db.patch(entry._id, { expiresAt });
      await ctx.scheduler.runAfter(0, internal.matching.queue.expireEntry, {
        entryId: entry._id,
        expiresAt,
      });
    } else {
      if (!entry.matchId) throw new Error("Pending match missing");
      await ctx.db.patch(entry.matchId, { expiresAt });
      await ctx.scheduler.runAfter(0, internal.matching.queue.expireMatch, {
        matchId: entry.matchId,
      });
    }
    return { expiresAt };
  },
});

export const meeting = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    requireLocalTestBackend();
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const identities = await Promise.all(
      participants.map(async (p) => ({
        subject: (await ctx.db.get(p.userId))?.workosUserId,
        role: p.role,
      })),
    );
    return { meeting: await ctx.db.get(meetingId), participants: identities };
  },
});

// --- Full-journey harness helpers (tools/call-eval call-journey-proof) -------

const HARNESS_SUBJECT_RE = /^local-test-[abco]$/;

/** Turn onboarding back on for harness identities so the journey can drive the
 *  shipped /onboarding wizard end to end. Deletes the profile and interest rows
 *  so saveOnboarding writes fresh ones through its real path.
 */
export const resetOnboarding = internalMutation({
  args: { subjects: v.array(v.string()) },
  returns: v.object({ reset: v.number() }),
  handler: async (ctx, { subjects }) => {
    requireLocalTestBackend();
    for (const subject of subjects) {
      if (!HARNESS_SUBJECT_RE.test(subject))
        throw new Error(`Only harness identities may be reset: ${subject}`);
      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
        .unique();
      if (!user) throw new Error(`Run devEval/seed first: ${subject} missing`);
      await ctx.db.patch(user._id, {
        onboardingComplete: false,
        updatedAt: Date.now(),
      });
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      if (profile) await ctx.db.delete(profile._id);
      const interests = await ctx.db
        .query("userInterests")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of interests) await ctx.db.delete(row._id);
    }
    return { reset: subjects.length };
  },
});

/** What the onboarding wizard actually persisted for a harness identity. */
export const onboardingState = internalQuery({
  args: { subject: v.string() },
  returns: v.object({
    complete: v.boolean(),
    field: v.union(v.string(), v.null()),
    jobTitle: v.union(v.string(), v.null()),
    company: v.union(v.string(), v.null()),
    interestsCount: v.number(),
  }),
  handler: async (ctx, { subject }) => {
    requireLocalTestBackend();
    if (!HARNESS_SUBJECT_RE.test(subject))
      throw new Error(`Only harness identities may be read: ${subject}`);
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
      .unique();
    if (!user) throw new Error(`Seeded user missing: ${subject}`);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const interests = await ctx.db
      .query("userInterests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return {
      complete: user.onboardingComplete === true,
      field: profile?.field ?? null,
      jobTitle: profile?.jobTitle ?? null,
      company: profile?.company ?? null,
      interestsCount: interests.length,
    };
  },
});

/** The queue entry a harness identity currently holds, with its notice. */
export const entryState = internalQuery({
  args: { subject: v.string() },
  returns: v.object({
    state: v.string(),
    noticeType: v.union(v.string(), v.null()),
    matchState: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { subject }) => {
    requireLocalTestBackend();
    if (!HARNESS_SUBJECT_RE.test(subject))
      throw new Error(`Only harness identities may be read: ${subject}`);
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
      .unique();
    if (!user) throw new Error(`Seeded user missing: ${subject}`);
    const entry = await entryForUser(ctx, user._id);
    if (!entry) return { state: "idle", noticeType: null, matchState: null };
    // A released entry (declined/expired) keeps no matchId reference; the
    // released match's id survives in the release notice, so resolve the
    // match through it to report what that match row now reads. The notice
    // validator types id as a plain string; releaseMatch writes the match id.
    const noticeId = entry.notice?.id;
    const matchId =
      entry.matchId ??
      (noticeId ? (noticeId as Id<"callQueueMatches">) : undefined);
    const match = matchId ? await ctx.db.get(matchId) : null;
    return {
      state: entry.state,
      noticeType: entry.notice?.type ?? null,
      matchState: match?.state ?? null,
    };
  },
});

/** Return the harness identities' queue and call history to a pristine state
 *  between journey runs. A prior run's decline stamps mutual blocks into
 *  still-active queue entries and joinQueue reuses unexpired entries as-is,
 *  which would prevent re-pairing for the rest of the 15-minute queue window;
 *  concluded journey meetings would also inflate the participant count the
 *  proof asserts. Deletes the identities' queue entries (releasing any pending
 *  match as expired) and the meeting rows prior runs created.
 */
export const resetQueueState = internalMutation({
  args: { subjects: v.array(v.string()) },
  returns: v.object({
    entriesDeleted: v.number(),
    participantsDeleted: v.number(),
    meetingsDeleted: v.number(),
  }),
  handler: async (ctx, { subjects }) => {
    requireLocalTestBackend();
    let entriesDeleted = 0;
    let participantsDeleted = 0;
    const meetingIds = new Set<Id<"meetings">>();
    for (const subject of subjects) {
      if (!HARNESS_SUBJECT_RE.test(subject))
        throw new Error(`Only harness identities may be reset: ${subject}`);
      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
        .unique();
      if (!user) throw new Error(`Run devEval/seed first: ${subject} missing`);
      const entries = await ctx.db
        .query("callQueueEntries")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const entry of entries) {
        if (entry.matchId) {
          const match = await ctx.db.get(entry.matchId);
          if (match?.state === "pending")
            await ctx.db.patch(match._id, { state: "expired" });
        }
        await ctx.db.delete(entry._id);
        entriesDeleted += 1;
      }
      const rows = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of rows) {
        meetingIds.add(row.meetingId);
        await ctx.db.delete(row._id);
        participantsDeleted += 1;
      }
    }
    let meetingsDeleted = 0;
    for (const meetingId of meetingIds) {
      await ctx.db.delete(meetingId);
      meetingsDeleted += 1;
    }
    return { entriesDeleted, participantsDeleted, meetingsDeleted };
  },
});

/** Meetings a harness identity participates in; a declined introduction adds none. */
export const participantMeetings = internalQuery({
  args: { subject: v.string() },
  returns: v.object({
    meetings: v.number(),
    states: v.array(v.string()),
  }),
  handler: async (ctx, { subject }) => {
    requireLocalTestBackend();
    if (!HARNESS_SUBJECT_RE.test(subject))
      throw new Error(`Only harness identities may be read: ${subject}`);
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
      .unique();
    if (!user) throw new Error(`Seeded user missing: ${subject}`);
    const rows = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const states: string[] = [];
    for (const row of rows) {
      const meeting = await ctx.db.get(row.meetingId);
      if (meeting) states.push(meeting.state);
    }
    return { meetings: rows.length, states };
  },
});
