/**
 * M2 component scenarios for the in-call collaborative-notes client.
 *
 * These tests drive the REAL `useCollaborativeNotes` hook through
 * `fakeMeetingTransport` and assert EXACT per-scenario outcomes
 * (preserved / lost / duplicate counts) — the table is recorded in
 * docs/in-call-client-20261010/alignment.md. They complement the four
 * M1 contract witnesses (which stay unchanged).
 *
 * Harness: identical to the witnesses (plain node + React server
 * renderer, convex/react routed to the fake transport; the hook is
 * re-mounted whenever updated output must be observed). The fake
 * transport's bridge semantics (apply-on-dispatch, version bump per op,
 * no dedupe) mirror behaviors verified against the REAL registered
 * endpoints in test/convex/in-call-server-contract.test.ts — hook and
 * ledger behavior claims are witnessed here; server-behavior claims live
 * only in that convex-test file.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { useCollaborativeNotes } from "@/hooks/useCollaborativeNotes";
import {
  getNotesOperationLedger,
  NoteOperationsRejectedError,
  resetNotesOperationLedger,
} from "@/hooks/collaborativeNotesLedger";
import {
  createFakeMeetingTransport,
  setCurrentTransport,
  type FakeMeetingTransport,
} from "./fakeMeetingTransport";

// Route the hook's convex/react bindings to the transport installed by
// the current test (resolved lazily at render time).
vi.mock("convex/react", async () => {
  const mod = await import("./fakeMeetingTransport");
  return {
    useMutation: (ref: unknown) => mod.getCurrentTransport().useMutation(ref),
    useQuery: (ref: unknown, args?: unknown) =>
      mod.getCurrentTransport().useQuery(ref, args),
  };
});

// The generated api refs are Proxied and not identity-stable; the
// transport reads __convexPath to route by endpoint name.
vi.mock("@convex/_generated/api", async () => {
  const makeNode = (path: string): unknown =>
    new Proxy(function () {} as object, {
      get: (_target, prop) => {
        if (prop === "__convexPath") return path;
        if (typeof prop !== "string" || prop === "then") return undefined;
        return makeNode(path + "." + prop);
      },
    });
  return { api: makeNode("api") };
});

const meetingId = "scenarios-meeting" as Id<"meetings">;

type HookResult = ReturnType<typeof useCollaborativeNotes>;

let lastHook: HookResult | null = null;

function HookProbe(): null {
  lastHook = useCollaborativeNotes(meetingId);
  return null;
}

/** Mount the real hook and return its latest rendered result. */
function renderHook(): HookResult {
  lastHook = null;
  renderToStaticMarkup(React.createElement(HookProbe));
  const hook = lastHook;
  if (!hook) {
    throw new Error("hook did not render");
  }
  return hook;
}

/** Resolve with the rejection (or undefined on success) — for scenarios
 * where the edit outcome is observed through the ledger, not the throw. */
function settle(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (error) => error,
  );
}

let transport: FakeMeetingTransport;

beforeEach(() => {
  transport = createFakeMeetingTransport();
  setCurrentTransport(transport);
  resetNotesOperationLedger(meetingId);
});

function batchCount(): number {
  return transport.sentMutations.filter((m) =>
    m.name.endsWith("batchApplyNoteOperations"),
  ).length;
}

function batchAt(index: number): {
  operations: Array<{ operation: unknown; clientSequence: number }>;
  expectedVersion?: number;
} {
  const batches = transport.sentMutations.filter((m) =>
    m.name.endsWith("batchApplyNoteOperations"),
  );
  return batches[index]!.args as {
    operations: Array<{ operation: unknown; clientSequence: number }>;
    expectedVersion?: number;
  };
}

/** The single ledger key whose state equals `state` (fails if not unique). */
function keyInState(hook: HookResult, state: string): string {
  const matches = [...hook.operationStates.entries()]
    .filter(([, s]) => s === state)
    .map(([k]) => k);
  expect(matches, `expected exactly one ${state} op`).toHaveLength(1);
  return matches[0]!;
}

