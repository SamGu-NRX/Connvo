/**
 * Reconnect scenarios for the REAL `useCollaborativeNotes` hook against the
 * owned fake Convex client. The hook is imported unmodified from
 * `src/hooks/useCollaborativeNotes.ts`; only `convex/react` is replaced.
 *
 * Milestone 1 outputs (committed under results/vitest/):
 *  - scenario/source counts,
 *  - no-ack controls (paired worlds that differ only in what the server
 *    accepted, compared on the hook's visible state).
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", async () => await import("../fake/convexReactMock.ts"));

import { useCollaborativeNotes, calculateOperation } from "@/hooks/useCollaborativeNotes";
import { setActiveClient } from "../fake/convexReactMock";
import {
  FakeConvexClient,
  FakeConvexServer,
  type NoteOperationInput,
} from "../fake/fakeConvex";
import { renderHook } from "../testing/renderHook";

const MEETING = "m_test_meeting";
const SOURCES = ["src/hooks/useCollaborativeNotes.ts"];

interface UiSnapshot {
  content: string;
  version: number;
  isSyncing: boolean;
  isLoading: boolean;
  consumerLocalContent: string;
}

interface TraceStep {
  step: string;
  ui: UiSnapshot;
  server: { content: string; version: number };
  acceptedNoteOps: number;
}

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

function makeWorld(seedContent = "hello"): World {
  const server = new FakeConvexServer({
    note: { meetingId: MEETING, content: seedContent, version: 3 },
    meeting: { meetingId: MEETING, state: "active", participants: ["user-local"] },
  });
  const client = new FakeConvexClient(server, [
    { kind: "query", names: ["notes.getMeetingNotes"] },
    {
      kind: "mutation",
      names: ["notes.applyNoteOperation", "notes.batchApplyNoteOperations"],
    },
  ]);
  setActiveClient(client);
  return { server, client };
}

async function flushQuery(client: FakeConvexClient): Promise<void> {
  await client.flushAcks();
}

type NotesHook = ReturnType<typeof useCollaborativeNotes>;
type Hook = ReturnType<typeof renderHook<NotesHook>>;

function snap(hook: Hook, step: string, world: World, consumerLocalContent: string): TraceStep {
  const h = hook.box.current;
  return {
    step,
    ui: {
      content: h.content,
      version: h.version,
      isSyncing: h.isSyncing,
      isLoading: h.isLoading,
      consumerLocalContent,
    },
    server: {
      content: world.server.getNote(MEETING)?.content ?? "",
      version: world.server.getNote(MEETING)?.version ?? 0,
    },
    acceptedNoteOps: world.server.history
      .list()
      .filter((e) => e.name === "notes.applyNoteOperation").length,
  };
}

/** Consumer pattern exactly as documented in the hook's JSDoc example. */
function consumerEdit(
  hook: Hook,
  localContent: { value: string },
  newText: string,
): { promise: Promise<void> } {
  const old = localContent.value;
  localContent.value = newText; // setLocalContent immediately (per hook example)
  const op = calculateOperation(old, newText);
  const promise = hook.box.current.applyOperation(op);
  return { promise };
}

let world: World;
let hook: Hook;

beforeEach(() => {
  world = makeWorld();
  hook = renderHook(() => useCollaborativeNotes(MEETING as never));
});

afterEach(() => {
  hook.unmount();
  setActiveClient(undefined);
});

