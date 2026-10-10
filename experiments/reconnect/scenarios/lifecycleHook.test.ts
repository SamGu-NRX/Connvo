/**
 * Reconnect scenarios for the REAL `useMeetingLifecycle` hook against the
 * owned fake Convex client. The hook is imported unmodified from
 * `src/hooks/useMeetingLifecycle.ts`; only `convex/react` is replaced.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", async () => await import("../fake/convexReactMock.ts"));

import { useMeetingLifecycle } from "@/hooks/useMeetingLifecycle";
import { setActiveClient } from "../fake/convexReactMock";
import { FakeConvexClient, FakeConvexServer } from "../fake/fakeConvex";
import { renderHook } from "../testing/renderHook";

const MEETING = "m_life_meeting";
const SOURCES = ["src/hooks/useMeetingLifecycle.ts"];

function writeResults(name: string, data: unknown): void {
  const dir = path.join(process.cwd(), "experiments", "reconnect", "results", "vitest");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name.endsWith(".json") ? name : name + ".json");
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

interface World {
  server: FakeConvexServer;
  client: FakeConvexClient;
}

function makeWorld(): World {
  const server = new FakeConvexServer({
    meeting: { meetingId: MEETING, state: "scheduled", participants: ["user-local"] },
  });
  const client = new FakeConvexClient(server, [
    { kind: "query", names: ["meetings.lifecycle.getMeetingConnectionInfo"] },
    {
      kind: "mutation",
      names: [
        "meetings.lifecycle.createMeeting",
        "meetings.lifecycle.startMeeting",
        "meetings.lifecycle.endMeeting",
      ],
    },
    { kind: "action", names: ["prompts.actions.generatePreCallIdeas"] },
  ]);
  setActiveClient(client);
  return { server, client };
}

type LifecycleHook = ReturnType<typeof useMeetingLifecycle>;
type Hook = ReturnType<typeof renderHook<LifecycleHook>>;

let world: World;
let hook: Hook;

beforeEach(() => {
  world = makeWorld();
  hook = renderHook(() => useMeetingLifecycle());
});

afterEach(() => {
  hook.unmount();
  setActiveClient(undefined);
});

function lifecycleCounts(world: World, name: string) {
  return world.server.history.list().filter((e) => e.name === name).length;
}

describe("useMeetingLifecycle reconnect study (real hook, fake transport)", () => {
  it("control: create, start and end fully acked", async () => {
    const { server, client } = world;
    let p: Promise<unknown>;
    hook.rerender(); // ensure box populated
    p = hook.box.current.startMeeting(MEETING as never);
    await client.flushAcks();
    await p;
    p = hook.box.current.endMeeting(MEETING as never);
    await client.flushAcks();
    await p;

    expect(server.getMeeting(MEETING)?.state).toBe("concluded");
    expect(lifecycleCounts(world, "meetings.lifecycle.startMeeting")).toBe(1);
    expect(lifecycleCounts(world, "meetings.lifecycle.endMeeting")).toBe(1);
    expect(server.history.duplicateEntryCount()).toBe(0);

    writeResults("lifecycle-control.json", {
      scenario: "lifecycle/control",
      sources: SOURCES,
      counts: {
        startAcceptances: 1,
        endAcceptances: 1,
        duplicatedOps: 0,
        finalState: server.getMeeting(MEETING)?.state,
      },
    });
  });

  it("start with lost ack: re-send duplicates the start acceptance; late reply unblocks isStarting", async () => {
    const { server, client } = world;
    const promise = hook.box.current.startMeeting(MEETING as never);
    client.cutConnection("after-server"); // server started it; ack lost
    await hook.rerender(); // flush isStarting=true into the visible state

    expect(server.getMeeting(MEETING)?.state).toBe("active");
    expect(hook.box.current.isStarting).toBe(true); // stuck: no ack

    client.restore(); // re-send -> duplicate acceptance
    await client.flushAcks();
    await promise;
    await hook.rerender();

    expect(lifecycleCounts(world, "meetings.lifecycle.startMeeting")).toBe(2);
    expect(server.history.duplicateEntryCount()).toBe(1);
    expect(hook.box.current.isStarting).toBe(false);

    writeResults("lifecycle-start-ack-lost.json", {
      scenario: "lifecycle/start-ack-lost",
      sources: SOURCES,
      counts: {
        ops: 1,
        duplicatedOps: server.history.duplicateEntryCount(),
        startAcceptances: lifecycleCounts(world, "meetings.lifecycle.startMeeting"),
        finalState: server.getMeeting(MEETING)?.state,
      },
    });
  });

  it("start with lost request + navigation: meeting never starts, UI believed it did", async () => {
    const { server, client } = world;
    client.cutConnection("before-server");
    void hook.box.current.startMeeting(MEETING as never); // queued locally only
    await client.flushAcks();
    await hook.rerender(); // flush isStarting=true into the visible state

    expect(hook.box.current.isStarting).toBe(true);
    expect(server.getMeeting(MEETING)?.state).toBe("scheduled");

    client.reset(); // navigation away: in-memory client destroyed
    await client.flushAcks();

    expect(server.getMeeting(MEETING)?.state).toBe("scheduled"); // still never started
    expect(lifecycleCounts(world, "meetings.lifecycle.startMeeting")).toBe(0);

    writeResults("lifecycle-start-request-lost.json", {
      scenario: "lifecycle/start-request-lost+navigation",
      sources: SOURCES,
      counts: {
        ops: 1,
        lostOps: 1,
        duplicatedOps: 0,
        finalServerState: server.getMeeting(MEETING)?.state,
      },
    });
  });

  it("end with lost request + navigation: meeting stays active while the user believed it ended", async () => {
    const { server, client } = world;
    // Start cleanly first.
    let p = hook.box.current.startMeeting(MEETING as never);
    await client.flushAcks();
    await p;

    client.cutConnection("before-server");
    void hook.box.current.endMeeting(MEETING as never); // queued only
    await client.flushAcks();
    await hook.rerender(); // flush isEnding=true into the visible state
    expect(hook.box.current.isEnding).toBe(true);

    client.reset(); // user navigates away believing the meeting ended
    await client.flushAcks();

    expect(server.getMeeting(MEETING)?.state).toBe("active"); // still running!
    expect(lifecycleCounts(world, "meetings.lifecycle.endMeeting")).toBe(0);

    writeResults("lifecycle-end-request-lost.json", {
      scenario: "lifecycle/end-request-lost+navigation",
      sources: SOURCES,
      counts: {
        ops: 1,
        lostOps: 1, // the end was lost: post-call processing never triggered
        duplicatedOps: 0,
        finalServerState: server.getMeeting(MEETING)?.state,
      },
    });
  });

  it("end with lost ack: duplicate end acceptance on restore", async () => {
    const { server, client } = world;
    const p1 = hook.box.current.startMeeting(MEETING as never);
    await client.flushAcks();
    await p1;

    const p2 = hook.box.current.endMeeting(MEETING as never);
    client.cutConnection("after-server");
    client.restore(); // re-sends the end
    await client.flushAcks();
    await p2;

    expect(lifecycleCounts(world, "meetings.lifecycle.endMeeting")).toBe(2);
    expect(server.history.duplicateEntryCount()).toBe(1);
    expect(server.getMeeting(MEETING)?.state).toBe("concluded");

    writeResults("lifecycle-end-ack-lost.json", {
      scenario: "lifecycle/end-ack-lost",
      sources: SOURCES,
      counts: {
        ops: 1,
        duplicatedOps: server.history.duplicateEntryCount(),
        endAcceptances: lifecycleCounts(world, "meetings.lifecycle.endMeeting"),
      },
    });
  });

  it("prompt-generation action offline: not replayed, fails silently (hook warns and continues)", async () => {
    const { client } = world;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = hook.box.current.createMeeting({
      title: "t",
      participantIds: [] as never[],
      generatePrompts: true,
    } as never);
    // createMeeting mutation delivered; the action then runs while online —
    // now cut before the action executes.
    client.cutConnection("before-server");
    // The hook swallows action failures (console.warn), meeting creation ok.
    // The createMeeting ack was lost with the cut; deliver the late reply.
    client.flushLateAcks();
    const meetingId = await p;
    expect(meetingId).toBeDefined();
    expect(warnSpy).toHaveBeenCalled(); // "Failed to generate pre-call prompts"
    expect(hook.box.current.error).toBeNull(); // failure invisible in state

    writeResults("lifecycle-prompts-action-offline.json", {
      scenario: "lifecycle/prompts-action-offline",
      sources: SOURCES,
      counts: {
        actionReplayed: false,
        errorSurfaced: false,
        warnCalls: warnSpy.mock.calls.length,
      },
    });
  });

  it("getConnectionInfo with a changing meetingId during render loops (React anti-pattern observed)", async () => {
    // getConnectionInfo calls setCurrentMeetingId during render. With a new
    // id every render this is a render-phase update loop; React caps it.
    let renderN = 0;
    let threw: unknown;
    try {
      const probe = renderHook(() => {
        const h = useMeetingLifecycle();
        h.getConnectionInfo(`m_other_${renderN++}` as never);
        return h;
      });
      probe.unmount();
    } catch (e) {
      threw = e;
    }
    const loopError = String((threw as Error)?.message ?? threw ?? "").includes(
      "Too many re-renders",
    );
    expect(loopError).toBe(true);

    writeResults("lifecycle-connection-info-render-setstate.json", {
      scenario: "lifecycle/connection-info-render-setstate",
      sources: SOURCES,
      counts: {
        renderLoopCapped: loopError,
        antiPattern: "setCurrentMeetingId called inside getConnectionInfo during render",
      },
    });
  });
});
