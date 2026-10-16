/**
 * Call mesh signaling (convex/meetings/webrtc/mesh.ts): who may use it, how
 * signals are addressed, and how sessions end.
 */
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestEnvironment } from "../../../test/convex/helpers";
import { CLEANUP_BATCH } from "./signaling";

/** CLEANUP_BATCH, spelled out so this file also runs against the code before it existed. */
const BATCH = 500;
/** MAX_CALL_SESSIONS, spelled out for the same reason. */
const FULL = 4;
import {
  HEARTBEAT_EXPIRY_MS,
  MAX_CALL_SESSIONS,
  SIGNAL_QUEUE_LIMIT,
  SIGNAL_RATE_LIMIT,
  SIGNAL_SIZE_LIMITS,
} from "./mesh";

type Env = ReturnType<typeof createTestEnvironment>;

const offer = {
  kind: "description" as const,
  type: "offer" as const,
  sdp: "v=0 offer",
};
const candidate = {
  kind: "candidate" as const,
  candidate: "candidate:1 1 udp 1 127.0.0.1 9 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};

let t: Env;
let meetingId: Id<"meetings">;
type Who = "A" | "B" | "C" | "D" | "E" | "O";
let as: Record<Who, ReturnType<Env["withIdentity"]>>;
const PEOPLE = ["a", "b", "c", "d", "e", "o"];

/** A meeting whose first member is the host; by default A and B. */
async function addMeeting(
  state: "active" | "scheduled",
  members: string[] = ["a", "b"],
): Promise<Id<"meetings">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const users: Record<string, Id<"users">> = {};
    for (const k of PEOPLE) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", `mesh-${k}`))
        .unique();
      users[k] =
        existing?._id ??
        (await ctx.db.insert("users", {
          workosUserId: `mesh-${k}`,
          email: `${k}@mesh.test`,
          displayName: k.toUpperCase(),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }));
    }
    const id = await ctx.db.insert("meetings", {
      organizerId: users.a,
      title: "Mesh test",
      state,
      participantCount: members.length,
      webrtcEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const [i, k] of members.entries()) {
      const role = i === 0 ? ("host" as const) : ("participant" as const);
      await ctx.db.insert("meetingParticipants", {
        meetingId: id,
        userId: users[k],
        role,
        presence: "joined",
        createdAt: now,
      });
    }
    return id;
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  t = createTestEnvironment();
  meetingId = await addMeeting("active");
  const who = (k: string) =>
    t.withIdentity({
      subject: `mesh-${k}`,
      email: `${k}@mesh.test`,
      name: k.toUpperCase(),
    });
  as = {
    A: who("a"),
    B: who("b"),
    C: who("c"),
    D: who("d"),
    E: who("e"),
    O: who("o"),
  };
});

