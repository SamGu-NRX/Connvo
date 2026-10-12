// @vitest-environment node
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  convexSignaling,
  HEARTBEAT_MS,
  UNKNOWN_SENDER_HOLD_MS,
  type ConvexCallClient,
} from "./convex-signaling";
import type { SignalingHandlers } from "./signaling";

/** A Convex client stand-in: mutations by function name, watched queries the test pushes. */
function fakeClient() {
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const results: Record<string, unknown> = {};
  const listeners = new Map<string, Set<() => void>>();
  const queryValues = new Map<string, unknown>();
  const client: ConvexCallClient = {
    async mutation(ref, args) {
      const name = getFunctionName(ref as never);
      mutations.push({ name, args });
      const r = results[name];
      if (r instanceof Error) throw r;
      return typeof r === "function"
        ? (r as (a: unknown) => unknown)(args)
        : (r ?? null);
    },
    watchQuery(ref) {
      const name = getFunctionName(ref as never);
      return {
        onUpdate(cb) {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name)!.add(cb);
          return () => listeners.get(name)?.delete(cb);
        },
        localQueryResult() {
          const v = queryValues.get(name);
          if (v instanceof Error) throw v;
          return v;
        },
      };
    },
  };
  const push = (name: string, value: unknown) => {
    queryValues.set(name, value);
    for (const cb of listeners.get(name) ?? []) cb();
  };
  return { client, mutations, results, push };
}

function recorder() {
  const events: string[] = [];
  const signals: Array<{ from: string; signal: unknown }> = [];
  const closed: unknown[] = [];
  const handlers: SignalingHandlers = {
    onWelcome: (peers) => events.push(`welcome ${peers.join(",")}`),
    onPeerJoined: (id) => events.push(`joined ${id}`),
    onPeerLeft: (id, reason) => events.push(`left ${id} ${reason}`),
    onSignal: (from, signal) => signals.push({ from, signal }),
    onRemoteState: (s) =>
      events.push(`state ${s.participantId} ${s.micOn} ${s.cameraOn}`),
    onClosed: (reason) => closed.push(reason),
  };
  return { handlers, events, signals, closed };
}

const PRESENCE = "meetings/webrtc/mesh:callPresence";
const SIGNALS = "meetings/webrtc/mesh:signalsForSession";
const session = { meetingId: "m1", identityToken: async () => "token" };
const mapId = (id: string) => id.replace(/^local-test-/, "").toUpperCase();

async function opened() {
  const fake = fakeClient();
  fake.results["meetings/webrtc/mesh:joinCall"] = {
    sessionId: "self-session",
    participantId: "local-test-a",
  };
  fake.results["meetings/webrtc/mesh:heartbeat"] = { alive: true };
  const rec = recorder();
  const conn = convexSignaling(fake.client, {
    participantIdOf: mapId,
    newSessionId: () => "self-session",
  }).open(session, rec.handlers);
  await vi.waitFor(() =>
    expect(
      fake.mutations.some((m) => m.name === "meetings/webrtc/mesh:joinCall"),
    ).toBe(true),
  );
  await Promise.resolve();
  return { fake, rec, conn };
}

const entry = (
  sessionId: string,
  participantId: string,
  micOn = true,
  cameraOn = true,
) => ({ sessionId, participantId, micOn, cameraOn });

afterEach(() => vi.useRealTimers());

describe("convexSignaling presence", () => {
  it("welcomes with the others present, not this session", async () => {
    const { fake, rec } = await opened();
    fake.push(PRESENCE, [
      entry("self-session", "local-test-a"),
      entry("b-1", "local-test-b", false, true),
    ]);
    expect(rec.events).toEqual(["welcome B", "state B false true"]);
  });

  it("reports a reloaded peer as leaving and joining again", async () => {
    const { fake, rec } = await opened();
    fake.push(PRESENCE, [
      entry("self-session", "local-test-a"),
      entry("b-1", "local-test-b"),
    ]);
    fake.push(PRESENCE, [
      entry("self-session", "local-test-a"),
      entry("b-2", "local-test-b"),
    ]);
    fake.push(PRESENCE, [entry("self-session", "local-test-a")]);
    expect(rec.events.slice(2)).toEqual([
      "left B rejoined",
      "joined B",
      "state B true true",
      "left B left",
    ]);
  });
});

