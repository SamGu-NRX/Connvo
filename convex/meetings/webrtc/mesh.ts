/**
 * Call mesh signaling: what the P2P transport's Convex adapter
 * (src/lib/call/transports/p2p/convex-signaling.ts) talks to.
 *
 * Every browser tab that joins a call gets its own session (webrtcSessions).
 * Signals are addressed to a session, not a user, so a reloaded tab never
 * receives offers meant for the tab it replaced, and a signal is only stored
 * when its target session is open in the same meeting: nothing is written
 * that no one can read. Open sessions send a heartbeat; a session that stops
 * (a killed tab, a lost network) is closed by the next heartbeat in its
 * meeting, and by a cron when nobody else is there.
 *
 * Every public function starts with assertMeetingAccess: only participants
 * of the meeting can join, see presence, signal or read signals, and a
 * session can only be used by the user who owns it.
 */

import { v, type Infer } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "@convex/_generated/server";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { enforceUserLimit } from "@convex/lib/rateLimiter";

/** A session with no heartbeat for this long is closed as expired. */
export const HEARTBEAT_EXPIRY_MS = 10_000;
/** Sessions in this state are in the call. */
const OPEN = "connected" as const;

const sessionIdV = v.string();

/**
 * sendSignal calls allowed per session per 10 s window. Setting up a
 * four-person call takes roughly 70 signals per tab (three peers, each an
 * offer or answer plus about twenty ICE candidates), so 200 leaves room for
 * an ICE restart round on top. That figure is an estimate: no run has
 * counted candidates across real networks.
 */
export const SIGNAL_RATE_LIMIT = { windowMs: 10_000, maxRequests: 200 };

/**
 * Largest accepted signal fields, in characters. A Chrome audio+video SDP
 * is about 5-10 KB, a candidate line about 150 characters, and an ICE
 * username fragment at most 256 characters (RFC 8839). The caps sit well
 * above that and keep one signal far below Convex's 1 MB document limit.
 */
export const SIGNAL_SIZE_LIMITS = {
  sdp: 32_768,
  candidate: 1_024,
  sdpMid: 64,
  usernameFragment: 256,
};

/** The rateLimits action key for one session's signals. */
const signalRateAction = (meetingId: Id<"meetings">, sessionId: string) =>
  `callSignal:${meetingId}:${sessionId}`;

function checkSignalSize(signal: Signal): void {
  const fields: Array<[keyof typeof SIGNAL_SIZE_LIMITS, string | undefined]> =
    signal.kind === "description"
      ? [["sdp", signal.sdp]]
      : [
          ["candidate", signal.candidate],
          ["sdpMid", signal.sdpMid],
          ["usernameFragment", signal.usernameFragment],
        ];
  for (const [field, value] of fields) {
    if (value !== undefined && value.length > SIGNAL_SIZE_LIMITS[field]) {
      throw createError.validation(
        `${field} is longer than ${SIGNAL_SIZE_LIMITS[field]} characters`,
        field,
      );
    }
  }
}

/** One signal, as the browser's RTCPeerConnection produces it. */
const signalV = v.union(
  v.object({
    kind: v.literal("description"),
    type: v.union(
      v.literal("offer"),
      v.literal("answer"),
      v.literal("pranswer"),
      v.literal("rollback"),
    ),
    sdp: v.string(),
  }),
  v.object({
    kind: v.literal("candidate"),
    candidate: v.string(),
    sdpMLineIndex: v.optional(v.number()),
    sdpMid: v.optional(v.string()),
    usernameFragment: v.optional(v.string()),
  }),
);
type Signal = Infer<typeof signalV>;

function checkSessionId(sessionId: string): void {
  if (sessionId.length < 8 || sessionId.length > 64) {
    throw createError.validation(
      "sessionId must be 8-64 characters",
      "sessionId",
    );
  }
}

async function sessionById(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
  sessionId: string,
): Promise<Doc<"webrtcSessions"> | null> {
  return ctx.db
    .query("webrtcSessions")
    .withIndex("by_meeting_and_session", (q) =>
      q.eq("meetingId", meetingId).eq("sessionId", sessionId),
    )
    .unique();
}

/** The caller's own session, or a forbidden error naming why not. */
async function ownSession(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
  sessionId: string,
  userId: Id<"users">,
): Promise<Doc<"webrtcSessions">> {
  const session = await sessionById(ctx, meetingId, sessionId);
  if (!session || session.userId !== userId) {
    throw createError.forbidden("Access denied: not your call session", {
      meetingId,
      sessionId,
    });
  }
  return session;
}