afterEach(async () => {
  await t.finishInProgressScheduledFunctions();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const join = (p: Who, sessionId: string, inMeeting = meetingId) =>
  as[p].mutation(api.meetings.webrtc.mesh.joinCall, {
    meetingId: inMeeting,
    sessionId,
  });
type SignalArg = FunctionArgs<
  typeof api.meetings.webrtc.mesh.sendSignal
>["signal"];
const sendIn = (
  inMeeting: Id<"meetings">,
  p: Who,
  from: string,
  to: string,
  signal: SignalArg,
) =>
  as[p].mutation(api.meetings.webrtc.mesh.sendSignal, {
    meetingId: inMeeting,
    fromSessionId: from,
    toSessionId: to,
    signal,
  });
const sessionRow = (sessionId: string, inMeeting = meetingId) =>
  t.run((ctx) =>
    ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting_and_session", (q) =>
        q.eq("meetingId", inMeeting).eq("sessionId", sessionId),
      )
      .unique(),
  );

describe("access", () => {
  test("an outsider is refused by every public function", async () => {
    await join("A", "session-a-1");
    const refused = /Not a meeting participant/;
    await expect(join("O", "session-o-1")).rejects.toThrow(refused);
    await expect(
      as.O.query(api.meetings.webrtc.mesh.callPresence, { meetingId }),
    ).rejects.toThrow(refused);
    await expect(
      as.O.mutation(api.meetings.webrtc.mesh.sendSignal, {
        meetingId,
        fromSessionId: "session-o-1",
        toSessionId: "session-a-1",
        signal: offer,
      }),
    ).rejects.toThrow(refused);
    await expect(
      as.O.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "session-a-1",
      }),
    ).rejects.toThrow(refused);
    await expect(
      as.O.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-a-1",
      }),
    ).rejects.toThrow(refused);
    await expect(
      as.O.mutation(api.meetings.webrtc.mesh.leaveCall, {
        meetingId,
        sessionId: "session-a-1",
      }),
    ).rejects.toThrow(refused);
    await expect(
      as.O.mutation(api.meetings.webrtc.mesh.setMediaState, {
        meetingId,
        sessionId: "session-a-1",
        micOn: false,
        cameraOn: false,
      }),
    ).rejects.toThrow(refused);
    await expect(
      as.O.mutation(api.meetings.webrtc.mesh.ackSignals, {
        meetingId,
        sessionId: "session-a-1",
        signalIds: [],
      }),
    ).rejects.toThrow(refused);
  });

  test("a signed-out caller is refused", async () => {
    await expect(
      t.mutation(api.meetings.webrtc.mesh.joinCall, {
        meetingId,
        sessionId: "session-x-1",
      }),
    ).rejects.toThrow(/Authentication required/);
  });

  test("a participant cannot use another participant's session", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    const notYours = /not your call session/;
    await expect(
      as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
        meetingId,
        fromSessionId: "session-b-1",
        toSessionId: "session-a-1",
        signal: offer,
      }),
    ).rejects.toThrow(notYours);
    await expect(
      as.A.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "session-b-1",
      }),
    ).rejects.toThrow(notYours);
    await expect(
      as.A.mutation(api.meetings.webrtc.mesh.leaveCall, {
        meetingId,
        sessionId: "session-b-1",
      }),
    ).rejects.toThrow(notYours);
    await expect(join("A", "session-b-1")).rejects.toThrow(notYours);
  });

  test("a meeting that is not active cannot be joined", async () => {
    meetingId = await addMeeting("scheduled");
    await expect(join("A", "session-a-9")).rejects.toThrow(/not active/);
  });
});

