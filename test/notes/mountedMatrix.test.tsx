/**
 * Mounted fault matrix (docs/notes-ledger-f1/design.md §5) — the M2 proof
 * vehicle. Every case mounts the REAL useNotesLedger hook (React
 * useSyncExternalStore binding included) over the fault-injecting transport
 * in front of the REAL convex-test notes mutation/query, and asserts the
 * final server text plus no lost/duplicated keystrokes.
 *
 * Case → defect map (PR #24 audit ids):
 *   1  equal-length replacement ................ D2 (length-only diff)
 *   2  partial ack retires only accepted ops ... D1 (blanket retirement)
 *   3  reordered per-op acks ................... D1 family
 *   4  duplicate per-op acks ................... D1 family
 *   5  lost ack after apply .................... D6 (no includes() evidence)
 *   6  lost send before apply .................. D5 (same-id resend)
 *   7  stale + loading deliveries .............. D4 (monotonic ingest)
 *   8  stable snapshot identity ................ D3 (stable snapshots)
 *   9  two reconnect cycles .................... D5/D7 family (no loss/dup)
 *   10 FORBIDDEN refusal ....................... no blind resend (D5 family)
 *   11 unmount inside debounce ................. D7 (teardown recovery)
 *   12 two clients concurrent .................. D5 (version/sequence)
 *
 * Failing-before receipts: run the SAME matrix against the #24-audited
 * defect replica with
 *   NOTES_MATRIX_SUBJECT=replica pnpm vitest run --project notes \
 *     test/notes/mountedMatrix.test.tsx
 * and see test/notes/failingBefore.replica.test.tsx for the pinned
 * per-defect discriminator scenarios.
 */

