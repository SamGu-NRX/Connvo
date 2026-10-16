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
 *
 * Every read is bounded: a call holds at most MAX_CALL_SESSIONS open
 * sessions, a session's unread queue at most SIGNAL_QUEUE_LIMIT signals, and
 * the cron sweeps work in batches that schedule their own continuation.
 */

import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "@convex/_generated/api";
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
import { finishMeeting, recordCallStart } from "../presenceLifecycle";

/** A session with no heartbeat for this long is closed as expired. */
export const HEARTBEAT_EXPIRY_MS = 10_000;
/** Sessions in this state are in the call. */
const OPEN = "connected" as const;

/**
 * Open sessions one call may hold: the call room shows two to four people
 * (src/components/call/CallRoom.tsx), and a P2P mesh is built for that size.
 */
export const MAX_CALL_SESSIONS = 4;
/**
 * Most open sessions a lookup reads in one meeting. Above MAX_CALL_SESSIONS
 * so that sessions from before the cap, or a join racing a sweep, are still
 * seen and can be closed.
 */
const OPEN_SCAN = MAX_CALL_SESSIONS * 2;

/**
 * Unread signals one session may have waiting. The adapter acknowledges
 * signals as they arrive, so a healthy queue holds a burst of ICE candidates
 * at most; a full one means the recipient stopped reading. It is also the
 * page size of signalsForSession.
 */
export const SIGNAL_QUEUE_LIMIT = 100;

/** Rows the stale-session sweep closes per run before scheduling another. */
const SWEEP_BATCH = 200;

type CloseReason = "left" | "replaced" | "expired" | "ended";

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

/** The meeting, if it is active; calls exist only in active meetings. */
async function activeMeeting(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
): Promise<Doc<"meetings"> | null> {
  const meeting = await ctx.db.get(meetingId);
  return meeting && meeting.state === "active" ? meeting : null;
}

/** Open sessions in a meeting, at most OPEN_SCAN of them. */
function openSessions(ctx: QueryCtx | MutationCtx, meetingId: Id<"meetings">) {
  return ctx.db
    .query("webrtcSessions")
    .withIndex("by_meeting_and_state", (q) =>
      q.eq("meetingId", meetingId).eq("state", OPEN),
    )
    .take(OPEN_SCAN);
}

/** Unread signals addressed to one session in one meeting, oldest first. */
function unreadSignals(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
  sessionId: string,
) {
  return ctx.db
    .query("webrtcSignals")
    .withIndex("by_meeting_target_session_and_processed", (q) =>
      q
        .eq("meetingId", meetingId)
        .eq("toSessionId", sessionId)
        .eq("processed", false),
    )
    .order("asc")
    .take(SIGNAL_QUEUE_LIMIT);
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
  reason: CloseReason,
  now: number,
): Promise<void> {
  await ctx.db.patch(session._id, {
    state: "closed",
    closedReason: reason,
    updatedAt: now,
  });
  // Signals waiting for a closed session can never be read. The queue is
  // capped at SIGNAL_QUEUE_LIMIT, so this is the whole of it.
  for (const signal of await unreadSignals(
    ctx,
    session.meetingId,
    session.sessionId,
  )) {
    await ctx.db.patch(signal._id, { processed: true });
  }
  // A closed session sends nothing more, so its rate-limit counter goes too
  // (sendSignal keeps only the current window's).
  const counters = await ctx.db
    .query("rateLimits")
    .withIndex("by_user_action_window", (q) =>
      q
        .eq("userId", session.userId)
        .eq("action", signalRateAction(session.meetingId, session.sessionId)),
    )
    .take(10);
  for (const counter of counters) await ctx.db.delete(counter._id);
}

/**
 * Close every open call session in a meeting, as "ended". The meeting
 * lifecycle calls this when a meeting ends or is cancelled.
 */
export async function closeMeetingSessions(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
): Promise<void> {
  const now = Date.now();
  for (const session of await openSessions(ctx, meetingId)) {
    await close(ctx, session, "ended", now);
  }
}

/** Close open sessions in this meeting whose heartbeat has stopped. */
async function sweepMeeting(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  now: number,
): Promise<void> {
  for (const session of await openSessions(ctx, meetingId)) {
    if (
      (session.lastHeartbeatAt ?? session.updatedAt) <=
      now - HEARTBEAT_EXPIRY_MS
    ) {
      await close(ctx, session, "expired", now);
    }
  }
}