describe("addressing", () => {
  test("a signal reaches only the session it is addressed to, until acknowledged", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    const sent = await as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: "session-a-1",
      toSessionId: "session-b-1",
      signal: candidate,
    });
    expect(sent).toEqual({ delivered: true });

    const forB = await as.B.query(api.meetings.webrtc.mesh.signalsForSession, {
      meetingId,
      sessionId: "session-b-1",
    });
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({
      fromSessionId: "session-a-1",
      fromParticipantId: "mesh-a",
      signal: candidate,
    });
    expect(
      await as.A.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "session-a-1",
      }),
    ).toEqual([]);

    // A cannot acknowledge B's signal; B can.
    await as.A.mutation(api.meetings.webrtc.mesh.ackSignals, {
      meetingId,
      sessionId: "session-a-1",
      signalIds: [forB[0]._id],
    });
    expect(
      await as.B.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "session-b-1",
      }),
    ).toHaveLength(1);
    await as.B.mutation(api.meetings.webrtc.mesh.ackSignals, {
      meetingId,
      sessionId: "session-b-1",
      signalIds: [forB[0]._id],
    });
    expect(
      await as.B.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "session-b-1",
      }),
    ).toEqual([]);
  });

  test("a signal to a session that is not open stores nothing", async () => {
    await join("A", "session-a-1");
    const before = await t.run((ctx) =>
      ctx.db.query("webrtcSignals").collect(),
    );
    const unknown = await as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: "session-a-1",
      toSessionId: "session-nobody",
      signal: offer,
    });
    const toSelf = await as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: "session-a-1",
      toSessionId: "session-a-1",
      signal: offer,
    });
    expect(unknown).toEqual({ delivered: false });
    expect(toSelf).toEqual({ delivered: false });
    expect(
      await t.run((ctx) => ctx.db.query("webrtcSignals").collect()),
    ).toHaveLength(before.length);
  });

  test("a reload replaces the old session: it stops, and its unread signals are dropped", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-old");
    await as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: "session-a-1",
      toSessionId: "session-b-old",
      signal: offer,
    });
    await join("B", "session-b-new");

    expect(
      await as.B.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-b-old",
      }),
    ).toEqual({
      alive: false,
      reason: "replaced",
    });
    expect(
      await as.B.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "session-b-old",
      }),
    ).toEqual([]);
    expect(
      await as.B.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "session-b-new",
      }),
    ).toEqual([]);
    const presence = await as.A.query(api.meetings.webrtc.mesh.callPresence, {
      meetingId,
    });
    expect(presence.map((p) => p.sessionId).sort()).toEqual([
      "session-a-1",
      "session-b-new",
    ]);
    const late = await as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: "session-a-1",
      toSessionId: "session-b-old",
      signal: offer,
    });
    expect(late).toEqual({ delivered: false });
  });

  test("closing a session leaves signals for a same-named session in another meeting unread", async () => {
    await join("A", "session-a-1");
    await join("B", "shared-session");
    await as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: "session-a-1",
      toSessionId: "shared-session",
      signal: offer,
    });
    const other = await addMeeting("active");
    await as.B.mutation(api.meetings.webrtc.mesh.joinCall, {
      meetingId: other,
      sessionId: "shared-session",
    });
    await as.B.mutation(api.meetings.webrtc.mesh.leaveCall, {
      meetingId: other,
      sessionId: "shared-session",
    });
    expect(
      await as.B.query(api.meetings.webrtc.mesh.signalsForSession, {
        meetingId,
        sessionId: "shared-session",
      }),
    ).toHaveLength(1);
  });
});

describe("presence and media state", () => {
  test("presence lists open sessions with their announced mic and camera state", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await as.B.mutation(api.meetings.webrtc.mesh.setMediaState, {
      meetingId,
      sessionId: "session-b-1",
      micOn: false,
      cameraOn: true,
    });
    const presence = await as.A.query(api.meetings.webrtc.mesh.callPresence, {
      meetingId,
    });
    expect(presence).toEqual(
      expect.arrayContaining([
        {
          sessionId: "session-a-1",
          participantId: "mesh-a",
          micOn: true,
          cameraOn: true,
          screenSharing: false,
        },
        {
          sessionId: "session-b-1",
          participantId: "mesh-b",
          micOn: false,
          cameraOn: true,
          screenSharing: false,
        },
      ]),
    );
  });

  test("leaving closes the session with reason left", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await as.B.mutation(api.meetings.webrtc.mesh.leaveCall, {
      meetingId,
      sessionId: "session-b-1",
    });
    expect(
      (
        await as.A.query(api.meetings.webrtc.mesh.callPresence, { meetingId })
      ).map((p) => p.sessionId),
    ).toEqual(["session-a-1"]);
    const row = await t.run((ctx) =>
      ctx.db
        .query("webrtcSessions")
        .withIndex("by_meeting_and_session", (q) =>
          q.eq("meetingId", meetingId).eq("sessionId", "session-b-1"),
        )
        .unique(),
    );
    expect(row).toMatchObject({ state: "closed", closedReason: "left" });
  });
});