async function close(
  ctx: MutationCtx,
  session: Doc<"webrtcSessions">,
  reason: "left" | "replaced" | "expired",
  now: number,
): Promise<void> {
  await ctx.db.patch(session._id, {
    state: "closed",
    closedReason: reason,
    updatedAt: now,
  });
  // Signals waiting for a closed session can never be read.
  const pending = await ctx.db
    .query("webrtcSignals")
    .withIndex("by_target_session_and_processed", (q) =>
      q.eq("toSessionId", session.sessionId).eq("processed", false),
    )
    .collect();
  // Session ids come from the client, so match the meeting too: closing a
  // session must not touch signals for a same-named session elsewhere.
  for (const signal of pending) {
    if (signal.meetingId === session.meetingId)
      await ctx.db.patch(signal._id, { processed: true });
  }
  // A closed session sends nothing more, so its rate-limit counters go too.
  const counters = await ctx.db
    .query("rateLimits")
    .withIndex("by_user_action_window", (q) =>
      q
        .eq("userId", session.userId)
        .eq("action", signalRateAction(session.meetingId, session.sessionId)),
    )
    .collect();
  for (const counter of counters) await ctx.db.delete(counter._id);
}

/** Close open sessions in this meeting whose heartbeat has stopped. */
async function sweepMeeting(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  now: number,
): Promise<void> {
  const open = await ctx.db
    .query("webrtcSessions")
    .withIndex("by_meeting_and_state", (q) =>
      q.eq("meetingId", meetingId).eq("state", OPEN),
    )
    .collect();
  for (const session of open) {
    if (
      (session.lastHeartbeatAt ?? session.updatedAt) <
      now - HEARTBEAT_EXPIRY_MS
    ) {
      await close(ctx, session, "expired", now);
    }
  }
}

/**
 * Join the call with a new session. Any other open session of the same user
 * in this meeting is closed as "replaced": one tab per person.
 */
export const joinCall = mutation({
  args: { meetingId: v.id("meetings"), sessionId: sessionIdV },
  returns: v.object({ sessionId: v.string(), participantId: v.string() }),
  handler: async (ctx, { meetingId, sessionId }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    checkSessionId(sessionId);
    const meeting = await ctx.db.get(meetingId);
    if (!meeting || meeting.state !== "active") {
      throw createError.validation("This meeting is not active", "meetingId");
    }
    const user = await ctx.db.get(participant.userId);
    if (!user) throw createError.notFound("User", participant.userId);
    const now = Date.now();

    const existing = await sessionById(ctx, meetingId, sessionId);
    if (existing) {
      if (existing.userId !== participant.userId) {
        throw createError.forbidden("Access denied: not your call session", {
          meetingId,
          sessionId,
        });
      }
      return { sessionId, participantId: user.workosUserId };
    }

    const mine = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_user_and_meeting", (q) =>
        q.eq("userId", participant.userId).eq("meetingId", meetingId),
      )
      .collect();
    for (const old of mine) {
      if (old.state === OPEN) await close(ctx, old, "replaced", now);
    }

    await ctx.db.insert("webrtcSessions", {
      meetingId,
      sessionId,
      userId: participant.userId,
      state: OPEN,
      lastHeartbeatAt: now,
      micOn: true,
      cameraOn: true,
      createdAt: now,
      updatedAt: now,
    });
    await sweepMeeting(ctx, meetingId, now);
    return { sessionId, participantId: user.workosUserId };
  },
});

/**
 * Keep the session open. Returns alive:false with the reason when the
 * session was closed (replaced by another tab, or expired), so the client
 * stops instead of talking into a closed session. Also closes other
 * sessions in the meeting whose heartbeat stopped.
 */
export const heartbeat = mutation({
  args: { meetingId: v.id("meetings"), sessionId: sessionIdV },
  returns: v.object({
    alive: v.boolean(),
    reason: v.optional(
      v.union(v.literal("left"), v.literal("replaced"), v.literal("expired")),
    ),
  }),
  handler: async (ctx, { meetingId, sessionId }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    const session = await ownSession(
      ctx,
      meetingId,
      sessionId,
      participant.userId,
    );
    const now = Date.now();
    if (session.state !== OPEN)
      return { alive: false, reason: session.closedReason ?? "expired" };
    await ctx.db.patch(session._id, { lastHeartbeatAt: now, updatedAt: now });
    await sweepMeeting(ctx, meetingId, now);
    return { alive: true };
  },
});

/** Leave the call: the session closes and its unread signals are dropped. */
export const leaveCall = mutation({
  args: { meetingId: v.id("meetings"), sessionId: sessionIdV },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    const session = await ownSession(
      ctx,
      meetingId,
      sessionId,
      participant.userId,
    );
    if (session.state === OPEN) await close(ctx, session, "left", Date.now());
    return null;
  },
});

/** Announce this session's mic and camera state to the others. */
export const setMediaState = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: sessionIdV,
    micOn: v.boolean(),
    cameraOn: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, micOn, cameraOn }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    const session = await ownSession(
      ctx,
      meetingId,
      sessionId,
      participant.userId,
    );
    if (session.state === OPEN)
      await ctx.db.patch(session._id, {
        micOn,
        cameraOn,
        updatedAt: Date.now(),
      });
    return null;
  },
});

/**
 * Send one signal from the caller's session to another open session in the
 * same meeting. Returns delivered:false, and stores nothing, when the target
 * is not open there. Oversized fields are refused, and each session may send
 * SIGNAL_RATE_LIMIT.maxRequests signals per window.
 */
