/**
 * Call mesh signaling (convex/meetings/webrtc/mesh.ts): who may use it, how
 * signals are addressed, and how sessions end.
 */
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestEnvironment } from "../../../test/convex/helpers";
import {
  HEARTBEAT_EXPIRY_MS,
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
let as: Record<"A" | "B" | "O", ReturnType<Env["withIdentity"]>>;

async function addMeeting(
  state: "active" | "scheduled",
): Promise<Id<"meetings">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const users: Record<string, Id<"users">> = {};
    for (const k of ["a", "b", "o"]) {
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
      participantCount: 2,
      webrtcEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const [k, role] of [
      ["a", "host"],
      ["b", "participant"],
    ] as const) {
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
  t = createTestEnvironment();
  meetingId = await addMeeting("active");
  const who = (k: string) =>
    t.withIdentity({
      subject: `mesh-${k}`,
      email: `${k}@mesh.test`,
      name: k.toUpperCase(),
    });
  as = { A: who("a"), B: who("b"), O: who("o") };
});

const join = (p: "A" | "B" | "O", sessionId: string) =>
  as[p].mutation(api.meetings.webrtc.mesh.joinCall, { meetingId, sessionId });

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
        },
        {
          sessionId: "session-b-1",
          participantId: "mesh-b",
          micOn: false,
          cameraOn: true,
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

  afterEach(() => vi.useRealTimers());

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
    vi.useFakeTimers({ toFake: ["Date"] });
    // Start of a window, so the whole burst falls inside one.
    vi.setSystemTime(
      Math.ceil(Date.now() / SIGNAL_RATE_LIMIT.windowMs) *
        SIGNAL_RATE_LIMIT.windowMs,
    );
    await join("A", "session-a-1");
    await join("B", "session-b-1");
    for (let i = 0; i < SIGNAL_RATE_LIMIT.maxRequests; i++) {
      await send("A", "session-a-1", "session-b-1", candidate);
    }
    await expect(
      send("A", "session-a-1", "session-b-1", candidate),
    ).rejects.toThrow(/Rate limit exceeded/);
    // Attempts at a target that is not open count too.
    await expect(
      send("A", "session-a-1", "session-nobody", candidate),
    ).rejects.toThrow(/Rate limit exceeded/);
    expect(await stored()).toHaveLength(SIGNAL_RATE_LIMIT.maxRequests);
    expect(await send("B", "session-b-1", "session-a-1", candidate)).toEqual({
      delivered: true,
    });

    vi.setSystemTime(Date.now() + SIGNAL_RATE_LIMIT.windowMs);
    // Keep A open across the window (its heartbeat would otherwise lapse).
    await as.A.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-a-1",
    });
    await as.B.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-b-1",
    });
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
