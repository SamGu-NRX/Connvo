/**
 * Notes ledger store unit tests (docs/notes-ledger-f1/design.md §3).
 *
 * Each required behavior gets a named test, driven through a scripted
 * transport (no convex backend here — the mounted matrix covers the real
 * one). Deterministic ids/timestamps via injected counters.
 */

import { describe, expect, test } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { NotesLedger } from "@/hooks/notes/notesLedger";
import type {
  BatchApplyNoteOperationsResponse,
  NotesServerSnapshot,
  NotesTransport,
} from "@/hooks/notes/types";

let idCounter = 0;

/** Fixture cast: the scripted transport ignores the meeting id, so any
 * string stands in for the branded Id<"meetings"> the real hook receives. */
const asMeetingId = (id: string): Id<"meetings"> => id as Id<"meetings">;

function makeLedger(options?: {
  storage?: Storage | null;
  debounceMs?: number;
  meetingId?: string;
  clientId?: string;
}): NotesLedger {
  idCounter = 0;
  return new NotesLedger({
    meetingId: asMeetingId(options?.meetingId ?? "meeting-1"),
    clientId: options?.clientId ?? "client-1",
    debounceMs: options?.debounceMs ?? 0,
    storage: options?.storage === undefined ? null : options.storage,
    now: () => 1,
    generateId: () => ++idCounter,
  });
}

function snapshotOf(overrides: Partial<NotesServerSnapshot> = {}): NotesServerSnapshot {
  return {
    content: "",
    version: 0,
    headSequence: 0,
    clientAcks: [],
    ...overrides,
  };
}

type SentBatch = {
  operations: Array<{
    operation: {
      type: "insert" | "delete" | "retain";
      position: number;
      content?: string;
      length?: number;
    };
    clientSequence: number;
    clientOpId: string;
  }>;
  expectedVersion?: number;
};

/** Scripted transport: records batches, plays queued outcomes, delivers snapshots. */
class ScriptedTransport implements NotesTransport {
  batches: SentBatch[] = [];
  private responseQueue: Array<{
    resolve?: BatchApplyNoteOperationsResponse;
    reject?: Error;
  }> = [];
  private parkedCalls: Array<{
    resolve: (value: BatchApplyNoteOperationsResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  private deliverSnapshot: ((s: NotesServerSnapshot | undefined) => void) | null =
    null;
  private initial: NotesServerSnapshot | undefined = undefined;

  /** Queue a resolved response for the next (or parked) applyBatch call. */
  enqueue(response: BatchApplyNoteOperationsResponse): void {
    const parked = this.parkedCalls.shift();
    if (parked) {
      parked.resolve(response);
      return;
    }
    this.responseQueue.push({ resolve: response });
  }
  /** Queue a rejection for the next (or parked) applyBatch call. */
  enqueueFailure(error: Error): void {
    const parked = this.parkedCalls.shift();
    if (parked) {
      parked.reject(error);
      return;
    }
    this.responseQueue.push({ reject: error });
  }
  setInitial(snapshot: NotesServerSnapshot | undefined): void {
    this.initial = snapshot;
  }
  deliver(snapshot: NotesServerSnapshot | undefined): void {
    this.deliverSnapshot?.(snapshot);
  }

  subscribe(
    _meetingId: string,
    _clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): () => void {
    this.deliverSnapshot = onSnapshot;
    if (this.initial !== undefined) onSnapshot(this.initial);
    return () => {
      this.deliverSnapshot = null;
    };
  }

  applyBatch(
    _meetingId: string,
    _clientId: string,
    batch: SentBatch,
  ): Promise<BatchApplyNoteOperationsResponse> {
    this.batches.push(batch);
    const next = this.responseQueue.shift();
    if (!next) {
      // Park the call: a later enqueue()/enqueueFailure() resolves it.
      return new Promise<BatchApplyNoteOperationsResponse>((resolve, reject) => {
        this.parkedCalls.push({ resolve, reject });
      });
    }
    if (next.reject) return Promise.reject(next.reject);
    return Promise.resolve(next.resolve as BatchApplyNoteOperationsResponse);
  }

  close(): void {}
}

/** A per-op echo response for the given batch. */
function echoResponse(
  batch: SentBatch,
  firstServerSequence: number,
  opts?: { deduped?: boolean; only?: string[] },
): BatchApplyNoteOperationsResponse {
  const only = opts?.only;
  return {
    success: true,
    processed: batch.operations.length,
    failed: 0,
    results: batch.operations
      .filter((op) => !only || only.includes(op.clientOpId))
      .map((op, index) => ({
        serverSequence: firstServerSequence + index,
        transformedOperation: op.operation,
        conflicts: [],
        clientOpId: op.clientOpId,
        clientSequence: op.clientSequence,
        ...(opts?.deduped ? { deduped: true } : {}),
      })),
    newVersion: firstServerSequence + batch.operations.length,
  };
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("client ledger core (§3)", () => {
  test("stamps clientSequence from the incorporated server-history watermark (OT basis, not a counter)", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "abc", version: 3, headSequence: 2 }));
    ledger.start(transport);

    ledger.onEdit("abc d");
    await tick(); // batch parked in flight

    const batch = transport.batches[0] as SentBatch;
    expect(batch.operations).toHaveLength(1);
    expect(batch.operations[0]?.clientSequence).toBe(2); // watermark, not op count
    expect(batch.operations[0]?.operation).toEqual({
      type: "insert",
      position: 3,
      content: " d",
    });

    // The response acks our op; the next fresh read carries TWO more server
    // ops (headSequence 2 → 4) and adopts version 5.
    transport.enqueue(echoResponse(transport.batches[0] as SentBatch, 3));
    await tick();
    transport.deliver(snapshotOf({ content: "abc d!", version: 5, headSequence: 4 }));
    await tick();

    // A later op diffs from the NEW base and stamps the NEW watermark —
    // proving clientSequence tracks the incorporated basis, not a counter.
    ledger.onEdit("abc d! e");
    await tick();
    const second = transport.batches[1] as SentBatch;
    expect(second.operations[0]?.clientSequence).toBe(4);
    expect(second.operations[0]?.operation).toEqual({
      type: "insert",
      position: 6,
      content: " e",
    });
  });