/** End once all sessions have closed; replacement is atomic with its new join. */
async function finishEmptyCall(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  now: number,
): Promise<void> {
  if ((await openSessions(ctx, meetingId)).length === 0) {
    await finishMeeting(ctx, meetingId, now);
  }
}

/** One scheduled check per live session, renewed from the latest heartbeat. */
export const expireSession = internalMutation({
  args: { meetingId: v.id("meetings"), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { meetingId, sessionId }): Promise<null> => {
    const session = await sessionById(ctx, meetingId, sessionId);
    if (!session || session.state !== OPEN) return null;
    const now = Date.now();
    const expiresAt =
      (session.lastHeartbeatAt ?? session.updatedAt) + HEARTBEAT_EXPIRY_MS;
    if (now < expiresAt) {
      await ctx.scheduler.runAfter(
        expiresAt - now,
        internal.meetings.webrtc.mesh.expireSession,
        { meetingId, sessionId },
      );
      return null;
    }
    await sweepMeeting(ctx, meetingId, now);
    await finishEmptyCall(ctx, meetingId, now);
    return null;
  },
});

/** Read before opening capture so ended links never show a join lobby. */
export const callStatus = query({
  args: { meetingId: v.id("meetings") },
  returns: v.union(
    v.literal("active"),
    v.literal("ended"),
    v.literal("unavailable"),
  ),
  handler: async (ctx, { meetingId }) => {
    await assertMeetingAccess(ctx, meetingId);
    const meeting = await ctx.db.get(meetingId);
    if (meeting?.state === "concluded" || meeting?.state === "cancelled")
      return "ended" as const;
    return meeting?.state === "active"
      ? ("active" as const)
      : ("unavailable" as const);
  },
});

/**
 * Join the call with a new session. Any other open session of the same user
 * in this meeting is closed as "replaced": one tab per person. A call that
 * already has MAX_CALL_SESSIONS people refuses the join.
 */
export const joinCall = mutation({
  args: { meetingId: v.id("meetings"), sessionId: sessionIdV },
  returns: v.object({ sessionId: v.string(), participantId: v.string() }),
  handler: async (ctx, { meetingId, sessionId }) => {
    const participant = await assertMeetingAccess(ctx, meetingId);
    checkSessionId(sessionId);
    const meeting = await ctx.db.get(meetingId);
    if (meeting?.state === "concluded" || meeting?.state === "cancelled") {
      throw createError.validation(
        "This call has ended. Open the recap to see what was recorded.",
        "meetingId",
      );
    }
    if (meeting?.state !== "active") {
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
      if (existing.state !== OPEN) {
        throw createError.validation(
          "This call session has closed. Join with a new session.",
          "sessionId",
        );
      }
      return { sessionId, participantId: user.workosUserId };
    }

    const mine = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_user_and_state", (q) =>
        q
          .eq("meetingId", meetingId)
          .eq("userId", participant.userId)
          .eq("state", OPEN),
      )
      .take(OPEN_SCAN);
    for (const old of mine) await close(ctx, old, "replaced", now);
    await sweepMeeting(ctx, meetingId, now);
    if ((await openSessions(ctx, meetingId)).length >= MAX_CALL_SESSIONS) {
      throw createError.validation(
        `This call is full: it already has ${MAX_CALL_SESSIONS} people`,
        "meetingId",
      );
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
    await recordCallStart(
      ctx,
      meetingId,
      (await openSessions(ctx, meetingId)).length,
      now,
    );
    await ctx.scheduler.runAfter(
      HEARTBEAT_EXPIRY_MS,
      internal.meetings.webrtc.mesh.expireSession,
      { meetingId, sessionId },
    );
    return { sessionId, participantId: user.workosUserId };
  },
});

/**
 * Keep the session open. Returns alive:false with the reason when the
 * session was closed (replaced by another tab, expired, or the meeting
 * ended), so the client stops instead of talking into a closed session.
 * Also closes other sessions in the meeting whose heartbeat stopped.
 */
