/**
 * Failing-before receipts for every PR #24 defect (docs/notes-ledger-f1/
 * design.md §5).
 *
 * The defect replica (test/notes/replica/defectReplicaLedger.tsx) implements
 * each #24-audited behavior AS DESCRIBED in the audit, written from those
 * descriptions only. Each test below runs that replica through the SAME
 * mounted harness + REAL convex-test backend as the matrix and asserts the
 * DEFECT OCCURS — the inverse of the matrix case that guards the behavior
 * against the real ledger. Green here + green matrix = fail-before,
 * pass-after, both replayable.
 *
 * Replay the full matrix against the replica directly (recorded run at the
 * milestone-2 commit: 11/12 cases fail; case 5 passes because the replica's
 * D6 retirement coincidentally matches a batch the server DID apply — the
 * D6 discriminator below covers the case it cannot):
 *
 *   NOTES_MATRIX_SUBJECT=replica pnpm vitest run --project notes \
 *     test/notes/mountedMatrix.test.tsx
 *
 * Receipt table:
 *   D1 blanket retirement ............. guards matrix case 2
 *   D2 length-only diff ............... guards matrix case 1
 *   D3 unstable snapshots ............. guards matrix case 8
 *   D4 stale/loading drop edits ....... guards matrix case 7
 *   D5 no stable resend identity ...... guards matrix cases 6/12
 *   D6 includes() confirmation ........ guards matrix case 5
 *   D7 teardown loses the buffer ...... guards matrix case 11
 */

process.env.NOTES_MATRIX_SUBJECT = "replica";