  test("emits sibling delete+insert from ONE base coordinate system for replacements", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "cat", version: 1, headSequence: 1 }));
    transport.enqueue(echoResponse({ operations: [] } as SentBatch, 2));
    ledger.start(transport);

    ledger.onEdit("dog"); // equal-length replacement — the #24 shape
    await tick();

    const batch = transport.batches[0] as SentBatch;
    expect(batch.operations.map((op) => op.operation.type)).toEqual([
      "delete",
      "insert",
    ]);
    const [first, second] = batch.operations;
    expect(first?.operation.position).toBe(second?.operation.position); // one base coordinate system
    expect(first?.clientSequence).toBe(second?.clientSequence);
    expect(first?.operation).toEqual({ type: "delete", position: 0, length: 3 });
    expect(second?.operation).toEqual({ type: "insert", position: 0, content: "dog" });
  });

  test("serializes flushes — never two batches in flight", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);

    ledger.onEdit("one"); // batch 1 goes out, response never queued (held)
    await tick();
    expect(transport.batches).toHaveLength(1);

    ledger.onEdit("one two"); // must NOT send while batch 1 is in flight
    await tick();
    expect(transport.batches).toHaveLength(1);

    // The follow-up goes out only after the settle + a fresh snapshot.
    transport.enqueue(echoResponse(transport.batches[0] as SentBatch, 1));
    await tick(); // settle batch 1
    transport.deliver(
      snapshotOf({ content: "one", version: 2, headSequence: 1 }),
    );
    transport.enqueue(echoResponse(transport.batches[1] as SentBatch, 2));
    ledger.flushNow();
    await tick();
    expect(transport.batches).toHaveLength(2);
    expect((transport.batches[1] as SentBatch).operations[0]?.operation).toEqual({
      type: "insert",
      position: 3,
      content: " two",
    });
  });

  test("sends a follow-up batch only after a fresh snapshot incorporates the previous one (adoption gate)", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);

    ledger.onEdit("first");
    await tick();
    expect(transport.batches).toHaveLength(1);
    transport.enqueue(echoResponse(transport.batches[0] as SentBatch, 1));
    await tick(); // batch settles — the adoption gate is now baseVersion+1

    ledger.onEdit("first second");
    await tick();
    // No fresh snapshot since the settle → the gate holds the follow-up.
    expect(transport.batches).toHaveLength(1);

    transport.deliver(
      snapshotOf({ content: "first", version: 2, headSequence: 1 }),
    );
    await tick();
    expect(transport.batches).toHaveLength(2);
  });

  test("monotonic ingest: a loading result never drops pending edits", () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "kept", version: 2, headSequence: 1 }));
    ledger.start(transport);

    ledger.onEdit("kept words"); // flushes immediately (debounceMs 0), send parked
    transport.deliver(undefined); // a loading result arrives
    // A loading result carries no evidence — the pending words stay composed
    // over the base and visible (D4: loading must never drop edits).
    expect(ledger.getSnapshot().content).toBe("kept words");
    expect(ledger.getSnapshot().isEditing).toBe(true); // work still tracked
    expect(ledger.getSnapshot().unsavedRecords).toHaveLength(1);
  });

  test("monotonic ingest: a stale snapshot never rewinds content", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "v1", version: 1, headSequence: 0 }));
    ledger.start(transport);
    ledger.onEdit("v1 words");
    await tick(); // batch parked in flight — the op is unacked

    // A NEWER server snapshot arrives while our op is unacked: the view holds
    // at base+ops (adopting the newer content would need unknown transforms).
    transport.deliver(snapshotOf({ content: "v2 latest", version: 2, headSequence: 1 }));
    expect(ledger.getSnapshot().content).toBe("v1 words"); // unacked words still composed

    // The response acks our op; the next fresh read is adopted wholesale —
    // the server's OT already rebased our words into its truth.
    transport.enqueue(echoResponse(transport.batches[0] as SentBatch, 1));
    await tick();
    transport.deliver(snapshotOf({ content: "v2 latest!", version: 3, headSequence: 2 }));
    expect(ledger.getSnapshot().content).toBe("v2 latest!");

    // A STALE redelivery (version 1) must never rewind state.
    transport.deliver(snapshotOf({ content: "v1", version: 1, headSequence: 0 }));
    expect(ledger.getSnapshot().version).toBe(3); // never rewound
    expect(ledger.getSnapshot().content).toBe("v2 latest!"); // never rewound
  });

  test("useSyncExternalStore snapshots are identity-stable between real changes", () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "x", version: 1, headSequence: 0 }));
    ledger.start(transport);

    const first = ledger.getSnapshot();
    expect(ledger.getSnapshot()).toBe(first); // same identity, no change
    transport.deliver(snapshotOf({ content: "x", version: 1, headSequence: 0 }));
    expect(ledger.getSnapshot()).toBe(first); // idempotent redelivery: still stable

    ledger.onEdit("x y");
    const second = ledger.getSnapshot();
    expect(second).not.toBe(first); // a real change → new identity
    expect(ledger.getSnapshot()).toBe(second);
  });

  test("identity-only retirement: a successful response for a DIFFERENT op never retires local work", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);

    ledger.onEdit("mine");
    await tick();
    // The response echoes only a foreign clientOpId.
    transport.enqueue({
      success: true,
      processed: 1,
      failed: 0,
      results: [
        {
          serverSequence: 1,
          transformedOperation: { type: "insert", position: 0, content: "theirs" },
          conflicts: [],
          clientOpId: "foreign-op",
          clientSequence: 0,
        },
      ],
      newVersion: 2,
    });
    await tick();

    const state = ledger.getSnapshot();
    expect(state.unconfirmedCount).toBe(1); // NOT retired
    expect(state.unsavedRecords).toHaveLength(1);
    expect(state.unsavedRecords[0]?.state).toBe("unconfirmed");
  });

  test("retires an operation on its own clientAcks entry", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);
    ledger.onEdit("acked words");
    await tick();
    const opId = (transport.batches[0] as SentBatch).operations[0]?.clientOpId;
    // No response at all — retirement arrives via the query's clientAcks.
    transport.deliver(
      snapshotOf({
        content: "acked words",
        version: 2,
        headSequence: 1,
        clientAcks: [
          {
            clientOpId: opId as string,
            clientSequence: 0,
            serverSequence: 1,
            appliedAt: 1,
          },
        ],
      }),
    );
    const state = ledger.getSnapshot();
    expect(state.unsavedRecords).toHaveLength(0); // retired on identity evidence
    expect(state.status).toBe("synced");
    expect(state.content).toBe("acked words"); // rebased onto server truth
  });

  test("a deduped echo retires the op (idempotent resend)", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);
    ledger.onEdit("dup");
    await tick();
    transport.enqueue(
      echoResponse(transport.batches[0] as SentBatch, 1, { deduped: true }),
    );
    await tick();
    expect(ledger.getSnapshot().unsavedRecords).toHaveLength(0);
  });

  test("a text coincidence never retires unconfirmed work (no text matching)", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "seed", version: 1, headSequence: 1 }));
    ledger.start(transport);
    ledger.onEdit("seed typed words");
    await tick(); // batch parked in flight, no response queued
    const firstId = (transport.batches[0] as SentBatch).operations[0]?.clientOpId;
    // The send settles with an UNKNOWN outcome → the record goes unconfirmed.
    transport.enqueueFailure(new Error("mystery transport collapse"));
    await tick();
    expect(ledger.getSnapshot().unconfirmedCount).toBe(1);

    // Another client coincidentally produces the same text; the fresh read
    // carries NO ack for our op. Text matching would retire it here (D6);
    // identity evidence must not: the op re-pends and resends under the SAME
    // clientOpId, which server dedupe makes safe.
    transport.deliver(
      snapshotOf({ content: "seed typed words", version: 2, headSequence: 2 }),
    );
    await tick();
    const state = ledger.getSnapshot();
    expect(state.unsavedRecords[0]?.clientOpId).toBe(firstId); // identity preserved
    expect(state.unsavedRecords[0]?.state).not.toBe("saved"); // NOT retired by text
    expect(state.content).toContain("typed words"); // words stay visible
    expect(transport.batches).toHaveLength(2); // evidence-gated resend
    expect((transport.batches[1] as SentBatch).operations[0]?.clientOpId).toBe(firstId);
  });

  test("resends after a definite delivery failure reusing the SAME clientOpId", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);
    ledger.onEdit("again");
    await tick();
    const firstId = (transport.batches[0] as SentBatch).operations[0]?.clientOpId;
    transport.enqueueFailure(new Error("fetch failed: ECONNREFUSED (unreachable)"));
    await tick(); // definite non-delivery → re-pended, transport offline
    expect(ledger.getSnapshot().status).toBe("offline");
    expect(ledger.getSnapshot().unsavedRecords[0]?.state).toBe("pending");

    // Reconnect: a fresh read proves the path works → the requested flush runs.
    transport.deliver(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    await tick();
    expect(transport.batches).toHaveLength(2);
    expect((transport.batches[1] as SentBatch).operations[0]?.clientOpId).toBe(firstId);
  });

  test("holds unconfirmed on an ambiguous failure until fresh evidence, then resends", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);
    ledger.onEdit("maybe");
    await tick();
    const firstId = (transport.batches[0] as SentBatch).operations[0]?.clientOpId;
    transport.enqueueFailure(new Error("mystery transport collapse"));
    await tick();
    expect(ledger.getSnapshot().unconfirmedCount).toBe(1);

    // A version-advance read with no ack for the op → evidence it never
    // applied → demote to pending → the requested flush resends same id.
    transport.deliver(snapshotOf({ content: "", version: 2, headSequence: 1 }));
    await tick();
    expect(transport.batches).toHaveLength(2);
    expect((transport.batches[1] as SentBatch).operations[0]?.clientOpId).toBe(firstId);
  });

  test("conflicted operations surface the conflict and retryConflicts re-diffs from fresh truth", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);
    ledger.onEdit("clashing words");
    await tick();
    const firstId = (transport.batches[0] as SentBatch).operations[0]?.clientOpId;
    transport.enqueueFailure(new Error("Version mismatch: conflict on apply"));
    await tick();
    expect(ledger.getSnapshot().status).toBe("conflict");

    // Fresh truth arrives; retry recomputes as fresh sibling ops.
    transport.deliver(snapshotOf({ content: "other", version: 2, headSequence: 1 }));
    ledger.retryConflicts(); // sends the retry batch (parked)
    transport.enqueue(echoResponse(transport.batches[1] as SentBatch, 2));
    await tick();
    const retry = transport.batches[1] as SentBatch;
    expect(retry.operations[0]?.clientOpId).not.toBe(firstId); // fresh identity
    // A full replacement is a delete+insert SIBLING PAIR from the fresh base.
    expect(retry.operations).toHaveLength(2);
    expect(retry.operations[0]?.operation).toEqual({ type: "delete", position: 0, length: 5 });
    expect(retry.operations[1]?.operation).toEqual({
      type: "insert",
      position: 0,
      content: "clashing words",
    });
    expect(retry.operations[0]?.clientSequence).toBe(1); // rebased watermark
  });

  test("never-sent stale records are re-diffed from the preserved buffer, not lost", async () => {
    const ledger = makeLedger({ debounceMs: 60_000 }); // hold edits in the buffer
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);

    ledger.onEdit("buffer words"); // buffered, never flushed
    // The server incorporates two ops; the buffered words were never based
    // on that history — the ledger must preserve them and re-diff later.
    transport.deliver(
      snapshotOf({ content: "remote a remote b", version: 3, headSequence: 2 }),
    );
    // Flush now: the diff runs against the FRESH base, words intact.
    ledger.flushNow(); // sends the batch (parked)
    transport.enqueue(echoResponse(transport.batches[0] as SentBatch, 3));
    await tick();
    const batch = transport.batches[0] as SentBatch;
    // Full replacement = delete+insert sibling pair from the fresh base.
    expect(batch.operations.map((op) => op.operation.type)).toEqual([
      "delete",
      "insert",
    ]);
    expect(batch.operations[0]?.operation).toEqual({ type: "delete", position: 0, length: 17 });
    expect(batch.operations[1]?.operation).toEqual({
      type: "insert",
      position: 0,
      content: "buffer words",
    });
    expect(batch.operations[0]?.clientSequence).toBe(2); // fresh watermark
    expect(ledger.getSnapshot().content).toContain("buffer words");
  });
});