describe("convexSignaling signals", () => {
  it("holds a signal that arrives before presence shows its sender, then delivers it", async () => {
    const { fake, rec } = await opened();
    fake.push(PRESENCE, [entry("self-session", "local-test-a")]);
    fake.push(SIGNALS, [
      {
        _id: "s1",
        fromSessionId: "b-1",
        fromParticipantId: "local-test-b",
        signal: { kind: "description", type: "offer", sdp: "x" },
      },
    ]);
    expect(rec.signals).toEqual([]);
    fake.push(PRESENCE, [
      entry("self-session", "local-test-a"),
      entry("b-1", "local-test-b"),
    ]);
    expect(rec.signals).toEqual([
      { from: "B", signal: { description: { type: "offer", sdp: "x" } } },
    ]);
    expect(
      fake.mutations.find((m) => m.name === "meetings/webrtc/mesh:ackSignals")
        ?.args.signalIds,
    ).toEqual(["s1"]);
  });

  it("drops a signal from a session the peer has replaced", async () => {
    const { fake, rec } = await opened();
    fake.push(PRESENCE, [
      entry("self-session", "local-test-a"),
      entry("b-2", "local-test-b"),
    ]);
    fake.push(SIGNALS, [
      {
        _id: "s1",
        fromSessionId: "b-1",
        fromParticipantId: "local-test-b",
        signal: { kind: "description", type: "offer", sdp: "old" },
      },
    ]);
    expect(rec.signals).toEqual([]);
  });

  it("sends to the peer's current session and leaves out null candidate fields", async () => {
    const { fake, conn } = await opened();
    fake.push(PRESENCE, [
      entry("self-session", "local-test-a"),
      entry("b-1", "local-test-b"),
    ]);
    conn.send("B", {
      candidate: {
        candidate: "c",
        sdpMid: null,
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
    const sent = fake.mutations.find(
      (m) => m.name === "meetings/webrtc/mesh:sendSignal",
    );
    expect(sent?.args).toEqual({
      meetingId: "m1",
      fromSessionId: "self-session",
      toSessionId: "b-1",
      signal: { kind: "candidate", candidate: "c", sdpMLineIndex: 0 },
    });
  });
});

describe("convexSignaling unknown senders", () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] }),
  );

  it("acknowledges a signal whose sender never appears, after a short hold", async () => {
    const { fake, rec } = await opened();
    fake.push(PRESENCE, [entry("self-session", "local-test-a")]);
    fake.push(SIGNALS, [
      {
        _id: "s-ghost",
        fromSessionId: "c-closed",
        fromParticipantId: "local-test-c",
        signal: { kind: "description", type: "offer", sdp: "x" },
      },
    ]);
    const acked = () =>
      fake.mutations
        .filter((m) => m.name === "meetings/webrtc/mesh:ackSignals")
        .flatMap((m) => m.args.signalIds as string[]);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(acked()).toEqual([]); // still within the hold
    await vi.advanceTimersByTimeAsync(UNKNOWN_SENDER_HOLD_MS + HEARTBEAT_MS);
    expect(acked()).toEqual(["s-ghost"]);
    expect(rec.signals).toEqual([]);
  });
});

describe("convexSignaling endings", () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] }),
  );

  it("reports a refused join as rejected with the server's words", async () => {
    const fake = fakeClient();
    fake.results["meetings/webrtc/mesh:joinCall"] = Object.assign(
      new Error("Server Error"),
      {
        data: {
          code: "FORBIDDEN",
          message: "Access denied: Not a meeting participant",
        },
      },
    );
    const rec = recorder();
    convexSignaling(fake.client, { newSessionId: () => "s" }).open(
      session,
      rec.handlers,
    );
    await vi.waitFor(() => expect(rec.closed).toHaveLength(1));
    expect(rec.closed[0]).toEqual({
      kind: "rejected",
      message: "Access denied: Not a meeting participant",
    });
  });

  it("does not retry a join the server refused for another reason", async () => {
    const fake = fakeClient();
    fake.results["meetings/webrtc/mesh:joinCall"] = Object.assign(
      new Error("Server Error"),
      {
        data: {
          code: "VALIDATION_ERROR",
          message: "This meeting is not active",
        },
      },
    );
    const rec = recorder();
    convexSignaling(fake.client, { newSessionId: () => "s" }).open(
      session,
      rec.handlers,
    );
    await vi.waitFor(() => expect(rec.closed).toHaveLength(1));
    expect(rec.closed[0]).toEqual({
      kind: "rejected",
      message: "This meeting is not active",
    });
    const plain = fakeClient();
    plain.results["meetings/webrtc/mesh:joinCall"] = new Error(
      "ArgumentValidationError: Value does not match validator",
    );
    const rec2 = recorder();
    convexSignaling(plain.client, { newSessionId: () => "s" }).open(
      session,
      rec2.handlers,
    );
    await vi.waitFor(() => expect(rec2.closed).toHaveLength(1));
    expect(rec2.closed[0]).toEqual({
      kind: "rejected",
      message: "This call could not be joined.",
    });
  });

  it("reports a session replaced by another tab, and one that expired", async () => {
    for (const [reason, kind] of [
      ["replaced", "replaced"],
      ["expired", "lost"],
    ] as const) {
      const { fake, rec } = await opened();
      fake.results["meetings/webrtc/mesh:heartbeat"] = { alive: false, reason };
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(rec.closed).toHaveLength(1);
      expect((rec.closed[0] as { kind: string }).kind).toBe(kind);
    }
  });

  it("reports lost when heartbeats stop answering", async () => {
    const { fake, rec } = await opened();
    fake.results["meetings/webrtc/mesh:heartbeat"] = () =>
      new Promise(() => {});
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 5);
    expect(rec.closed).toEqual([
      { kind: "lost", message: "the call service stopped answering" },
    ]);
  });

  it("leaving says so to the server and reports nothing", async () => {
    const { fake, rec, conn } = await opened();
    conn.close();
    expect(
      fake.mutations.some((m) => m.name === "meetings/webrtc/mesh:leaveCall"),
    ).toBe(true);
    expect(rec.closed).toEqual([]);
  });
});
