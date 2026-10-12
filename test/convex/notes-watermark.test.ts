/**
 * Server-side operation identity / watermark tests (notes-ledger F1, M1).
 *
 * Proves the additive protocol in convex/notes/mutations.ts and
 * convex/notes/queries.ts (contract: docs/notes-ledger-f1/design.md §2):
 *  - per-op identity (clientId / clientOpId / clientSequence) persisted on the
 *    noteOps row in the same transaction as the text change
 *  - results[] echo per-op identity; failedOps carry index + identity + reason
 *  - idempotent dedupe on (meetingId, clientId, clientOpId)
 *  - a wholly duplicate batch replay leaves the notes row's version,
 *    updatedAt and content untouched; a mix batch still bumps once
 *  - getMeetingNotes headSequence + clientAcks watermarks with clientId
 *  - legacy shapes and auth behavior byte-identical without identity
 *
 * Every assertion observes behavior through the public mutation/query APIs and
 * compares against literal expected values.
 */

import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import {
  addMeetingParticipant,
  createTestEnvironment,
  createTestMeeting,
  createTestUser,
} from "./helpers";

type TestEnv = ReturnType<typeof createTestEnvironment>;

/** Builds an identity whose subject resolves to the given workosUserId. */
function asAuthed(t: TestEnv, workosUserId: string) {
  return t.withIdentity({
    subject: workosUserId,
    tokenIdentifier: `tok-${workosUserId}`,
    name: workosUserId,
  });
}

/**
 * Creates a meeting with one organizer and every given workosUserId as a
 * "participant" role member (the role assertMeetingAccess accepts).
 */
async function setupMeetingWithParticipants(
  t: TestEnv,
  workosUserIds: string[],
) {
  const organizerId = await createTestUser(t, {
    workosUserId: `organizer-${workosUserIds[0]}`,
  });
  const meetingId = await createTestMeeting(t, organizerId);
  for (const workosUserId of workosUserIds) {
    const userId = await createTestUser(t, { workosUserId });
    await addMeetingParticipant(t, meetingId, userId, "participant");
  }
  return meetingId;
}

async function getStoredNote(
  t: TestEnv,
  meetingId: Awaited<ReturnType<typeof createTestMeeting>>,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique(),
  );
}

async function getStoredIdentityRows(
  t: TestEnv,
  meetingId: Awaited<ReturnType<typeof createTestMeeting>>,
  clientId: string,
  clientOpId: string,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("noteOps")
      .withIndex("by_meeting_client_op", (q) =>
        q
          .eq("meetingId", meetingId)
          .eq("clientId", clientId)
          .eq("clientOpId", clientOpId),
      )
      .collect(),
  );
}