describe("heartbeats and cleanup", () => {
  async function ageSession(sessionId: string, byMs: number) {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("webrtcSessions")
        .withIndex("by_meeting_and_session", (q) =>
          q.eq("meetingId", meetingId).eq("sessionId", sessionId),
        )
        .unique();
      if (row)
        await ctx.db.patch(row._id, {
          lastHeartbeatAt: Date.now() - byMs,
          updatedAt: Date.now() - byMs,
        });
    });
  }

  test("a participant's heartbeat closes a peer whose heartbeat stopped", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await ageSession("session-b-1", HEARTBEAT_EXPIRY_MS + 1000);
    expect(
      await as.A.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-a-1",
      }),
    ).toEqual({ alive: true });
    expect(
      (
        await as.A.query(api.meetings.webrtc.mesh.callPresence, { meetingId })
      ).map((p) => p.participantId),
    ).toEqual(["mesh-a"]);
    expect(
      await as.B.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-b-1",
      }),
    ).toEqual({
      alive: false,
      reason: "expired",
    });
  });

  test("a fresh heartbeat keeps a session open", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await ageSession("session-b-1", HEARTBEAT_EXPIRY_MS - 3000);
    await as.A.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-a-1",
    });
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callPresence, { meetingId }),
    ).toHaveLength(2);
  });

  test("the cron closes stale sessions when nobody else heartbeats", async () => {
    await join("A", "session-a-1");
    await ageSession("session-a-1", HEARTBEAT_EXPIRY_MS + 1000);
    expect(
      await t.mutation(internal.meetings.webrtc.mesh.sweepStaleSessions, {}),
    ).toEqual({ closed: 1 });
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callPresence, { meetingId }),
    ).toEqual([]);
  });

  test("cleanup deletes old signals even when nobody read them", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await as.A.mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: "session-a-1",
      toSessionId: "session-b-1",
      signal: offer,
    });
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("webrtcSignals").collect())
        await ctx.db.patch(row._id, {
          timestamp: Date.now() - 2 * 60 * 60 * 1000,
        });
    });
    const result = await t.mutation(
      internal.meetings.webrtc.signaling.cleanupOldWebRTCData,
      { olderThanMs: 60 * 60 * 1000 },
    );
    expect(result.signalsDeleted).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.query("webrtcSignals").collect()),
    ).toEqual([]);
  });
});

describe("sendSignal limits", () => {
  const send = (
    p: "A" | "B",
    from: string,
    to: string,
    signal: FunctionArgs<typeof api.meetings.webrtc.mesh.sendSignal>["signal"],
  ) =>
    as[p].mutation(api.meetings.webrtc.mesh.sendSignal, {
      meetingId,
      fromSessionId: from,
      toSessionId: to,
      signal,
    });
  const stored = () => t.run((ctx) => ctx.db.query("webrtcSignals").collect());

  test("oversized SDP and candidate fields are refused and nothing is stored", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    const long = (n: number) => "x".repeat(n + 1);
    await expect(
      send("A", "session-a-1", "session-b-1", {
        ...offer,
        sdp: long(SIGNAL_SIZE_LIMITS.sdp),
      }),
    ).rejects.toThrow(/sdp is longer than/);
    await expect(
      send("A", "session-a-1", "session-b-1", {
        ...candidate,
        candidate: long(SIGNAL_SIZE_LIMITS.candidate),
      }),
    ).rejects.toThrow(/candidate is longer than/);
    await expect(
      send("A", "session-a-1", "session-b-1", {
        ...candidate,
        sdpMid: long(SIGNAL_SIZE_LIMITS.sdpMid),
      }),
    ).rejects.toThrow(/sdpMid is longer than/);
    await expect(
      send("A", "session-a-1", "session-b-1", {
        ...candidate,
        usernameFragment: long(SIGNAL_SIZE_LIMITS.usernameFragment),
      }),
    ).rejects.toThrow(/usernameFragment is longer than/);
    expect(await stored()).toEqual([]);
    // At the limit is fine.
    expect(
      await send("A", "session-a-1", "session-b-1", {
        ...offer,
        sdp: "x".repeat(SIGNAL_SIZE_LIMITS.sdp),
      }),
    ).toEqual({ delivered: true });
  });

  test("a session is limited per window, other sessions are not, and the next window resets it", async () => {
    vi.useFakeTimers();
    // Start of a window, so the whole burst falls inside one.
    vi.setSystemTime(
      Math.ceil(Date.now() / SIGNAL_RATE_LIMIT.windowMs) *
        SIGNAL_RATE_LIMIT.windowMs,
    );
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    // Attempts at a target that is not open count too (and keep B's queue,
    // which has its own cap, out of this test).
    for (let i = 0; i < SIGNAL_RATE_LIMIT.maxRequests; i++) {
      await send("A", "session-a-1", "session-nobody", candidate);
    }
    await expect(
      send("A", "session-a-1", "session-b-1", candidate),
    ).rejects.toThrow(/Rate limit exceeded/);
    expect(await stored()).toHaveLength(0);
    expect(await send("B", "session-b-1", "session-a-1", candidate)).toEqual({
      delivered: true,
    });

    vi.setSystemTime(Date.now() + SIGNAL_RATE_LIMIT.windowMs - 1);
    // Keep A open across the window (its heartbeat would otherwise lapse).
    await as.A.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-a-1",
    });
    await as.B.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-b-1",
    });
    vi.setSystemTime(Date.now() + 1);
    expect(await send("A", "session-a-1", "session-b-1", candidate)).toEqual({
      delivered: true,
    });
  });

  test("closing a session deletes its rate-limit counters", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await send("A", "session-a-1", "session-b-1", candidate);
    const counters = () => t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(await counters()).toHaveLength(1);
    await as.A.mutation(api.meetings.webrtc.mesh.leaveCall, {
      meetingId,
      sessionId: "session-a-1",
    });
    expect(await counters()).toEqual([]);
  });
});