import { describe, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { NotesBackend } from "./harness/backend";
import {
  mountNotesLedger,
  seedServerText,
  setupParticipant,
  waitForContent,
  waitForLoaded,
  waitForServerText,
  waitForStatus,
} from "./matrixHarness";

describe("mounted fault matrix (real ledger over the fault transport)", () => {
  test("case 1: equal-length replacement reaches the server (D2)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case1");
    await seedServerText(backend, a, "cat");
    const { hook, transport } = mountNotesLedger(backend, a, "case1-client");
    await waitForLoaded(hook);

    hook.result.current.onEdit("dog");
    await waitForServerText(backend, a.meetingId, "dog");
    await waitForContent(hook, "dog");
    await waitForStatus(hook, "synced");

    // D2 receipt: the diff is a sibling pair, not a no-op.
    expect(transport.sentBatches).toHaveLength(1);
    const ops = transport.sentBatches[0]?.operations ?? [];
    expect(ops).toHaveLength(2);
    expect(ops[0]?.operation).toEqual({ type: "delete", position: 0, length: 3 });
    expect(ops[1]?.operation).toEqual({ type: "insert", position: 0, content: "dog" });
  });

  test("case 2: partial ack retires only the accepted op; the rest resolves by identity acks (D1)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case2");
    await seedServerText(backend, a, "hello world");
    const { hook, transport } = mountNotesLedger(backend, a, "case2-client");
    await waitForLoaded(hook);

    // Two sibling ops in one batch: delete(6,5) + insert(6,"there").
    transport.faults = { keepResults: 1, pushAfterApply: false };
    hook.result.current.onEdit("hello there");

    // The echoed op retires; the unechoed op must remain visibly unsaved.
    await waitFor(() => {
      expect(
        hook.result.current.unsavedRecords.map((r) => [r.state, r.content]),
      ).toContainEqual(["unconfirmed", "there"]);
    });
    await waitForStatus(hook, "unconfirmed");
    expect(await backend.readServerText(a.meetingId)).toMatchObject({
      content: "hello there",
    });

    // The server applied BOTH ops — a fresh read carrying identity acks
    // resolves the remainder. No resend is needed.
    transport.faults = {};
    await transport.pushFreshRead();
    await waitForContent(hook, "hello there");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);
    expect(transport.sentBatches).toHaveLength(1);

    // 1 seeded op + the batch's 2 sibling ops.
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(3);
  });

  test("case 3: reordered per-op acks retire both ops exactly once (D1 family)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case3");
    await seedServerText(backend, a, "hello world");
    const { hook, transport } = mountNotesLedger(backend, a, "case3-client");
    await waitForLoaded(hook);

    transport.faults = { reorderResults: true };
    hook.result.current.onEdit("hello there");
    await waitForServerText(backend, a.meetingId, "hello there");
    await waitForContent(hook, "hello there");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);

    // 1 seeded op + the batch's 2 sibling ops — reordered acks must not
    // duplicate the application.
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(3); // no duplicated application
    expect(transport.sentBatches).toHaveLength(1); // no resend
  });

  test("case 4: duplicate per-op acks retire once, apply once (D1 family)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case4");
    await seedServerText(backend, a, "hello world");
    const { hook, transport } = mountNotesLedger(backend, a, "case4-client");
    await waitForLoaded(hook);

    transport.faults = { duplicateAcks: true };
    hook.result.current.onEdit("hello there");
    await waitForServerText(backend, a.meetingId, "hello there");
    await waitForContent(hook, "hello there");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);

    // 1 seeded op + the batch's 2 sibling ops — duplicated acks must not
    // duplicate the application.
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(3);
    expect(transport.sentBatches).toHaveLength(1);
  });

  test("case 5: lost ack after apply resolves via identity acks — never resent (D6)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case5");
    await seedServerText(backend, a, "hello ");
    const { hook, transport } = mountNotesLedger(backend, a, "case5-client");
    await waitForLoaded(hook);

    transport.faults = { dropAfterApply: true }; // server applies; response lost
    hook.result.current.onEdit("hello world");
    await waitForServerText(backend, a.meetingId, "hello world");
    await waitForContent(hook, "hello world");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);

    // The lost response must be repaired by the read's clientAcks, not by a
    // blind resend and not by includes() text matching.
    expect(transport.sentBatches).toHaveLength(1);
    const sentId = transport.sentBatches[0]?.operations[0]?.clientOpId;
    expect(sentId).toBeDefined();
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops.filter((row) => row.clientOpId === sentId)).toHaveLength(1);

    // The repair must release the in-flight batch slot: a follow-up edit
    // sends and converges (the stuck-batch regression — a response that
    // never settles used to block every later flush forever).
    hook.result.current.onEdit("hello world again");
    await waitForServerText(backend, a.meetingId, "hello world again");
    await waitForContent(hook, "hello world again");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);
    expect(transport.sentBatches).toHaveLength(2);
  }, 20_000);

  test("case 6: lost send before apply resends exactly once with the SAME clientOpId", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case6");
    await seedServerText(backend, a, "hello ");
    const { hook, transport } = mountNotesLedger(backend, a, "case6-client");
    await waitForLoaded(hook);

    transport.faults = { dropBeforeApply: true };
    hook.result.current.onEdit("hello world");
    await waitFor(() => expect(hook.result.current.transportOnline).toBe(false));
    expect(transport.sentBatches).toHaveLength(1);

    // Reconnect: a fresh read arrives, then the flush rides it.
    transport.faults = {};
    await transport.reconnect();
    await waitFor(() => expect(hook.result.current.transportOnline).toBe(true));
    await waitForServerText(backend, a.meetingId, "hello world");
    await waitForContent(hook, "hello world");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);

    expect(transport.sentBatches).toHaveLength(2);
    const firstId = transport.sentBatches[0]?.operations[0]?.clientOpId;
    const secondId = transport.sentBatches[1]?.operations[0]?.clientOpId;
    expect(firstId).toBeDefined();
    expect(secondId).toBe(firstId); // evidence-gated resend reuses identity
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops.filter((row) => row.clientOpId === firstId)).toHaveLength(1); // server dedupe
  });

  test("case 7: stale and loading deliveries never drop or rewind edits (D4)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case7");
    await seedServerText(backend, a, "hello");
    const { hook, transport } = mountNotesLedger(backend, a, "case7-client");
    await waitForLoaded(hook);
    const stale = await backend.readSnapshot(a.face, a.meetingId, "case7-client");
    expect(stale?.version).toBe(1);

    // The batch applies server-side, but neither its response nor its push
    // reaches the client (holdResponse = apply without push, response parked).
    transport.faults = { holdResponse: true };
    hook.result.current.onEdit("hello one");
    await waitForServerText(backend, a.meetingId, "hello one");
    await waitForContent(hook, "hello one"); // composed view keeps the words

    // A loading result arrives (no evidence) — the words must survive the
    // whole window (the wait proves no transient drop, not just an instant).
    transport.pushSnapshot(undefined);
    await waitFor(() => expect(hook.result.current.content).toBe("hello one"));
    expect(hook.result.current.unsavedRecords).toHaveLength(1);

    // The fresh read carries identity acks → the record retires.
    transport.faults = {};
    await transport.pushFreshRead();
    await waitForStatus(hook, "synced");
    expect(hook.result.current.content).toBe("hello one");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);

    // A STALE snapshot (older version) must be ignored outright — version,
    // content, and records hold across the window.
    transport.pushSnapshot(stale);
    await waitFor(() => expect(hook.result.current.version).toBe(2));
    expect(hook.result.current.content).toBe("hello one");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);

    expect(transport.sentBatches).toHaveLength(1); // never resent
  });

  test("case 8: snapshot identity is stable across renders and idempotent redeliveries (D3)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case8");
    await seedServerText(backend, a, "base");
    const { hook, transport } = mountNotesLedger(backend, a, "case8-client");
    await waitForLoaded(hook);

    const first = hook.result.current;
    hook.rerender({ meetingId: a.meetingId, clientId: "case8-client", debounceMs: 0 });
    expect(hook.result.current).toBe(first);

    // An idempotent redelivery (same content/version) must not churn identity.
    const same = await backend.readSnapshot(a.face, a.meetingId, "case8-client");
    transport.pushSnapshot(same);
    expect(hook.result.current).toBe(first);

    // A real change produces a new snapshot identity.
    hook.result.current.onEdit("base edited");
    await waitForContent(hook, "base edited");
    expect(hook.result.current).not.toBe(first);
  });

  test("case 9: two reconnect cycles recover every word exactly once", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case9");
    const { hook, transport } = mountNotesLedger(backend, a, "case9-client");
    await waitForLoaded(hook);

    transport.faults = { offline: true };
    hook.result.current.onEdit("first words");
    await waitFor(() => expect(hook.result.current.transportOnline).toBe(false));

    transport.faults = {};
    await transport.reconnect();
    await waitFor(() => expect(hook.result.current.transportOnline).toBe(true));
    await waitForServerText(backend, a.meetingId, "first words");
    await waitForStatus(hook, "synced");

    transport.faults = { offline: true };
    hook.result.current.onEdit("first words second words");
    await waitFor(() => expect(hook.result.current.transportOnline).toBe(false));

    transport.faults = {};
    await transport.reconnect();
    await waitForServerText(backend, a.meetingId, "first words second words");
    await waitForContent(hook, "first words second words");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);

    // Identity survives both resends; the server dedupes to one row each.
    expect(transport.sentBatches).toHaveLength(4);
    const ids = transport.sentBatches.map((b) => b.operations[0]?.clientOpId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(2);
  });

  test("case 10: FORBIDDEN refusal keeps the words, never blind-resends, and recovers on retry", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case10");
    await seedServerText(backend, a, "hello ");
    const { hook, transport } = mountNotesLedger(backend, a, "case10-client");
    await waitForLoaded(hook);

    transport.faults = { forbidden: true };
    hook.result.current.onEdit("hello world");
    await waitForStatus(hook, "conflict");
    expect(hook.result.current.content).toBe("hello world"); // words stay visible
    expect(hook.result.current.unsavedRecords.map((r) => r.state)).toContain("rejected");
    expect(hook.result.current.transportOnline).toBe(true);
    expect(transport.sentBatches).toHaveLength(1); // no blind resend

    // The refusal clears: retry re-diffs the visible words from fresh truth.
    transport.faults = {};
    hook.result.current.retryConflicts();
    await waitForServerText(backend, a.meetingId, "hello world");
    await waitForContent(hook, "hello world");
    await waitForStatus(hook, "synced");
    expect(hook.result.current.unsavedRecords).toHaveLength(0);
    expect(transport.sentBatches).toHaveLength(2);
  });

  test("case 11: unmount inside the debounce window flushes and remount recovers (D7)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case11");
    const first = mountNotesLedger(backend, a, "case11-client", 50_000);
    await waitForLoaded(first.hook);

    first.hook.result.current.onEdit("recovered words");
    first.hook.unmount(); // teardown flush + sessionStorage persist

    const second = mountNotesLedger(backend, a, "case11-client", 0);
    await waitForLoaded(second.hook);
    await waitForServerText(backend, a.meetingId, "recovered words");
    await waitForContent(second.hook, "recovered words");
    await waitForStatus(second.hook, "synced");
    expect(second.hook.result.current.unsavedRecords).toHaveLength(0);

    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(1); // recovered once, not duplicated
  });

  test("case 13: remote snapshot mid-debounce transforms the local edit from its original basis", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case13");
    await seedServerText(backend, a, "base");
    const b = await backend.joinMeeting(a.meetingId, "case13-b");
    // Long debounce: A's flush must not fire before the remote snapshot.
    const clientA = mountNotesLedger(backend, a, "case13-a", 50_000);
    const clientB = mountNotesLedger(backend, b, "case13-b", 0);
    await waitForLoaded(clientA.hook);
    await waitForLoaded(clientB.hook);

    // A types against the v1 view (buffer holds the words, debounce parked).
    clientA.hook.result.current.onEdit("base alpha");

    // B applies 'base bravo' server-side; the push moves A's base while
    // A's buffer still holds the older document.
    clientB.hook.result.current.onEdit("base bravo");
    await waitForServerText(backend, a.meetingId, "base bravo");
    await waitFor(() =>
      expect(clientA.hook.result.current.version).toBeGreaterThan(1),
    );

    // A's flush must diff its edit from the ORIGINAL basis ('base') and
    // transform it against the drift — never diff from the moved base,
    // which would send delete 'bravo' + insert 'alpha' and lose B's word.
    clientA.hook.result.current.flushNow();
    await waitForServerText(backend, a.meetingId, "base alpha bravo");
    await waitForContent(clientA.hook, "base alpha bravo");
    await waitForStatus(clientA.hook, "synced");
    await waitForContent(clientB.hook, "base alpha bravo");
    expect(clientA.hook.result.current.unsavedRecords).toHaveLength(0);

    // Seeded op + B's op + A's transformed op — no deleted remote word.
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(3);
  }, 20_000);

  test("case 12: two clients with concurrent batches converge with no lost or duplicated words (D5)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "case12");
    await seedServerText(backend, a, "base");
    const b = await backend.joinMeeting(a.meetingId, "case12-b");
    const clientA = mountNotesLedger(backend, a, "case12-a", 0);
    const clientB = mountNotesLedger(backend, b, "case12-b", 0);
    await waitForLoaded(clientA.hook);
    await waitForLoaded(clientB.hook);

    // A's batch applies but its push is suppressed — B never sees it, so B's
    // edit stays concurrent with A's applied operation.
    clientA.transport.faults = { pushAfterApply: false };
    clientA.hook.result.current.onEdit("base alpha");
    await waitForServerText(backend, a.meetingId, "base alpha");

    // B, still on the v1 basis, types concurrently. The server transforms
    // B's insert against A's equal-position insert; the lexicographic
    // tie-break (convex/notes/operations.ts) keeps " alpha" first.
    clientB.hook.result.current.onEdit("base bravo");
    await waitForServerText(backend, b.meetingId, "base alpha bravo");

    // A sees the merged content and appends on top of it.
    clientA.transport.faults = {};
    await waitForContent(clientA.hook, "base alpha bravo");
    clientA.hook.result.current.onEdit("base alpha bravo charlie");
    await waitForServerText(backend, a.meetingId, "base alpha bravo charlie");
    await waitForContent(clientA.hook, "base alpha bravo charlie");
    await waitForContent(clientB.hook, "base alpha bravo charlie");
    await waitForStatus(clientA.hook, "synced");
    await waitForStatus(clientB.hook, "synced");

    // No lost or duplicated keystrokes — the word multiset is exact.
    const server = await backend.readServerText(a.meetingId);
    expect(server.content.split(" ").sort()).toEqual(
      ["base", "alpha", "bravo", "charlie"].sort(),
    );
    // One version bump per batch: seed(1) + A(2) + B(3) + A(4).
    expect(server.version).toBe(4);
    // 1 seeded op + 3 client ops, one row each.
    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(4);
    for (const op of ops) {
      expect(ops.filter((row) => row.clientOpId === op.clientOpId)).toHaveLength(1);
    }
  });
});