export const sendSignal = mutation({
  args: {
    meetingId: v.id("meetings"),
    fromSessionId: sessionIdV,
    toSessionId: sessionIdV,
    signal: signalV,
  },
  returns: v.object({ delivered: v.boolean() }),
  handler: async (ctx, { meetingId, fromSessionId, toSessionId, signal }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    const from = await ownSession(
      ctx,
      meetingId,
      fromSessionId,
      participant.userId,
    );
    if (from.state !== OPEN) return { delivered: false };
    checkSignalSize(signal);
    // Every attempt from an open session counts, delivered or not.
    await enforceUserLimit(
      ctx,
      signalRateAction(meetingId, fromSessionId),
      participant.userId,
      { config: SIGNAL_RATE_LIMIT, throws: true },
    );
    const to = await sessionById(ctx, meetingId, toSessionId);
    if (!to || to.state !== OPEN || to.sessionId === from.sessionId)
      return { delivered: false };
    await ctx.db.insert("webrtcSignals", {
      meetingId,
      sessionId: fromSessionId,
      fromUserId: participant.userId,
      toUserId: to.userId,
      toSessionId,
      type: signal.kind === "description" ? "sdp" : "ice",
      data:
        signal.kind === "description"
          ? { type: signal.type, sdp: signal.sdp }
          : {
              candidate: signal.candidate,
              sdpMLineIndex: signal.sdpMLineIndex,
              sdpMid: signal.sdpMid,
              usernameFragment: signal.usernameFragment,
            },
      timestamp: Date.now(),
      processed: false,
    });
    return { delivered: true };
  },
});

/** Who is in the call: one entry per open session. */
export const callPresence = query({
  args: { meetingId: v.id("meetings") },
  returns: v.array(
    v.object({
      sessionId: v.string(),
      participantId: v.string(),
      micOn: v.boolean(),
      cameraOn: v.boolean(),
    }),
  ),
  handler: async (ctx, { meetingId }) => {
    await assertMeetingAccess(ctx, meetingId);
    const open = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_and_state", (q) =>
        q.eq("meetingId", meetingId).eq("state", OPEN),
      )
      .collect();
    const out = [];
    for (const session of open) {
      const user = await ctx.db.get(session.userId);
      if (!user) continue;
      out.push({
        sessionId: session.sessionId,
        participantId: user.workosUserId,
        micOn: session.micOn ?? true,
        cameraOn: session.cameraOn ?? true,
      });
    }
    return out;
  },
});

/** Unread signals addressed to the caller's own session, oldest first. */
export const signalsForSession = query({
  args: { meetingId: v.id("meetings"), sessionId: sessionIdV },
  returns: v.array(
    v.object({
      _id: v.id("webrtcSignals"),
      fromSessionId: v.string(),
      fromParticipantId: v.string(),
      signal: signalV,
    }),
  ),
  handler: async (ctx, { meetingId, sessionId }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    await ownSession(ctx, meetingId, sessionId, participant.userId);
    const rows = await ctx.db
      .query("webrtcSignals")
      .withIndex("by_target_session_and_processed", (q) =>
        q.eq("toSessionId", sessionId).eq("processed", false),
      )
      .order("asc")
      .take(100);
    const workosIds = new Map<Id<"users">, string>();
    const out = [];
    for (const row of rows) {
      if (row.meetingId !== meetingId) continue;
      if (!workosIds.has(row.fromUserId)) {
        workosIds.set(
          row.fromUserId,
          (await ctx.db.get(row.fromUserId))?.workosUserId ?? "",
        );
      }
      const data = row.data;
      out.push({
        _id: row._id,
        fromSessionId: row.sessionId,
        fromParticipantId: workosIds.get(row.fromUserId) ?? "",
        signal:
          "sdp" in data
            ? { kind: "description" as const, type: data.type, sdp: data.sdp }
            : {
                kind: "candidate" as const,
                candidate: data.candidate,
                sdpMLineIndex: data.sdpMLineIndex,
                sdpMid: data.sdpMid,
                usernameFragment: data.usernameFragment,
              },
      });
    }
    return out;
  },
});

/** Mark signals read; only signals addressed to the caller's own session. */
export const ackSignals = mutation({
  args: {
    meetingId: v.id("meetings"),
    sessionId: sessionIdV,
    signalIds: v.array(v.id("webrtcSignals")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId, signalIds }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    await ownSession(ctx, meetingId, sessionId, participant.userId);
    for (const id of signalIds.slice(0, 200)) {
      const signal = await ctx.db.get(id);
      if (
        signal &&
        signal.toSessionId === sessionId &&
        signal.meetingId === meetingId &&
        !signal.processed
      ) {
        await ctx.db.patch(id, { processed: true });
      }
    }
    return null;
  },
});

/** Cron: close sessions whose heartbeat stopped, in meetings nobody else heartbeats. */
export const sweepStaleSessions = internalMutation({
  args: {},
  returns: v.object({ closed: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_state", (q) => q.eq("state", OPEN))
      .take(500);
    let closed = 0;
    for (const session of open) {
      if (
        (session.lastHeartbeatAt ?? session.updatedAt) <
        now - HEARTBEAT_EXPIRY_MS
      ) {
        await close(ctx, session, "expired", now);
        closed++;
      }
    }
    return { closed };
  },
});