describe("useCollaborativeNotes M2 scenarios", () => {
  it("delayed ack: edit stays pending until the ack, then saved exactly once", async () => {
    const hook = renderHook();

    transport.withholdAcks();
    const outcome = hook.applyOperations([
      { type: "insert", position: 0, content: "delayed" },
    ]);

    const mid = renderHook();
    const key = keyInState(mid, "pending");
    expect(mid.unsavedOperationIds).toContain(key);
    // The server applied the op at dispatch (apply-on-ack later), so the
    // document already shows it — exactly once.
    expect(transport.docContent()).toBe("delayed");
    expect(transport.docVersion()).toBe(1);
    expect(mid.content).toBe("delayed");
    expect(batchCount()).toBe(1);

    transport.flushAcks();
    await outcome;

    const final = renderHook();
    expect(final.operationStates.get(key)).toBe("saved");
    expect(final.unsavedOperationIds).not.toContain(key);
    expect(final.content).toBe("delayed"); // no optimistic double-apply
    expect(final.duplicateAcknowledgementCount).toBe(0);
    // EXACT scenario outcome: preserved 1, lost 0, duplicates 0.
  });

  it("out-of-order acks: two edits acked in reverse order — both saved, content exact", async () => {
    const hook = renderHook();

    transport.withholdAcks();
    const first = hook.applyOperations([
      { type: "insert", position: 0, content: "alpha" },
    ]);
    const second = hook.applyOperations([
      { type: "insert", position: 5, content: "-bravo" },
    ]);
    // Both applied server-side at dispatch, in clientSequence order.
    expect(transport.docContent()).toBe("alpha-bravo");
    expect(transport.docVersion()).toBe(2);

    // Deliver the SECOND ack first — network reordering.
    transport.flushAcksInOrder([1, 0]);
    await Promise.all([first, second]);

    const final = renderHook();
    const entries = [...final.operationStates.entries()];
    expect(entries).toHaveLength(2);
    for (const [, state] of entries) {
      expect(state).toBe("saved");
    }
    expect(final.duplicateAcknowledgementCount).toBe(0);
    // The stale newVersion carried by the late first ack must not
    // regress anything: content and version stay at server truth.
    expect(final.content).toBe("alpha-bravo");
    expect(final.version).toBe(2);
    expect(transport.docContent()).toBe("alpha-bravo");
    // EXACT scenario outcome: preserved 2, lost 0, duplicates 0.
  });

  it("duplicate responses for an already-saved operationId change nothing and are observable", () => {
    // The transport can deliver a second response for the same
    // operationId only through the ledger's own settle path (one
    // deferred per send), so the duplicate-response contract is
    // exercised directly on the ledger the hook uses.
    const ledger = getNotesOperationLedger("duplicate-response-meeting");
    const submission = ledger.submit("op-duplicate-1", {
      type: "insert",
      position: 0,
      content: "x",
    });
    const entry = { ledgerKey: submission.ledgerKey };

    ledger.markSendBatch([entry], 0);
    ledger.settleBatchSaved([submission.ledgerKey], 1); // the ack
    ledger.settleBatchSaved([submission.ledgerKey], 1); // duplicate ack
    ledger.settleBatchFailed(
      [submission.ledgerKey],
      { code: "NETWORK_LOST", message: "late ambiguous failure" },
    ); // a late failure for an already-saved op

    const record = ledger.getRecord(submission.ledgerKey);
    expect(record?.state).toBe("saved"); // state unchanged
    expect(record?.savedAtVersion).toBe(1); // version not regressed
    expect(record?.duplicateAcks).toBe(2); // both late responses observed
    expect(ledger.duplicateCount).toBe(2);
  });

  it("removed participation: rollback + explicit rejected state, words preserved in the ledger", async () => {
    const hook = renderHook();

    transport.removeParticipant();
    const failure = await settle(
      hook.applyOperations([
        { type: "insert", position: 0, content: "ghost edit" },
      ]),
    );
    expect(failure).toBeInstanceOf(NoteOperationsRejectedError);

    const final = renderHook();
    const [key] = [...final.operationStates.keys()];
    expect(final.operationStates.get(key)).toBe("rejected");
    expect(final.unsavedOperationIds).toEqual([key]); // explicitly unsaved
    // The DOCUMENT rolled back to the last server-confirmed content…
    expect(final.content).toBe("");
    expect(transport.docContent()).toBe("");
    expect(final.version).toBe(0);
    // …while the user's words are NOT silently discarded — they stay in
    // the ledger record, distinct from document state.
    expect(final.operationRecords.get(key)?.operation.content).toBe(
      "ghost edit",
    );
    // EXACT scenario outcome: preserved 0 in document (rolled back),
    // lost 0 (words kept in ledger), duplicates 0, re-sends 0.
    expect(batchCount()).toBe(1);
  });

  it("repeat reconnects: two cut/restore cycles — exact preserved/lost/duplicate outcomes", async () => {
    let hook = renderHook();

    // Cycle 1: type while the connection is cut, then reconnect.
    transport.cutConnection();
    const first = hook.applyOperations([
      { type: "insert", position: 0, content: "one" },
    ]);
    let mid = renderHook();
    const [key1] = [...mid.operationStates.keys()];
    expect(mid.operationStates.get(key1)).toBe("pending"); // queued locally
    expect(mid.content).toBe("one"); // offline text stays visible
    expect(transport.docContent()).toBe(""); // not yet applied
    await transport.restore();
    await first;
    hook = renderHook();
    expect(hook.operationStates.get(key1)).toBe("saved");

    // Cycle 2: same again — text typed offline composes on top.
    transport.cutConnection();
    const second = hook.applyOperations([
      { type: "insert", position: 3, content: "-two" },
    ]);
    mid = renderHook();
    const key2 = [...mid.operationStates.keys()].find((k) => k !== key1)!;
    expect(mid.operationStates.get(key2)).toBe("pending");
    expect(mid.content).toBe("one-two");
    await transport.restore();
    await second;
    hook = renderHook();
    expect(hook.operationStates.get(key2)).toBe("saved");

    // EXACT outcome table for ≥2 reconnect cycles:
    // preserved 2, lost 0, duplicates 0, re-sends 0.
    expect(batchCount()).toBe(2); // one batch per edit — no re-send
    expect(hook.duplicateAcknowledgementCount).toBe(0);
    expect(hook.unsavedOperationIds).toEqual([]);
    expect(hook.content).toBe("one-two");
    expect(hook.version).toBe(2);
    expect(transport.docContent()).toBe("one-two");
    // The second batch carried its ORIGINAL per-meeting clientSequence.
    expect(batchAt(1).operations[0]!.clientSequence).toBe(2);
  });

  it("ack lost after apply: reconcile confirms from server evidence and never re-sends", async () => {
    const hook = renderHook();

    transport.failNextSendAfterApply();
    const failure = await settle(
      hook.applyOperations([
        { type: "insert", position: 0, content: "lost-ack" },
      ]),
    );
    expect(failure).toBeInstanceOf(NoteOperationsRejectedError);
    expect(transport.docContent()).toBe("lost-ack"); // the server applied it
    expect(transport.docVersion()).toBe(1);

    const mid = renderHook();
    const key = keyInState(mid, "unconfirmed"); // explicitly unconfirmed
    expect(mid.unsavedOperationIds).toContain(key);
    expect(mid.content).toBe("lost-ack"); // no doubling, no vanish
    expect(batchCount()).toBe(1);

    const report = await mid.reconcile();
    expect(report.confirmedIds).toEqual([key]); // confirmed from evidence
    expect(report.reSentIds).toEqual([]); // NEVER re-sent
    expect(report.unconfirmedIds).toEqual([]);
    expect(batchCount()).toBe(1); // reconcile made no network call

    const final = renderHook();
    expect(final.operationStates.get(key)).toBe("saved");
    expect(final.unsavedOperationIds).not.toContain(key);
    expect(final.content).toBe("lost-ack");
    expect(final.duplicateAcknowledgementCount).toBe(0);
    // EXACT scenario outcome: preserved 1 (confirmed via reconcile),
    // lost 0, duplicates 0, re-sends 0.
  });

  it("send lost before apply: reconcile re-sends the original op exactly once", async () => {
    const hook = renderHook();

    transport.failNextSendBeforeApply();
    const failure = await settle(
      hook.applyOperations([
        { type: "insert", position: 0, content: "retry-me" },
      ]),
    );
    expect(failure).toBeInstanceOf(NoteOperationsRejectedError);
    expect(transport.docContent()).toBe(""); // the server never applied it
    expect(transport.docVersion()).toBe(0);

    const mid = renderHook();
    const key = keyInState(mid, "unconfirmed");
    expect(mid.unsavedOperationIds).toContain(key);
    expect(mid.content).toBe("retry-me"); // words stay visible while unconfirmed
    expect(batchCount()).toBe(1);

    const report = await mid.reconcile();
    expect(report.reSentIds).toEqual([key]); // re-sent…
    expect(report.confirmedIds).toEqual([]);
    expect(report.unconfirmedIds).toEqual([]);
    expect(batchCount()).toBe(2);

    const final = renderHook();
    expect(final.operationStates.get(key)).toBe("saved");
    expect(final.content).toBe("retry-me"); // applied exactly once
    expect(transport.docContent()).toBe("retry-me");
    expect(final.duplicateAcknowledgementCount).toBe(0);
    // …with its ORIGINAL operationId and clientSequence (first op → 1).
    expect(batchAt(1).operations[0]!.clientSequence).toBe(1);
    expect(transport.sentMutations.length).toBe(2); // no extra sends
    // EXACT scenario outcome: preserved 1, lost 0, duplicates 0,
    // re-sends 1.
  });

  it("unknowable outcome: response lost on a delete stays explicitly unconfirmed — never blind-resend", async () => {
    const hook = renderHook();
    await hook.applyOperations([
      { type: "insert", position: 0, content: "abcdef" },
    ]);

    transport.failNextSendAfterApply();
    const failure = await settle(
      hook.applyOperations([{ type: "delete", position: 0, length: 3 }]),
    );
    expect(failure).toBeInstanceOf(NoteOperationsRejectedError);
    expect(transport.docContent()).toBe("def"); // applied server-side
    expect(transport.docVersion()).toBe(2);

    const mid = renderHook();
    const key = keyInState(mid, "unconfirmed");
    expect(mid.unsavedOperationIds).toContain(key);
    expect(batchCount()).toBe(2);

    // A delete's effect is not identifiable in the content (the deleted
    // text is gone), and another writer could explain the version bump:
    // the outcome is UNKNOWABLE, so reconcile must not re-send.
    const report = await mid.reconcile();
    expect(report.unconfirmedIds).toEqual([key]);
    expect(report.reSentIds).toEqual([]);
    expect(report.confirmedIds).toEqual([]);
    expect(batchCount()).toBe(2);

    const final = renderHook();
    expect(final.operationStates.get(key)).toBe("unconfirmed"); // stays surfaced
    expect(final.unsavedOperationIds).toContain(key);
    expect(final.content).toBe("def"); // server truth; no phantom re-delete
    // EXACT scenario outcome: preserved 0, lost 0 (surfaced as
    // unconfirmed work), duplicates 0, re-sends 0.
  });
});