export const heartbeat = mutation({
  args: { meetingId: v.id("meetings"), sessionId: sessionIdV },
  returns: v.object({
    alive: v.boolean(),
    reason: v.optional(
      v.union(
        v.literal("left"),
        v.literal("replaced"),
        v.literal("expired"),
        v.literal("ended"),
      ),
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
    if (!(await activeMeeting(ctx, meetingId))) {
      await close(ctx, session, "ended", now);
      return { alive: false, reason: "ended" as const };
    }
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
    const now = Date.now();
    if (session.state === OPEN) await close(ctx, session, "left", now);
    await sweepMeeting(ctx, meetingId, now);
    await finishEmptyCall(ctx, meetingId, now);
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
    // Optional so older clients (and the eval bench) keep working; a client
    // that shares always sends the field explicitly.
    screenSharing: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, {
    meetingId,
    sessionId,
    micOn,
    cameraOn,
    screenSharing,
  }) => {
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
        screenSharing: screenSharing ?? false,
        updatedAt: Date.now(),
      });
    return null;
  },
});

/**
 * Send one signal from the caller's session to another open session in the
 * same meeting. Returns delivered:false, and stores nothing, when the target
 * is not open there. Refused: a meeting that is not active, oversized
 * fields, more than SIGNAL_RATE_LIMIT.maxRequests signals per session per
 * window, and a target whose unread queue is full (SIGNAL_QUEUE_FULL).
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
    if (!(await activeMeeting(ctx, meetingId))) {
      throw createError.validation("This meeting is not active", "meetingId");
    }
    if (from.state !== OPEN) return { delivered: false };
    checkSignalSize(signal);
    // Every attempt from an open session counts, delivered or not.
    const action = signalRateAction(meetingId, fromSessionId);
    const { windowStart } = await enforceUserLimit(
      ctx,
      action,
      participant.userId,
      { config: SIGNAL_RATE_LIMIT, throws: true },
    );
    // Keep only the current window's counter.
    const stale = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action_window", (q) =>
        q
          .eq("userId", participant.userId)
          .eq("action", action)
          .lt("windowStartMs", windowStart),
      )
      .take(10);
    for (const counter of stale) await ctx.db.delete(counter._id);

    const to = await sessionById(ctx, meetingId, toSessionId);
    if (!to || to.state !== OPEN || to.sessionId === from.sessionId)
      return { delivered: false };
    if (
      (await unreadSignals(ctx, meetingId, toSessionId)).length >=
      SIGNAL_QUEUE_LIMIT
    ) {
      throw new ConvexError({
        code: "SIGNAL_QUEUE_FULL",
        message: `The recipient's signal queue is full (${SIGNAL_QUEUE_LIMIT} unread)`,
        statusCode: 429,
      });
    }
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
      screenSharing: v.boolean(),
    }),
  ),
  handler: async (ctx, { meetingId }) => {
    await assertMeetingAccess(ctx, meetingId);
    const out = [];
    for (const session of await openSessions(ctx, meetingId)) {
      const user = await ctx.db.get(session.userId);
      if (!user) continue;
      out.push({
        sessionId: session.sessionId,
        participantId: user.workosUserId,
        micOn: session.micOn ?? true,
        cameraOn: session.cameraOn ?? true,
        screenSharing: session.screenSharing ?? false,
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
    const workosIds = new Map<Id<"users">, string>();
    const out = [];
    for (const row of await unreadSignals(ctx, meetingId, sessionId)) {
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
    for (const id of signalIds.slice(0, SIGNAL_QUEUE_LIMIT)) {
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

/**
 * Cron: close sessions whose heartbeat stopped, in meetings nobody else
 * heartbeats. Reads only expired sessions, oldest heartbeat first (sessions
 * from before heartbeats sort first, and are closed too), SWEEP_BATCH at a
 * time; a full batch schedules the next.
 */
export const sweepStaleSessions = internalMutation({
  args: {},
  returns: v.object({ closed: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_state_and_heartbeat", (q) =>
        q.eq("state", OPEN).lt("lastHeartbeatAt", now - HEARTBEAT_EXPIRY_MS),
      )
      .take(SWEEP_BATCH);
    for (const session of stale) await close(ctx, session, "expired", now);
    for (const meetingId of new Set(
      stale.map((session) => session.meetingId),
    )) {
      await finishEmptyCall(ctx, meetingId, now);
    }
    if (stale.length === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.meetings.webrtc.mesh.sweepStaleSessions,
        {},
      );
    }
    return { closed: stale.length };
  },
});