describe("notes operation identity & watermark (F1 M1)", () => {
  test("1. persists per-op identity on the noteOps row in the same transaction", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    const response = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "hello" },
            clientSequence: 0,
            clientOpId: "op-1",
          },
        ],
      },
    );
    expect(response.processed).toBe(1);

    // Identity is readable through the dedupe index immediately after the
    // mutation resolves — it was written in the same transaction as the text.
    const rows = await getStoredIdentityRows(t, meetingId, "client-a", "op-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientId: "client-a",
      clientOpId: "op-1",
      clientSequence: 0,
      applied: true,
      sequence: 1,
    });

    // Text and identity landed together.
    const note = await getStoredNote(t, meetingId);
    expect(note?.content).toBe("hello");
  });

  test("2. echoes per-op identity in results for batch and single-op mutations", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    // Seed "AB" (sequence 1, version 1) so the batch's sibling ops sit on a
    // shared basis (clientSequence 1) at non-overlapping positions.
    await alice.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId: "client-a",
      operations: [
        {
          operation: { type: "insert", position: 0, content: "AB" },
          clientSequence: 0,
          clientOpId: "seed",
        },
      ],
    });

    const response = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            // Both siblings composed on the SAME base "AB" (len 2): both
            // append at position 2 — the only in-bounds non-zero anchor.
            operation: { type: "insert", position: 2, content: "C" },
            clientSequence: 1,
            clientOpId: "op-1",
          },
          {
            operation: { type: "insert", position: 2, content: "D" },
            clientSequence: 1,
            clientOpId: "op-2",
          },
        ],
      },
    );

    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toMatchObject({
      serverSequence: 2,
      clientOpId: "op-1",
      clientSequence: 1,
    });
    expect(response.results[0].deduped).toBeUndefined();
    // The echo carries the TRANSFORMED op: "D"@2 rebased past "C"@2
    // (equal-position tie-break, "C" < "D") to position 3.
    expect(response.results[1]).toMatchObject({
      serverSequence: 3,
      clientOpId: "op-2",
      clientSequence: 1,
      transformedOperation: { type: "insert", position: 3, content: "D" },
    });
    const note = await getStoredNote(t, meetingId);
    expect(note?.content).toBe("ABCD");

    // Single-op mutation echoes identity the same way.
    const single = await alice.mutation(
      api.notes.mutations.applyNoteOperation,
      {
        meetingId,
        operation: { type: "insert", position: 4, content: "E" },
        clientSequence: 3,
        clientId: "client-a",
        clientOpId: "solo-1",
      },
    );
    expect(single.success).toBe(true);
    expect(single.serverSequence).toBe(4);
    expect(single).toMatchObject({ clientOpId: "solo-1", clientSequence: 3 });
  });

  test("3. failedOps carries index + identity + reason while valid ops still apply", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    const response = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "KEEP " },
            clientSequence: 0,
            clientOpId: "op-ok",
          },
          {
            // Passes the wire validator, fails validateOperation (delete
            // needs length > 0).
            operation: { type: "delete", position: 0, length: 0 },
            clientSequence: 0,
            clientOpId: "op-bad",
          },
        ],
      },
    );

    expect(response.failed).toBe(1);
    expect(response.processed).toBe(1);
    expect(response.failedOps).toEqual([
      {
        index: 1,
        clientOpId: "op-bad",
        clientSequence: 0,
        reason: "Invalid operation format",
      },
    ]);

    // The valid op still applied and echoed its identity.
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      clientOpId: "op-ok",
      clientSequence: 0,
      serverSequence: 1,
    });
    const note = await getStoredNote(t, meetingId);
    expect(note?.content).toBe("KEEP ");
  });

  test("4a. dedupes a resent clientOpId across calls: text applied once, deduped echo with original serverSequence", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    const first = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "HELLO" },
            clientSequence: 0,
            clientOpId: "op-1",
          },
        ],
      },
    );
    expect(first.results[0].deduped).toBeUndefined();

    // Resend with the SAME clientOpId but a DIFFERENT payload: the stored row
    // is the truth of what that clientOpId did — the new payload must not apply.
    const second = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "GARBAGE" },
            clientSequence: 0,
            clientOpId: "op-1",
          },
        ],
      },
    );

    expect(second.results).toHaveLength(1);
    expect(second.results[0]).toMatchObject({
      deduped: true,
      clientOpId: "op-1",
      serverSequence: first.results[0].serverSequence,
    });

    // Applied exactly once: identical final text, exactly one stored row.
    const note = await getStoredNote(t, meetingId);
    expect(note?.content).toBe("HELLO");
    const rows = await getStoredIdentityRows(t, meetingId, "client-a", "op-1");
    expect(rows).toHaveLength(1);
  });

  test("4b. dedupes a clientOpId repeated within the same batch", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    const response = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "A" },
            clientSequence: 0,
            clientOpId: "dup",
          },
          {
            operation: { type: "insert", position: 1, content: "B" },
            clientSequence: 0,
            clientOpId: "dup",
          },
        ],
      },
    );

    expect(response.results[0]).toMatchObject({
      serverSequence: 1,
      clientOpId: "dup",
    });
    expect(response.results[0].deduped).toBeUndefined();
    expect(response.results[1]).toMatchObject({
      deduped: true,
      serverSequence: 1,
    });

    const note = await getStoredNote(t, meetingId);
    expect(note?.content).toBe("A");
  });

  test("4c. dedupes the single-op mutation by identity without bumping version", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    const first = await alice.mutation(api.notes.mutations.applyNoteOperation, {
      meetingId,
      operation: { type: "insert", position: 0, content: "X" },
      clientSequence: 0,
      clientId: "client-a",
      clientOpId: "solo-1",
    });
    expect(first.deduped).toBeUndefined();

    const second = await alice.mutation(
      api.notes.mutations.applyNoteOperation,
      {
        meetingId,
        operation: { type: "insert", position: 0, content: "Y" },
        clientSequence: 0,
        clientId: "client-a",
        clientOpId: "solo-1",
      },
    );

    expect(second).toMatchObject({
      success: true,
      deduped: true,
      serverSequence: first.serverSequence,
      // Nothing was reapplied: the version is the stored one, not bumped.
      newVersion: first.newVersion,
    });
    const note = await getStoredNote(t, meetingId);
    expect(note?.content).toBe("X");
  });

  test("4d. a wholly duplicate batch replay leaves the notes row untouched: no version bump, no updatedAt change, no reapply", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    // Identical payload for both sends — the second call is the retry.
    const batch = {
      meetingId,
      clientId: "client-a",
      operations: [
        {
          operation: { type: "insert" as const, position: 0, content: "AB" },
          clientSequence: 0,
          clientOpId: "op-1",
        },
        {
          operation: { type: "insert" as const, position: 2, content: "CD" },
          clientSequence: 1,
          clientOpId: "op-2",
        },
      ],
    };

    const first = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      batch,
    );
    expect(first.results.map((r) => r.deduped)).toEqual([undefined, undefined]);

    const stored = await getStoredNote(t, meetingId);
    expect(stored?.content).toBe("ABCD");
    expect(stored?.version).toBe(1);
    const versionAfterFirst = stored?.version;
    const updatedAtAfterFirst = stored?.updatedAt;

    // Guarantee any stray re-patch would observe a later clock than the first
    // apply, so the updatedAt equality below has teeth.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Retrying the IDENTICAL batch dedupes every op and must leave stored
    // state exactly as it was — the version is the watermark fresh reads
    // adopt, and a no-text-change replay must not advance it.
    const replay = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      batch,
    );

    expect(replay.results.map((r) => r.deduped)).toEqual([true, true]);
    expect(replay.results.map((r) => r.serverSequence)).toEqual(
      first.results.map((r) => r.serverSequence),
    );
    // The response reports the stored (unbumped) version, like the single-op
    // dedupe echo.
    expect(replay.newVersion).toBe(versionAfterFirst);

    const afterReplay = await getStoredNote(t, meetingId);
    expect(afterReplay?.version).toBe(versionAfterFirst);
    expect(afterReplay?.updatedAt).toBe(updatedAtAfterFirst);
    expect(afterReplay?.content).toBe("ABCD");

    // A MIX batch — one duplicate, one new op — still applies the new op and
    // bumps the version exactly once. The duplicate goes first: skipping it
    // must not disturb the content basis the new op applies against.
    const followUp = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "GARBAGE" },
            clientSequence: 0,
            clientOpId: "op-1",
          },
          {
            operation: { type: "insert", position: 4, content: "EF" },
            clientSequence: 2,
            clientOpId: "op-3",
          },
        ],
      },
    );

    expect(followUp.results.map((r) => r.deduped)).toEqual([true, undefined]);
    expect(followUp.newVersion).toBe((versionAfterFirst ?? 0) + 1);

    const afterFollowUp = await getStoredNote(t, meetingId);
    expect(afterFollowUp?.version).toBe((versionAfterFirst ?? 0) + 1);
    expect(afterFollowUp?.content).toBe("ABCDEF");
    const rows = await getStoredIdentityRows(t, meetingId, "client-a", "op-1");
    expect(rows).toHaveLength(1);
  });

  test("5. headSequence is the max noteOps sequence, 0 when none exist", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    // Notes row with zero ops.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("meetingNotes", {
        meetingId,
        content: "",
        version: 0,
        lastRebasedAt: now,
        updatedAt: now,
      });
    });

    const empty = await alice.query(api.notes.queries.getMeetingNotes, {
      meetingId,
      clientId: "client-a",
    });
    expect(empty?.headSequence).toBe(0);
    expect(empty?.clientAcks).toEqual([]);

    // Two sequential batches → sequences 1 and 2.
    await alice.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId: "client-a",
      operations: [
        {
          operation: { type: "insert", position: 0, content: "a" },
          clientSequence: 0,
          clientOpId: "w1",
        },
      ],
    });
    await alice.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId: "client-a",
      operations: [
        {
          operation: { type: "insert", position: 1, content: "b" },
          clientSequence: 1,
          clientOpId: "w2",
        },
      ],
    });

    const after = await alice.query(api.notes.queries.getMeetingNotes, {
      meetingId,
      clientId: "client-a",
    });
    expect(after?.headSequence).toBe(2);
  });

  test("6. clientAcks returns only this client's ops, ascending, excluding identity-less and other clients' ops", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, [
      "alice-wa",
      "bob-wa",
    ]);
    const alice = asAuthed(t, "alice-wa");
    const bob = asAuthed(t, "bob-wa");

    // alice: two identity ops in separate batches (sequences 1, 2)
    await alice.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId: "client-a",
      operations: [
        {
          operation: { type: "insert", position: 0, content: "A1" },
          clientSequence: 0,
          clientOpId: "a-1",
        },
      ],
    });
    await alice.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId: "client-a",
      operations: [
        {
          operation: { type: "insert", position: 2, content: "A2" },
          clientSequence: 1,
          clientOpId: "a-2",
        },
      ],
    });
    // alice: a legacy-style op with NO identity anywhere (sequence 3)
    await alice.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      operations: [
        {
          operation: { type: "insert", position: 4, content: "L" },
          clientSequence: 2,
        },
      ],
    });
    // bob: an identity op for a different client (sequence 4)
    await bob.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId: "client-b",
      operations: [
        {
          operation: { type: "insert", position: 5, content: "B1" },
          clientSequence: 3,
          clientOpId: "b-1",
        },
      ],
    });

    const forAlice = await alice.query(api.notes.queries.getMeetingNotes, {
      meetingId,
      clientId: "client-a",
    });
    expect(forAlice?.clientAcks).toEqual([
      {
        clientOpId: "a-1",
        clientSequence: 0,
        serverSequence: 1,
        appliedAt: expect.any(Number),
      },
      {
        clientOpId: "a-2",
        clientSequence: 1,
        serverSequence: 2,
        appliedAt: expect.any(Number),
      },
    ]);

    const forBob = await bob.query(api.notes.queries.getMeetingNotes, {
      meetingId,
      clientId: "client-b",
    });
    expect(forBob?.clientAcks).toEqual([
      {
        clientOpId: "b-1",
        clientSequence: 3,
        serverSequence: 4,
        appliedAt: expect.any(Number),
      },
    ]);
  });

  test("6b. clientAcks caps at the 100 most recent, ascending", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    const operations = Array.from({ length: 102 }, (_, i) => ({
      operation: { type: "insert" as const, position: 0, content: "x" },
      clientSequence: 0,
      clientOpId: `op-${i}`,
    }));
    const response = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      { meetingId, clientId: "client-a", operations },
    );
    expect(response.processed).toBe(102);

    const view = await alice.query(api.notes.queries.getMeetingNotes, {
      meetingId,
      clientId: "client-a",
    });
    const acks = view?.clientAcks ?? [];
    expect(acks).toHaveLength(100);
    // The most recent 100 of 102: serverSequences 3..102, oldest first.
    expect(acks[0]).toMatchObject({ clientOpId: "op-2", serverSequence: 3 });
    expect(acks[99]).toMatchObject({
      clientOpId: "op-101",
      serverSequence: 102,
    });
    const serverSequences = acks.map((ack) => ack.serverSequence);
    expect(serverSequences).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 3),
    );
  });

  test("7. legacy calls (no clientId) keep the legacy shapes and bump version once per batch", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);
    const alice = asAuthed(t, "alice-wa");

    // Seed "0123456789" (sequence 1, version 1).
    await alice.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      operations: [
        {
          operation: { type: "insert", position: 0, content: "0123456789" },
          clientSequence: 0,
        },
      ],
    });

    // Batch of 3 sibling ops from basis clientSequence 1, non-overlapping
    // positions so the transform outcome is deterministic.
    const response = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        operations: [
          {
            operation: { type: "insert", position: 0, content: "A" },
            clientSequence: 1,
          },
          {
            operation: { type: "insert", position: 5, content: "B" },
            clientSequence: 1,
          },
          {
            operation: { type: "insert", position: 10, content: "C" },
            clientSequence: 1,
          },
        ],
      },
    );

    // Version bumped ONCE for the whole batch (not once per op).
    expect(response.newVersion).toBe(2);
    expect(response).toMatchObject({ success: true, processed: 3, failed: 0 });
    expect(Object.keys(response).sort()).toEqual([
      "failed",
      "newVersion",
      "processed",
      "results",
      "success",
    ]);
    expect(response.results.map((r) => r.serverSequence)).toEqual([2, 3, 4]);
    expect(response.results.every((r) => r.clientOpId === undefined)).toBe(
      true,
    );
    expect(response.results.every((r) => r.deduped === undefined)).toBe(true);

    // Rows written by legacy calls carry no identity fields.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
        .collect(),
    );
    expect(rows).toHaveLength(4);
    expect(
      rows.every(
        (row) =>
          row.clientId === undefined &&
          row.clientOpId === undefined &&
          row.clientSequence === undefined,
      ),
    ).toBe(true);

    // Legacy content result still correct.
    const note = await getStoredNote(t, meetingId);
    expect(note?.content).toBe("A01234B56789C");

    // Query WITHOUT clientId: exactly the legacy row shape — no watermark keys.
    const view = await alice.query(api.notes.queries.getMeetingNotes, {
      meetingId,
    });
    expect(Object.keys(view ?? {}).sort()).toEqual([
      "_creationTime",
      "_id",
      "content",
      "lastRebasedAt",
      "meetingId",
      "updatedAt",
      "version",
    ]);
    expect(view).toMatchObject({ content: "A01234B56789C", version: 2 });

    // Single-op legacy response: the 5 legacy keys keep their values, plus the
    // one mandated per-op echo (clientSequence — a required arg, echoed like
    // batch results echo it); clientOpId/deduped stay absent without identity.
    const single = await alice.mutation(
      api.notes.mutations.applyNoteOperation,
      {
        meetingId,
        operation: { type: "insert", position: 13, content: "!" },
        clientSequence: 4,
      },
    );
    expect(single).toMatchObject({
      success: true,
      serverSequence: 5,
      newVersion: 3,
      conflicts: [],
      transformedOperation: { type: "insert", position: 13, content: "!" },
    });
    expect(Object.keys(single).sort()).toEqual([
      "clientSequence",
      "conflicts",
      "newVersion",
      "serverSequence",
      "success",
      "transformedOperation",
    ]);
  });

  test("8. auth unchanged: participant succeeds; non-participant gets the guard's exact error", async () => {
    const t = createTestEnvironment();
    const meetingId = await setupMeetingWithParticipants(t, ["alice-wa"]);

    // A provisioned user with NO meetingParticipants row for this meeting.
    await createTestUser(t, { workosUserId: "outsider-wa" });
    const outsider = asAuthed(t, "outsider-wa");

    const rejection: unknown = await outsider
      .mutation(api.notes.mutations.batchApplyNoteOperations, {
        meetingId,
        clientId: "client-x",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "nope" },
            clientSequence: 0,
            clientOpId: "op-x",
          },
        ],
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ConvexError);
    // On the convex-test runtime path the guard's error data arrives as the
    // JSON string of the ConvexError payload; parse it before matching.
    const rawData = (rejection as ConvexError<string>).data;
    const errorData =
      typeof rawData === "string"
        ? (JSON.parse(rawData) as Record<string, unknown>)
        : rawData;
    expect(errorData).toMatchObject({
      code: "FORBIDDEN",
      message: "Access denied: Not a meeting participant",
    });

    // Nothing was written by the rejected call.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
        .collect(),
    );
    expect(rows).toHaveLength(0);

    // A real participant still goes through unchanged.
    const alice = asAuthed(t, "alice-wa");
    const response = await alice.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        clientId: "client-a",
        operations: [
          {
            operation: { type: "insert", position: 0, content: "ok" },
            clientSequence: 0,
            clientOpId: "op-ok",
          },
        ],
      },
    );
    expect(response).toMatchObject({ success: true, processed: 1, failed: 0 });
  });
});