describe("useCollaborativeNotes reconnect study (real hook, fake transport)", () => {
  it("control: join + edit fully acked — optimistic and saved states agree", async () => {
    const { server, client } = world;
    const trace: TraceStep[] = [];
    await flushQuery(client);
    trace.push(snap(hook, "joined", world, "hello"));
    expect(hook.box.current.content).toBe("hello");
    expect(hook.box.current.isLoading).toBe(false);

    const local = { value: "hello" };
    const { promise } = consumerEdit(hook, local, "hello world");
    trace.push(snap(hook, "edit-sent", world, local.value));
    await client.flushAcks();
    await promise;
    await hook.rerender();
    trace.push(snap(hook, "edit-acked", world, local.value));

    expect(server.getNote(MEETING)?.content).toBe("hello world");
    expect(server.history.duplicateEntryCount()).toBe(0);
    writeResults("notes-control.json", {
      scenario: "notes/control",
      sources: SOURCES,
      counts: { ops: 1, lostOps: 0, duplicatedOps: 0, falselySavedTicks: 0 },
      trace,
    });
  });

  it("join while offline: isLoading never resolves, content stays empty", async () => {
    hook.unmount();
    world = makeWorld(); // cold cache: nothing fetched yet
    const { client, server } = world;
    client.cutConnection("before-server");
    hook = renderHook(() => useCollaborativeNotes(MEETING as never));
    await flushQuery(client);

    expect(hook.box.current.isLoading).toBe(true);
    expect(hook.box.current.content).toBe("");
    expect(server.getNote(MEETING)?.content).toBe("hello"); // server truth intact

    client.restore();
    await flushQuery(client);
    await hook.rerender();
    expect(hook.box.current.isLoading).toBe(false);
    expect(hook.box.current.content).toBe("hello");

    writeResults("notes-join-offline.json", {
      scenario: "notes/join-offline",
      sources: SOURCES,
      counts: {
        joinedWhileOffline: true,
        isLoadingStuckTicks: 1,
        recoveredOnReconnect: true,
      },
    });
  });

  it("edit with lost ack: re-send duplicates the op server-side while UI shows one edit", async () => {
    const { server, client } = world;
    const trace: TraceStep[] = [];
    await flushQuery(client);

    const local = { value: "hello" };
    const { promise } = consumerEdit(hook, local, "hello world");
    client.cutConnection("after-server"); // server processed; ack lost
    await hook.rerender(); // flush isSyncing=true into the visible state
    trace.push(snap(hook, "edit-sent+cut", world, local.value));

    // Hook's visible state while the ack is in limbo:
    expect(hook.box.current.isSyncing).toBe(true);
    expect(hook.box.current.content).toBe("hello"); // cache not yet updated
    expect(server.getNote(MEETING)?.content).toBe("hello world"); // server HAS it
    expect(server.history.duplicateEntryCount()).toBe(0);

    client.restore(); // re-sends the unacked mutation -> duplicate acceptance
    await client.flushAcks();
    await promise;
    await hook.rerender();
    trace.push(snap(hook, "restored+acked", world, local.value));

    expect(server.history.duplicateEntryCount()).toBe(1); // THE duplicate
    expect(server.getNote(MEETING)?.content).toBe("hello world world"); // applied twice
    expect(hook.box.current.content).toBe("hello world world"); // UI shows corrupted text

    writeResults("notes-edit-ack-lost.json", {
      scenario: "notes/edit-ack-lost",
      sources: SOURCES,
      counts: {
        ops: 1,
        duplicatedOps: server.history.duplicateEntryCount(),
        serverContent: server.getNote(MEETING)?.content,
        uiContentAfterRestore: hook.box.current.content,
      },
      trace,
    });
  });

  it("edit with lost request: optimistic consumer state diverges from saved state until restore", async () => {
    const { server, client } = world;
    const trace: TraceStep[] = [];
    await flushQuery(client);

    client.cutConnection("before-server");
    const local = { value: "hello" };
    const { promise } = consumerEdit(hook, local, "hello world");
    await hook.rerender(); // flush isSyncing=true into the visible state
    trace.push(snap(hook, "edit-queued-offline", world, local.value));

    // Optimistic (consumer) state says "hello world"; saved state says "hello".
    expect(hook.box.current.content).toBe("hello");
    expect(hook.box.current.isSyncing).toBe(true);
    expect(server.getNote(MEETING)?.content).toBe("hello");

    client.restore(); // queued op replayed exactly once
    await client.flushAcks();
    await promise;
    await hook.rerender();
    trace.push(snap(hook, "restored+acked", world, local.value));

    expect(server.history.duplicateEntryCount()).toBe(0);
    expect(server.getNote(MEETING)?.content).toBe("hello world");

    writeResults("notes-edit-request-lost.json", {
      scenario: "notes/edit-request-lost",
      sources: SOURCES,
      counts: {
        ops: 1,
        lostOps: 0,
        duplicatedOps: 0,
        divergedTicks: 1, // optimistic vs saved disagreed while queued
      },
      trace,
    });
  });

  it("edit after removal: op rejected, consumer keeps the optimistic text with no saved signal", async () => {
    const { server, client } = world;
    const trace: TraceStep[] = [];
    await flushQuery(client);

    client.cutConnection("before-server");
    server.remoteClearNote(MEETING, "peer-1");
    server.remoteRemoveParticipant(MEETING, "user-local", "peer-1");

    const local = { value: "hello" };
    const { promise } = consumerEdit(hook, local, "hello world");
    await hook.rerender(); // flush isSyncing=true into the visible state
    trace.push(snap(hook, "edit-queued-offline+removed", world, local.value));

    client.restore(); // replay -> server REJECTS (not a participant)
    await client.flushAcks();
    await expect(promise).rejects.toThrow(/not a participant/i);
    await hook.rerender();
    trace.push(snap(hook, "restored+rejected", world, local.value));

    expect(server.getNote(MEETING)?.content).toBe(""); // cleared remotely
    expect(hook.box.current.content).toBe(""); // cache reconciled to server
    // The consumer (per the hook's documented example) still holds the edit:
    expect(local.value).toBe("hello world");
    // ...and after the rejection, isSyncing is false — nothing signals that
    // the text on screen is not saved anywhere.
    expect(hook.box.current.isSyncing).toBe(false);

    writeResults("notes-edit-removed.json", {
      scenario: "notes/edit-removed",
      sources: SOURCES,
      counts: {
        ops: 1,
        lostOps: 1, // never accepted server-side
        duplicatedOps: 0,
        falselySavedTicks: 1, // localContent == intent, server == "", no signal
      },
      trace,
    });
  });

  it("no-ack control: ack-lost and request-lost worlds are indistinguishable from the hook's visible state", async () => {
    // Two worlds that differ ONLY in whether the server accepted the edit;
    // compare the hook's visible state at the same tick.
    const runWorld = async (mode: "after-server" | "before-server") => {
      const w = makeWorld();
      const h = renderHook(() => useCollaborativeNotes(MEETING as never));
      await flushQuery(w.client);
      if (mode === "before-server") w.client.cutConnection("before-server");
      const local = { value: "hello" };
      const { promise } = consumerEdit(h, local, "hello world");
      if (mode === "after-server") w.client.cutConnection("after-server");
      const step1 = snap(h, "post-edit", w, local.value);
      h.unmount();
      setActiveClient(undefined);
      // The mutation promise never settles in either world (no ack was
      // flushed before the unmount) — deliberately not awaited.
      void promise;
      return { step1, server: w.server };
    };

    const accepted = await runWorld("after-server");
    const rejected = await runWorld("before-server");

    const uiFields = (s: TraceStep) => JSON.stringify(s.ui);
    const ambiguousTicks = uiFields(accepted.step1) === uiFields(rejected.step1) ? 1 : 0;

    // The two worlds have OPPOSITE server outcomes:
    expect(accepted.server.getNote(MEETING)?.content).toBe("hello world");
    expect(rejected.server.getNote(MEETING)?.content).toBe("hello");
    // ...yet the hook's visible state is byte-for-byte identical:
    expect(uiFields(accepted.step1)).toBe(uiFields(rejected.step1));

    writeResults("notes-no-ack-control.json", {
      scenario: "notes/no-ack-control",
      sources: SOURCES,
      counts: {
        ambiguousTicks,
        worlds: {
          serverAccepted: accepted.step1.ui,
          serverMissed: rejected.step1.ui,
        },
      },
    });
  });

  it("repeated reconnect cycles accumulate duplicates", async () => {
    const { server, client } = world;
    await flushQuery(client);
    const local = { value: "hello" };
    let content = "hello";

    for (let cycle = 0; cycle < 4; cycle++) {
      const { promise } = consumerEdit(hook, local, (content = content + "!"));
      client.cutConnection("after-server");
      client.restore();
      await client.flushAcks();
      await promise;
      await hook.rerender();
    }

    const duplicates = server.history.duplicateEntryCount();
    expect(duplicates).toBe(4); // one per cycle: every edit applied twice
    // UI truth == server truth after reconciliation, but the note has
    // doubled punctuation:
    expect(hook.box.current.content).toBe("hello!!!!!!!!");
    expect(server.getNote(MEETING)?.content).toBe("hello!!!!!!!!");

    writeResults("notes-repeated-reconnect.json", {
      scenario: "notes/repeated-reconnect",
      sources: SOURCES,
      counts: {
        cycles: 4,
        ops: 4,
        duplicatedOps: duplicates,
        finalServerContent: server.getNote(MEETING)?.content,
      },
    });
  });
});
