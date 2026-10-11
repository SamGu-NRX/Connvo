/**
 * End-to-end receipt for the client/server note payload contract.
 *
 * Repairs the defect where src/hooks/useCollaborativeNotes.ts sent payloads
 * the registered mutations reject:
 *   - `clientTimestamp` instead of the required `clientSequence`,
 *   - insert ops keyed `text` instead of the validator's `content`,
 *   - batch ops sent as a flat operation array instead of
 *     `{ operation, clientSequence }` elements.
 *
 * These tests drive REAL round trips (client-shaped payload ->
 * registered mutation -> persisted note state -> returned value) through the
 * convex-test harness and print the captured exchange as JSON
 * (tagged NOTES_PAYLOAD_RECEIPT_JSON) for docs/hardening-20261009/
 * notes-payload-receipt.md. Values shown in the receipt are the ones observed
 * on the run that produced the doc; ids and timestamps vary per run.
 */

import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createTestEnvironment,
  createTestMeetingWithParticipants,
  resetAllMocks,
  setupTestMocks,
  cleanupTestMocks,
} from "../../test/convex/helpers";
import {
  buildNoteOperationRequest,
  buildBatchNoteOperationsRequest,
  calculateOperation,
} from "../../src/hooks/useCollaborativeNotes";

describe("Notes payload contract (end-to-end receipt)", () => {
  let t: ReturnType<typeof createTestEnvironment>;
  let meetingId: Id<"meetings">;
  let organizerWorkosId = "";
  let participantWorkosId = "";

  const receipt: Record<string, unknown> = {};

  beforeEach(async () => {
    t = createTestEnvironment();
    setupTestMocks();
    resetAllMocks();

    const meeting = await createTestMeetingWithParticipants(t, {}, 1, {
      title: "Notes Payload Receipt Meeting",
    });
    meetingId = meeting.meetingId;
    organizerWorkosId = meeting.organizerWorkosId;
    participantWorkosId = meeting.participantWorkosIds[0];
  });

  afterEach(() => {
    cleanupTestMocks();
  });

  it("round trip 1: repaired client payload is accepted and persisted on a fresh note", async () => {
    const writerT = t.withIdentity({
      subject: organizerWorkosId,
      email: "organizer@example.com",
      name: "Organizer",
      org_id: "test-org",
      org_role: "member",
    });

    // What the hook computes locally (hook-level shape, still uses `text`).
    const hookOperation = calculateOperation("", "Hello");
    expect(hookOperation).toEqual({
      type: "insert",
      position: 0,
      text: "Hello",
    });

    // What the repaired hook sends over the wire.
    const request = buildNoteOperationRequest(meetingId, hookOperation, 0);

    const result = await writerT.mutation(
      api.notes.mutations.applyNoteOperation,
      request,
    );

    expect(result).toEqual({
      success: true,
      serverSequence: 1,
      transformedOperation: {
        type: "insert",
        position: 0,
        content: "Hello",
      },
      newVersion: 1,
      conflicts: [],
    });

    // Persisted state.
    const persisted = await t.run(async (ctx) => {
      const note = await ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique();
      const ops = await ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) =>
          q.eq("meetingId", meetingId),
        )
        .order("asc")
        .collect();
      return { note, ops };
    });

    expect(persisted.note?.content).toBe("Hello");
    expect(persisted.note?.version).toBe(1);
    expect(persisted.ops).toHaveLength(1);
    expect(persisted.ops[0].sequence).toBe(1);
    expect(persisted.ops[0].operation).toEqual({
      type: "insert",
      position: 0,
      content: "Hello",
      length: undefined,
    });

    receipt.roundTrip1 = {
      note: "fresh note, no concurrent ops",
      hookOperation,
      wireRequest: request,
      response: result,
      persistedNote: {
        content: persisted.note?.content,
        version: persisted.note?.version,
      },
      persistedOp: {
        sequence: persisted.ops[0].sequence,
        operation: persisted.ops[0].operation,
        applied: persisted.ops[0].applied,
      },
    };
  });

  it("round trip 2: server transforms an op sent from a stale client window (OT protection)", async () => {
    const organizerT = t.withIdentity({
      subject: organizerWorkosId,
      email: "organizer@example.com",
      name: "Organizer",
      org_id: "test-org",
      org_role: "member",
    });
    const participantT = t.withIdentity({
      subject: participantWorkosId,
      email: "participant-0@example.com",
      name: "Participant 1",
      org_id: "test-org",
      org_role: "member",
    });

    // Organizer applies op 1: "Hello".
    await organizerT.mutation(
      api.notes.mutations.applyNoteOperation,
      buildNoteOperationRequest(
        meetingId,
        calculateOperation("", "Hello"),
        0,
      ),
    );

    // Organizer applies op 2: "Hello" -> "HeXYllo" (server now at sequence
    // 2, version 2).
    await organizerT.mutation(
      api.notes.mutations.applyNoteOperation,
      buildNoteOperationRequest(
        meetingId,
        { type: "insert", position: 2, text: "XY" },
        1,
      ),
    );

    // Participant edits from a stale window: their client has only
    // incorporated op 1 (view "Hello", known sequence 1) while the server is
    // at sequence 2. Their append-at-5 is valid for THEIR view, so the server
    // transforms it against op 2 (inserted "XY" before their position):
    // position shifts 5 -> 7 and the concurrent op is reported as a conflict
    // source.
    const staleRequest = buildNoteOperationRequest(
      meetingId,
      { type: "insert", position: 5, text: "!" },
      1,
    );
    const result = await participantT.mutation(
      api.notes.mutations.applyNoteOperation,
      staleRequest,
    );

    expect(result.success).toBe(true);
    expect(result.serverSequence).toBe(3);
    expect(result.newVersion).toBe(3);
    // Position shifted past the concurrent insert's content (5 -> 7) and
    // the concurrent op is reported as a conflict source.
    expect(result.transformedOperation).toEqual({
      type: "insert",
      position: 7,
      content: "!",
    });
    expect(result.conflicts).toHaveLength(1);

    const persisted = await t.run(async (ctx) => {
      const note = await ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique();
      const op = await ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) =>
          q.eq("meetingId", meetingId).eq("sequence", 3),
        )
        .unique();
      return { note, op };
    });

    expect(persisted.note?.content).toBe("HeXYllo!");
    expect(persisted.op?.operation.position).toBe(7);
    expect(persisted.op?.operation.content).toBe("!");

    receipt.roundTrip2 = {
      note: "stale client window: view \"Hello\" at sequence 1 while server is at sequence 2; server transforms position 5 -> 7",
      wireRequest: staleRequest,
      response: {
        success: result.success,
        serverSequence: result.serverSequence,
        transformedOperation: result.transformedOperation,
        newVersion: result.newVersion,
        conflicts: result.conflicts,
      },
      persistedNote: {
        content: persisted.note?.content,
        version: persisted.note?.version,
      },
      persistedOp: {
        sequence: persisted.op?.sequence,
        operation: persisted.op?.operation,
      },
    };
  });

  it("round trip 3: repaired batch payload (wrapped elements) is accepted and composed in order", async () => {
    const organizerT = t.withIdentity({
      subject: organizerWorkosId,
      email: "organizer@example.com",
      name: "Organizer",
      org_id: "test-org",
      org_role: "member",
    });

    await organizerT.mutation(
      api.notes.mutations.applyNoteOperation,
      buildNoteOperationRequest(
        meetingId,
        calculateOperation("", "Hello"),
        0,
      ),
    );
    await organizerT.mutation(
      api.notes.mutations.applyNoteOperation,
      buildNoteOperationRequest(
        meetingId,
        { type: "insert", position: 5, text: "World" },
        1,
      ),
    );

    // Batch against the "HelloWorld" state: append "!" and delete "Hello".
    const batchRequest = buildBatchNoteOperationsRequest(
      meetingId,
      [
        { type: "insert", position: 10, text: "!" },
        { type: "delete", position: 0, length: 5 },
      ],
      2,
    );

    const result = await organizerT.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      batchRequest,
    );

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.newVersion).toBe(3);
    expect(result.results.map((r) => r.serverSequence)).toEqual([3, 4]);

    const persisted = await t.run(async (ctx) => {
      const note = await ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique();
      return note;
    });

    expect(persisted?.content).toBe("World!");
    expect(persisted?.version).toBe(3);

    receipt.roundTrip3 = {
      note: "batch: elements wrapped as { operation, clientSequence }",
      wireRequest: batchRequest,
      response: {
        success: result.success,
        processed: result.processed,
        failed: result.failed,
        newVersion: result.newVersion,
        results: result.results,
      },
      persistedNote: {
        content: persisted?.content,
        version: persisted?.version,
      },
    };
  });

  it("records the legacy defect: the pre-repair payload shapes are rejected", async () => {
    const organizerT = t.withIdentity({
      subject: organizerWorkosId,
      email: "organizer@example.com",
      name: "Organizer",
      org_id: "test-org",
      org_role: "member",
    });

    // (a) clientTimestamp instead of the required clientSequence.
    let timestampError = "";
    try {
      await organizerT.mutation(api.notes.mutations.applyNoteOperation, {
        meetingId,
        operation: { type: "insert", position: 0, content: "X" },
        clientTimestamp: Date.now(),
      } as never);
      expect.fail("Should have thrown a validation error");
    } catch (error) {
      timestampError = error instanceof Error ? error.message : String(error);
      expect(timestampError).toMatch(/clientSequence/i);
    }

    // (b) insert keyed `text` (the hook's field) instead of `content`.
    let textFieldError = "";
    try {
      await organizerT.mutation(api.notes.mutations.applyNoteOperation, {
        meetingId,
        operation: { type: "insert", position: 0, text: "X" },
        clientSequence: 0,
      } as never);
      expect.fail("Should have thrown a validation error");
    } catch (error) {
      textFieldError = error instanceof Error ? error.message : String(error);
      // Convex's args validator is strict: the unknown `text` key is
      // rejected before the handler's validateOperation ever runs.
      expect(textFieldError).toMatch(/Unexpected field `text`/i);
    }

    // (c) batch sent as a flat operation array without clientSequence.
    let flatBatchError = "";
    try {
      await organizerT.mutation(api.notes.mutations.batchApplyNoteOperations, {
        meetingId,
        operations: [{ type: "insert", position: 0, text: "X" }],
        clientTimestamp: Date.now(),
      } as never);
      expect.fail("Should have thrown a validation error");
    } catch (error) {
      flatBatchError = error instanceof Error ? error.message : String(error);
      expect(flatBatchError).toMatch(/clientSequence|operation/i);
    }

    receipt.legacyDefect = {
      note: "pre-repair payload shapes (all rejected before the fix)",
      clientTimestampInsteadOfSequence: {
        error: timestampError,
      },
      textInsteadOfContent: {
        error: textFieldError,
      },
      flatBatchArray: {
        error: flatBatchError,
      },
    };
  });

  it("prints the captured receipt for docs/hardening-20261009/notes-payload-receipt.md", async () => {
    // The receipt content is captured by the round-trip tests above; this
    // test emits it in a greppable block. Each test gets a fresh environment
    // from beforeEach, so this one additionally re-derives a complete
    // exchange (self-check) to guarantee non-empty output on its own.
    const organizerT = t.withIdentity({
      subject: organizerWorkosId,
      email: "organizer@example.com",
      name: "Organizer",
      org_id: "test-org",
      org_role: "member",
    });

    const hookOperation = calculateOperation("", "Hello");
    const request = buildNoteOperationRequest(meetingId, hookOperation, 0);
    const result = await organizerT.mutation(
      api.notes.mutations.applyNoteOperation,
      request,
    );

    receipt.selfCheck = {
      note: "fresh environment re-derivation of round trip 1",
      hookOperation,
      wireRequest: request,
      response: result,
    };

    // The receipt JSON is emitted for tooling; the values captured here are
    // recorded verbatim in docs/hardening-20261009/notes-payload-receipt.md.
    console.log(
      "NOTES_PAYLOAD_RECEIPT_JSON " + JSON.stringify(receipt, null, 2),
    );

    expect(result.success).toBe(true);
  });
});