/*
 * Fixes from the security review of 56be5af. Each test failed against that
 * commit (see the PR body for the run).
 */
describe("review fixes", () => {
  test("B1: a participant cannot mark another participant's session failed", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await expect(
      as.B.action(api.meetings.webrtc.rooms.handleConnectionFailure, {
        meetingId,
        sessionId: "session-a-1",
        errorType: "ice_failed",
      }),
    ).rejects.toThrow(/not your call session/);
    expect((await sessionRow("session-a-1"))?.state).toBe("connected");
    // The owner still can.
    await as.A.action(api.meetings.webrtc.rooms.handleConnectionFailure, {
      meetingId,
      sessionId: "session-a-1",
      errorType: "ice_failed",
    });
    expect((await sessionRow("session-a-1"))?.state).toBe("failed");
  });

  test("B2: signals for a same-named session in another meeting cannot bury a session's own", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    // In another meeting, O opens a session with B's id and A fills it.
    const other = await addMeeting("active", ["o", "a"]);
    await join("O", "session-b-1", other);
    await join("A", "session-a-2", other);
    // 100 was the old read's page size; it is also the queue cap now.
    for (let i = 0; i < 100; i++) {
      await sendIn(other, "A", "session-a-2", "session-b-1", candidate);
    }
    await sendIn(meetingId, "A", "session-a-1", "session-b-1", offer);
    const forB = await as.B.query(api.meetings.webrtc.mesh.signalsForSession, {
      meetingId,
      sessionId: "session-b-1",
    });
    expect(forB.map((r) => r.signal)).toEqual([offer]);
  });

  test("B3: a recipient's unread queue is bounded and refuses with a named error when full", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    for (let i = 0; i < SIGNAL_QUEUE_LIMIT; i++) {
      await sendIn(meetingId, "A", "session-a-1", "session-b-1", candidate);
    }
    await expect(
      sendIn(meetingId, "A", "session-a-1", "session-b-1", candidate),
    ).rejects.toThrow(/signal queue is full/);
    const queued = await as.B.query(
      api.meetings.webrtc.mesh.signalsForSession,
      { meetingId, sessionId: "session-b-1" },
    );
    await as.B.mutation(api.meetings.webrtc.mesh.ackSignals, {
      meetingId,
      sessionId: "session-b-1",
      signalIds: [queued[0]._id],
    });
    expect(
      await sendIn(meetingId, "A", "session-a-1", "session-b-1", candidate),
    ).toEqual({ delivered: true });
  });

  test("S4: a call holds at most MAX_CALL_SESSIONS people", async () => {
    meetingId = await addMeeting("active", ["a", "b", "c", "d", "e"]);
    const who: Who[] = ["A", "B", "C", "D", "E"];
    for (const p of who.slice(0, FULL)) {
      await join(p, `session-${p.toLowerCase()}-1`);
    }
    await expect(join(who[FULL], "session-x-1")).rejects.toThrow(
      /call is full/,
    );
    // Rejoining from a new tab is not a new person.
    await join("A", "session-a-2");
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callPresence, { meetingId }),
    ).toHaveLength(FULL);
    expect(MAX_CALL_SESSIONS).toBe(FULL);
  });

  test("S4: a session keeps rate-limit counters only for its current window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(
      Math.ceil(Date.now() / SIGNAL_RATE_LIMIT.windowMs) *
        SIGNAL_RATE_LIMIT.windowMs,
    );
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    for (let w = 0; w < 3; w++) {
      await as.A.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-a-1",
      });
      await as.B.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-b-1",
      });
      await sendIn(meetingId, "A", "session-a-1", "session-b-1", candidate);
      vi.setSystemTime(Date.now() + SIGNAL_RATE_LIMIT.windowMs);
    }
    expect(
      await t.run((ctx) => ctx.db.query("rateLimits").collect()),
    ).toHaveLength(1);
  });

  test("S5: cleanup deletes one batch per run and schedules the rest", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await join("A", "session-a-1");
    const old = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const a = (await sessionRow("session-a-1"))!;
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 1; i++) {
        await ctx.db.insert("webrtcSignals", {
          meetingId,
          sessionId: "session-a-1",
          fromUserId: a.userId,
          toSessionId: "gone-session",
          type: "ice",
          data: { candidate: "c" },
          timestamp: old,
          processed: false,
        });
      }
      for (let i = 0; i < BATCH + 1; i++) {
        await ctx.db.insert("webrtcSessions", {
          meetingId,
          sessionId: `old-session-${i}`,
          userId: a.userId,
          state: "closed",
          createdAt: old,
          updatedAt: old,
        });
      }
    });
    const count = () =>
      t.run(async (ctx) => ({
        signals: (await ctx.db.query("webrtcSignals").collect()).length,
        sessions: (await ctx.db.query("webrtcSessions").collect()).length,
      }));
    expect(
      await t.mutation(
        internal.meetings.webrtc.signaling.cleanupOldWebRTCData,
        {},
      ),
    ).toEqual({
      signalsDeleted: BATCH,
      sessionsDeleted: BATCH,
    });
    // One run is bounded; the rest waits for the scheduled continuation.
    expect(await count()).toEqual({ signals: 1, sessions: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await count()).toEqual({ signals: 0, sessions: 1 });
    expect(CLEANUP_BATCH).toBe(BATCH);
  }, 60_000);

  test("S6: the stale sweep finds an expired session behind many live ones", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await join("A", "session-a-1");
    const now = Date.now();
    const a = (await sessionRow("session-a-1"))!;
    await t.run(async (ctx) => {
      // More than the old sweep's 500-row read.
      for (let i = 0; i < 501; i++) {
        await ctx.db.insert("webrtcSessions", {
          meetingId,
          sessionId: `live-session-${i}`,
          userId: a.userId,
          state: "connected",
          lastHeartbeatAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      // Created last, stale.
      await ctx.db.insert("webrtcSessions", {
        meetingId,
        sessionId: "stale-session",
        userId: a.userId,
        state: "connected",
        lastHeartbeatAt: now - HEARTBEAT_EXPIRY_MS - 5000,
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.mutation(internal.meetings.webrtc.mesh.sweepStaleSessions, {});
    await vi.advanceTimersByTimeAsync(0);
    await t.finishInProgressScheduledFunctions();
    expect((await sessionRow("stale-session"))?.state).toBe("closed");
    expect((await sessionRow("live-session-0"))?.state).toBe("connected");
  }, 60_000);

  test("S8: ending the meeting closes its call sessions", async () => {
    // endMeeting schedules follow-up work this test does not run.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await as.A.mutation(api.meetings.lifecycle.endMeeting, { meetingId });
    expect(await sessionRow("session-a-1")).toMatchObject({
      state: "closed",
      closedReason: "ended",
    });
    expect((await sessionRow("session-b-1"))?.state).toBe("closed");
  });

  test("S8: a concluded meeting refuses heartbeats and signals", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await t.run((ctx) => ctx.db.patch(meetingId, { state: "concluded" }));
    expect(
      await as.A.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-a-1",
      }),
    ).toEqual({ alive: false, reason: "ended" });
    await expect(
      sendIn(meetingId, "B", "session-b-1", "session-a-1", offer),
    ).rejects.toThrow(/not active/);
  });
});

describe("call lifecycle", () => {
  const state = () =>
    t.run((ctx) =>
      ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique(),
    );
  const leave = (who: Who, sessionId: string) =>
    as[who].mutation(api.meetings.webrtc.mesh.leaveCall, {
      meetingId,
      sessionId,
    });

  test("starts at the second present person, ends at the last leave and keeps the original times", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    await join("A", "session-a-1");
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callStatus, { meetingId }),
    ).toBe("active");
    expect(await state()).toBeNull();
    vi.setSystemTime(105000);
    await join("B", "session-b-1");
    expect(await state()).toMatchObject({ active: true, startedAt: 105000 });
    vi.setSystemTime(108000);
    await leave("A", "session-a-1");
    expect(
      await as.B.query(api.meetings.webrtc.mesh.callStatus, { meetingId }),
    ).toBe("active");
    vi.setSystemTime(109000);
    await leave("B", "session-b-1");
    expect(await state()).toMatchObject({
      active: false,
      startedAt: 105000,
      endedAt: 109000,
    });
    vi.setSystemTime(110000);
    await leave("B", "session-b-1");
    expect(await state()).toMatchObject({ startedAt: 105000, endedAt: 109000 });
    expect(
      await as.B.query(api.meetings.webrtc.mesh.callStatus, { meetingId }),
    ).toBe("ended");
  });

  test("scheduled expiry ends an abandoned call with no surviving heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(200000);
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await vi.advanceTimersByTimeAsync(10000);
    await t.finishInProgressScheduledFunctions();
    expect(await state()).toMatchObject({
      active: false,
      startedAt: 200000,
      endedAt: 210000,
    });
    expect(await sessionRow("session-a-1")).toMatchObject({
      state: "closed",
      closedReason: "expired",
    });
    expect(await sessionRow("session-b-1")).toMatchObject({
      state: "closed",
      closedReason: "expired",
    });
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callStatus, { meetingId }),
    ).toBe("ended");
  });

  test("fresh heartbeat reschedules expiry, and replacing a sole tab does not end the call", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(300000);
    await join("A", "session-a-old");
    await join("A", "session-a-new");
    await vi.advanceTimersByTimeAsync(8000);
    await as.A.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-a-new",
    });
    await vi.advanceTimersByTimeAsync(2000);
    await t.finishInProgressScheduledFunctions();
    expect(await sessionRow("session-a-new")).toMatchObject({
      state: "connected",
      lastHeartbeatAt: 308000,
    });
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callStatus, { meetingId }),
    ).toBe("active");
    await vi.advanceTimersByTimeAsync(8000);
    await t.finishInProgressScheduledFunctions();
    expect(await state()).toMatchObject({ active: false, endedAt: 318000 });
    expect((await state())?.startedAt).toBeUndefined();
  });

  test("the final explicit leave also expires abandoned peers before ending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(400000);
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    vi.setSystemTime(411000);
    await leave("A", "session-a-1");
    expect(await state()).toMatchObject({
      startedAt: 400000,
      endedAt: 411000,
      active: false,
    });
    expect(await sessionRow("session-b-1")).toMatchObject({
      closedReason: "expired",
    });
  });

  test("an ended meeting rejects new and reused sessions with the ended reason", async () => {
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    await leave("A", "session-a-1");
    await leave("B", "session-b-1");
    await expect(join("A", "session-a-new")).rejects.toThrow(
      /This call has ended/,
    );
    await expect(join("B", "session-b-1")).rejects.toThrow(
      /This call has ended/,
    );
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callStatus, { meetingId }),
    ).toBe("ended");
    expect(
      await as.A.query(api.meetings.webrtc.mesh.callPresence, { meetingId }),
    ).toEqual([]);
  });
});