import { describe, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { NotesBackend } from "./harness/backend";
import {
  mountNotesLedger,
  seedServerText,
  setupParticipant,
  waitForLoaded,
  waitForServerText,
} from "./matrixHarness";

describe("failing-before receipts (the #24-audited replica exhibits each defect)", () => {
  test("D1: a partial response retires the whole batch — the unechoed op loses its unsaved signal (guards case 2)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "receipt-d1");
    await seedServerText(backend, a, "hi");
    const { hook, transport } = mountNotesLedger(backend, a, "d1-client");
    await waitForLoaded(hook);

    // The server will apply BOTH sibling ops but echo only the first.
    // (A length-changing edit: the replica's own D2 defect swallows
    // equal-length edits before a batch can even exist.)
    transport.faults = { keepResults: 1, pushAfterApply: false };
    hook.result.current.onEdit("hello there");

    // THE DEFECT: the replica retires everything from the truncated
    // response — nothing stays visibly unsaved (case 2 forbids this and
    // pins the ["unconfirmed","there"] record on the real ledger).
    await waitFor(() => expect(hook.result.current.unsavedRecords).toHaveLength(0));
    expect(transport.sentBatches).toHaveLength(1); // retired without evidence of the second op
  });

  test("D2: an equal-length replacement is a no-op — the words never save (guards case 1)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "receipt-d2");
    await seedServerText(backend, a, "cat");
    const { hook, transport } = mountNotesLedger(backend, a, "d2-client");
    await waitForLoaded(hook);

    hook.result.current.onEdit("dog");

    // THE DEFECT: the length-only diff emits no ops; nothing is sent and
    // the server text never changes (case 1 pins the sibling pair).
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(transport.sentBatches).toHaveLength(0);
    expect(await backend.readServerText(a.meetingId)).toMatchObject({ content: "cat" });
  });

  test("D3: an idempotent redelivery churns the snapshot identity (guards case 8)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "receipt-d3");
    await seedServerText(backend, a, "base");
    const { hook, transport } = mountNotesLedger(backend, a, "d3-client");
    await waitForLoaded(hook);

    const first = hook.result.current;
    const same = await backend.readSnapshot(a.face, a.meetingId, "d3-client");
    transport.pushSnapshot(same);

    // THE DEFECT: every emission rebuilds the result object, so consumers
    // keyed on identity (memos, effects) re-fire with no real change
    // (case 8 pins identity stability on the real ledger).
    await waitFor(() => expect(hook.result.current).not.toBe(first));
  });

  test("D4: a loading delivery drops the user's words (guards case 7)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "receipt-d4");
    await seedServerText(backend, a, "hello");
    const { hook, transport } = mountNotesLedger(backend, a, "d4-client");
    await waitForLoaded(hook);

    transport.faults = { holdResponse: true };
    hook.result.current.onEdit("hello one");
    await waitForServerText(backend, a.meetingId, "hello one");

    // THE DEFECT: a loading result (no evidence) resets the view and drops
    // the unsent/in-flight words (case 7 pins content preservation).
    transport.pushSnapshot(undefined);
    await waitFor(() => expect(hook.result.current.content).toBe(""));
  });

  test("D5: a resend after a lost send uses a NEW clientOpId (guards cases 6/12)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "receipt-d5");
    await seedServerText(backend, a, "hello ");
    const { hook, transport } = mountNotesLedger(backend, a, "d5-client");
    await waitForLoaded(hook);

    transport.faults = { dropBeforeApply: true };
    hook.result.current.onEdit("hello world");
    await waitFor(() => expect(transport.sentBatches).toHaveLength(1));

    transport.faults = {};
    await transport.reconnect();
    await waitForServerText(backend, a.meetingId, "hello world");

    // THE DEFECT: the retry re-diffs the buffer under a fresh id, so the
    // server cannot dedupe a duplicate application of the SAME logical op
    // (case 6 pins same-identity resends on the real ledger).
    await waitFor(() => expect(transport.sentBatches).toHaveLength(2));
    const firstId = transport.sentBatches[0]?.operations[0]?.clientOpId;
    const secondId = transport.sentBatches[1]?.operations[0]?.clientOpId;
    expect(firstId).toBeDefined();
    expect(secondId).not.toBe(firstId);
  });

  test("D6: coincidental text retires an op the server never applied (guards case 5)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "receipt-d6");
    await seedServerText(backend, a, "hello");
    const other = await backend.joinMeeting(a.meetingId, "d6-other");
    const { hook, transport } = mountNotesLedger(backend, a, "d6-client");
    await waitForLoaded(hook);

    // The replica's own insert (" world") is parked BEFORE reaching the
    // server; meanwhile another client inserts the SAME text. The other
    // client reads first so its clientSequence is its true incorporated
    // watermark — otherwise the server transforms the position against the
    // unseen seed op and rejects the insert outright.
    transport.faults = { holdBeforeApply: true };
    hook.result.current.onEdit("hello world");
    await waitFor(() => expect(transport.sentBatches).toHaveLength(1));
    const otherSnap = await backend.readSnapshot(other.face, a.meetingId, "d6-other");
    if (!otherSnap) throw new Error("d6: the other client's read must return a snapshot");
    await backend.applyBatch(other.face, a.meetingId, "d6-other-client", {
      operations: [
        {
          operation: { type: "insert", position: 5, content: " world" },
          clientSequence: otherSnap.headSequence,
          clientOpId: "d6-other-op",
        },
      ],
    });

    // THE DEFECT: the fresh read contains " world" (from the other client),
    // and includes() matching retires the replica's op as if confirmed —
    // no row for the replica's clientOpId will ever exist (case 5 pins
    // identity-ack resolution on the real ledger).
    await waitFor(() => expect(hook.result.current.unsavedRecords).toHaveLength(0));
    const ops = await backend.readNoteOps(a.meetingId);
    const replicaId = transport.sentBatches[0]?.operations[0]?.clientOpId;
    expect(ops.filter((row) => row.clientOpId === replicaId)).toHaveLength(0);
  });

  test("D7: an unmount inside the debounce window drops the buffer — remount recovers nothing (guards case 11)", async () => {
    const backend = new NotesBackend();
    const a = await setupParticipant(backend, "receipt-d7");
    const first = mountNotesLedger(backend, a, "d7-client", 50_000);
    await waitForLoaded(first.hook);

    first.hook.result.current.onEdit("recovered words");
    first.hook.unmount(); // the replica's teardown does not commit or persist

    const second = mountNotesLedger(backend, a, "d7-client", 0);
    await waitForLoaded(second.hook);

    // THE DEFECT: nothing was flushed or persisted; the words are gone.
    await waitFor(() => expect(second.hook.result.current.isLoading).toBe(false));
    expect(await backend.readServerText(a.meetingId)).toMatchObject({ content: "" });
    expect(second.hook.result.current.content).toBe("");
  });
});