describe("teardown and recovery", () => {
  test("destroy commits the edit buffer into the ledger synchronously (lost-teardown defect)", () => {
    const storage = window.sessionStorage;
    storage.clear();
    const ledger = makeLedger({
      storage,
      debounceMs: 60_000, // unmount lands INSIDE the debounce window
      meetingId: "meeting-t",
      clientId: "client-t",
    });
    const transport = new ScriptedTransport();
    transport.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    ledger.start(transport);

    ledger.onEdit("teardown survivor");
    ledger.destroy(); // no debounce wait — the words must be in records NOW

    const state = ledger.getSnapshot();
    expect(state.unsavedRecords).toHaveLength(1);
    expect(state.unsavedRecords[0]?.content).toContain("teardown survivor");
    // And the state is persisted for the remount.
    expect(storage.length).toBeGreaterThan(0);
  });

  test("remount recovers persisted work keyed by meetingId+clientId and resends it", async () => {
    const storage = window.sessionStorage;
    storage.clear();
    const meetingId = "meeting-r";
    const clientId = "client-r";
    const first = makeLedger({ storage, meetingId, clientId });
    const transportA = new ScriptedTransport();
    transportA.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    first.start(transportA);
    first.onEdit("recover me");
    first.destroy();

    const second = makeLedger({ storage, meetingId, clientId });
    const state = second.getSnapshot(); // recovered before any transport
    expect(state.unsavedRecords).toHaveLength(1);
    expect(state.content).toContain("recover me");
    expect(state.isLoading).toBe(false); // restored base — no loading flash

    const transportB = new ScriptedTransport();
    transportB.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    transportB.enqueue(echoResponse({ operations: [] } as SentBatch, 2));
    second.start(transportB);
    await tick();
    // The recovered words flushed to the REAL-looking transport.
    expect(transportB.batches).toHaveLength(1);
    expect((transportB.batches[0] as SentBatch).operations[0]?.operation).toEqual({
      type: "insert",
      position: 0,
      content: "recover me",
    });
  });

  test("recovery is keyed: a different meeting or client restores nothing", () => {
    const storage = window.sessionStorage;
    storage.clear();
    const first = makeLedger({
      storage,
      meetingId: "meeting-k",
      clientId: "client-k",
    });
    const transportA = new ScriptedTransport();
    transportA.setInitial(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    first.start(transportA);
    first.onEdit("private words");
    first.destroy();

    const otherMeeting = makeLedger({
      storage,
      meetingId: "meeting-other",
      clientId: "client-k",
    });
    expect(otherMeeting.getSnapshot().unsavedRecords).toHaveLength(0);

    const otherClient = makeLedger({
      storage,
      meetingId: "meeting-k",
      clientId: "client-other",
    });
    expect(otherClient.getSnapshot().unsavedRecords).toHaveLength(0);
  });
});

describe("status derivation", () => {
  test("reports loading until the first snapshot, then honest aggregate states", async () => {
    const ledger = makeLedger();
    const transport = new ScriptedTransport();
    // No initial snapshot — the store must report loading, not fake content.
    transport.setInitial(undefined);
    ledger.start(transport);
    expect(ledger.getSnapshot().isLoading).toBe(true);
    expect(ledger.getSnapshot().status).toBe("loading");

    transport.deliver(snapshotOf({ content: "", version: 1, headSequence: 0 }));
    expect(ledger.getSnapshot().status).toBe("synced");

    ledger.onEdit("typing");
    expect(ledger.getSnapshot().status).toBe("saving"); // pending batch derived

    transport.enqueue(echoResponse(transport.batches[0] as SentBatch, 1));
    await tick();
    transport.deliver(snapshotOf({ content: "typing", version: 2, headSequence: 1 }));
    expect(ledger.getSnapshot().status).toBe("synced");
    expect(ledger.getSnapshot().content).toBe("typing");
  });
});
