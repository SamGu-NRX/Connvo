import { ConvexError } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { createMeetingRecords } from "@convex/meetings/lifecycle";
import {
  callQueueStatusV,
  callQueueTypeV,
} from "@convex/types/validators/matching";
import { readUserScoringData, scoreQueuePair } from "./scoring";

type QueueType = Infer<typeof callQueueTypeV>;
type QueueState = Infer<typeof callQueueStatusV>;

// Product limits: one minute to answer a match and fifteen minutes of queue availability.
// These are explicit timeouts, not estimates of matching performance.
const MATCH_WINDOW_MS = 60_000;
const QUEUE_WINDOW_MS = 15 * 60_000;

export async function entryForUser(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db
    .query("callQueueEntries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function readyMeetingIsClosed(
  ctx: QueryCtx,
  match: Doc<"callQueueMatches">,
  userId: Id<"users">,
) {
  if (!match.meetingId)
    throw new ConvexError(
      "Your accepted match has no meeting. Leave the queue and try again.",
    );
  const meetingId = match.meetingId;
  const meeting = await ctx.db.get(meetingId);
  if (!meeting)
    throw new ConvexError(
      "Your conversation is unavailable. Leave the queue and try again.",
    );
  if (meeting.state === "concluded" || meeting.state === "cancelled")
    return true;
  // Leaving the real call closes a session, not the meeting. Release only
  // this person's reservation; their partner may still be in the call.
  const latestSession = await ctx.db
    .query("webrtcSessions")
    .withIndex("by_user_and_meeting", (q) =>
      q.eq("userId", userId).eq("meetingId", meetingId),
    )
    .order("desc")
    .first();
  return (
    latestSession?.state === "closed" &&
    latestSession.closedReason !== "replaced"
  );
}

export async function queueState(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<QueueState> {
  const entry = await entryForUser(ctx, userId);
  if (!entry || entry.state === "idle") return { state: "idle" };
  const timing = {
    queueType: entry.queueType,
    joinedAt: entry.joinedAt,
    serverNow: Date.now(),
    expiresAt: entry.expiresAt,
  };
  if (entry.state === "expired") return { state: "expired", ...timing };
  if (entry.state === "waiting")
    return { state: "waiting", ...timing, notice: entry.notice };
  if (!entry.matchId)
    throw new ConvexError(
      "Your queue match is missing. Leave the queue and try again.",
    );
  const match = await ctx.db.get(entry.matchId);
  if (!match)
    throw new ConvexError(
      "Your queue match is unavailable. Leave the queue and try again.",
    );
  if (match.state === "ready" && match.meetingId) {
    if (await readyMeetingIsClosed(ctx, match, userId))
      return { state: "idle" };
    return { state: "ready", matchId: match._id, meetingId: match.meetingId };
  }
  if (match.state !== "pending")
    throw new ConvexError(
      "Your queue match is no longer active. Leave the queue and try again.",
    );
  const isFirst = match.user1Id === userId;
  const partner = await ctx.db.get(isFirst ? match.user2Id : match.user1Id);
  if (!partner)
    throw new ConvexError(
      "Your match partner is unavailable. Leave the queue and try again.",
    );
  return {
    state: "matched",
    queueType: entry.queueType,
    joinedAt: entry.joinedAt,
    serverNow: Date.now(),
    matchId: match._id,
    expiresAt: match.expiresAt,
    partner: {
      id: partner._id,
      displayName: partner.displayName?.trim() || "Connvo member",
      avatarUrl: partner.avatarUrl,
    },
    reasons: match.reasons,
    accepted: isFirst ? match.user1Accepted : match.user2Accepted,
    partnerAccepted: isFirst ? match.user2Accepted : match.user1Accepted,
  };
}

/** Reading and reserving both entries in one transaction prevents overlapping pairs. */
export async function pairWaiting(ctx: MutationCtx, queueType: QueueType) {
  const now = Date.now();
  const waiting = await ctx.db
    .query("callQueueEntries")
    .withIndex("by_queue_state", (q) =>
      q.eq("queueType", queueType).eq("state", "waiting"),
    )
    .collect();
  const active = waiting
    .filter((entry) => entry.expiresAt > now)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const used = new Set<Id<"users">>();
  const scoringData = new Map<
    Id<"users">,
    Awaited<ReturnType<typeof readUserScoringData>>
  >();
  for (const entry of active)
    scoringData.set(entry.userId, await readUserScoringData(ctx, entry.userId));
  for (let index = 0; index < active.length; index++) {
    const first = active[index];
    if (used.has(first.userId)) continue;
    const data1 = scoringData.get(first.userId);
    if (!data1) continue;
    let best:
      | {
          entry: Doc<"callQueueEntries">;
          result: ReturnType<typeof scoreQueuePair>;
        }
      | undefined;
    for (const candidate of active.slice(index + 1)) {
      if (
        used.has(candidate.userId) ||
        first.blockedUserIds.includes(candidate.userId) ||
        candidate.blockedUserIds.includes(first.userId)
      )
        continue;
      const data2 = scoringData.get(candidate.userId);
      if (!data2) continue;
      const result = scoreQueuePair(data1, data2);
      // Do not manufacture a compatibility claim when profiles supply no shared evidence.
      if (!result.reasons.length || result.features.orgConstraintMatch === 0)
        continue;
      if (!best || result.score > best.result.score)
        best = { entry: candidate, result };
    }
    if (!best) continue;
    const second = best.entry;
    const expiresAt = Math.min(
      now + MATCH_WINDOW_MS,
      first.expiresAt,
      second.expiresAt,
    );
    const matchId = await ctx.db.insert("callQueueMatches", {
      user1Id: first.userId,
      user2Id: second.userId,
      entry1Id: first._id,
      entry2Id: second._id,
      state: "pending",
      user1Accepted: false,
      user2Accepted: false,
      reasons: best.result.reasons,
      score: best.result.score,
      createdAt: now,
      expiresAt,
    });
    await ctx.db.patch(first._id, {
      state: "matched",
      matchId,
      notice: undefined,
    });
    await ctx.db.patch(second._id, {
      state: "matched",
      matchId,
      notice: undefined,
    });
    await ctx.scheduler.runAt(expiresAt, internal.matching.queue.expireMatch, {
      matchId,
    });
    used.add(first.userId);
    used.add(second.userId);
  }
}

export async function releaseMatch(
  ctx: MutationCtx,
  match: Doc<"callQueueMatches">,
  reason: "declined" | "expired",
  decliningUserId?: Id<"users">,
) {
  if (match.state !== "pending") return;
  await ctx.db.patch(match._id, { state: reason });
  for (const [entryId, partnerId] of [
    [match.entry1Id, match.user2Id],
    [match.entry2Id, match.user1Id],
  ] as const) {
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.matchId !== match._id) continue;
    await ctx.db.patch(entryId, {
      state: entry.expiresAt <= Date.now() ? "expired" : "waiting",
      matchId: undefined,
      blockedUserIds: [...new Set([...entry.blockedUserIds, partnerId])],
      notice: {
        id: match._id,
        type:
          reason === "expired"
            ? "match_expired"
            : entry.userId === decliningUserId
              ? "declined"
              : "partner_declined",
      },
    });
  }
}

export async function joinQueue(
  ctx: MutationCtx,
  userId: Id<"users">,
  queueType: QueueType,
) {
  const now = Date.now();
  const entry = await entryForUser(ctx, userId);
  if (entry?.state === "ready" && entry.matchId) {
    const match = await ctx.db.get(entry.matchId);
    if (!match || !(await readyMeetingIsClosed(ctx, match, userId))) return;
  } else if (
    entry &&
    (entry.state === "waiting" || entry.state === "matched")
  ) {
    if (entry.queueType !== queueType)
      throw new ConvexError(
        "Leave your current queue before switching conversation types.",
      );
    if (entry.expiresAt > now) return;
    if (entry.matchId) {
      const match = await ctx.db.get(entry.matchId);
      if (match) await releaseMatch(ctx, match, "expired");
    }
  }
  const data = {
    userId,
    queueType,
    state: "waiting" as const,
    joinedAt: now,
    expiresAt: now + QUEUE_WINDOW_MS,
    blockedUserIds: [],
    matchId: undefined,
    notice: undefined,
  };
  const entryId = entry
    ? entry._id
    : await ctx.db.insert("callQueueEntries", data);
  if (entry) await ctx.db.replace(entry._id, data);
  await ctx.scheduler.runAt(
    data.expiresAt,
    internal.matching.queue.expireEntry,
    { entryId, expiresAt: data.expiresAt },
  );
  await pairWaiting(ctx, queueType);
}

export async function leaveQueue(ctx: MutationCtx, userId: Id<"users">) {
  const entry = await entryForUser(ctx, userId);
  if (!entry || entry.state === "idle") return;
  if (entry.state === "matched" && entry.matchId) {
    const match = await ctx.db.get(entry.matchId);
    if (match) await releaseMatch(ctx, match, "declined", userId);
  }
  await ctx.db.patch(entry._id, {
    state: "idle",
    matchId: undefined,
    notice: undefined,
  });
  await pairWaiting(ctx, entry.queueType);
}

export async function respondToMatch(
  ctx: MutationCtx,
  userId: Id<"users">,
  matchId: Id<"callQueueMatches">,
  accept: boolean,
) {
  const match = await ctx.db.get(matchId);
  if (!match || (match.user1Id !== userId && match.user2Id !== userId)) {
    throw new ConvexError("You are not a participant in this match.");
  }
  if (match.state === "ready" && accept) return;
  if (match.state !== "pending") return;
  if (match.expiresAt <= Date.now()) {
    await releaseMatch(ctx, match, "expired");
    const entry = await ctx.db.get(match.entry1Id);
    if (entry) await pairWaiting(ctx, entry.queueType);
    return;
  }
  if (!accept) {
    await releaseMatch(ctx, match, "declined", userId);
    const entry = await ctx.db.get(match.entry1Id);
    if (entry) await pairWaiting(ctx, entry.queueType);
    return;
  }
  const isFirst = match.user1Id === userId;
  const bothAccepted = isFirst ? match.user2Accepted : match.user1Accepted;
  if (!bothAccepted) {
    await ctx.db.patch(
      matchId,
      isFirst ? { user1Accepted: true } : { user2Accepted: true },
    );
    return;
  }
  const meetingId = await createMeetingRecords(ctx, {
    organizerId: match.user1Id,
    participantIds: [match.user2Id],
    title: "Connvo conversation",
    duration: 30 * 60_000,
    webrtcEnabled: true,
    recordingEnabled: false,
    // Both people chose to join now. mesh.joinCall requires an active meeting.
    startImmediately: true,
  });
  await ctx.db.patch(matchId, {
    state: "ready",
    user1Accepted: true,
    user2Accepted: true,
    meetingId,
  });
  await ctx.db.patch(match.entry1Id, { state: "ready" });
  await ctx.db.patch(match.entry2Id, { state: "ready" });
}
