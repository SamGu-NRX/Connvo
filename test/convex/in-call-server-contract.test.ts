/**
 * In-call server-contract reproduction — PASSING tests pinning the REAL
 * registered endpoints (convex-test harness, same as the notes suites).
 *
 * These are the server-behavior receipts for the red client witnesses in
 * test/in-call/: every server-behavior claim in
 * docs/in-call-client-20261010/witnesses.md traces here, not to the fake
 * transport.
 *
 * PROVENANCE RULE: hook behavior is evidenced by the client witnesses; server
 * behavior ONLY by these endpoint tests against the real registered functions.
 */

import { api } from "@convex/_generated/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestEnvironment,
  createTestUser,
  createTestMeeting,
  addMeetingParticipant,
} from "./helpers";

describe("in-call server contract (real endpoints)", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  /** Host-owned meeting with the host joined, plus their auth context. */
  async function setupMeeting() {
    const subject = "in-call-participant-subject";
    const user = await createTestUser(t, {
      workosUserId: subject,
      email: "in-call-participant@example.com",
      displayName: "In-call Participant",
    });
    const meeting = await createTestMeeting(t, user, {
      title: "In-call contract meeting",
    });
    const participantRowId = await addMeetingParticipant(
      t,
      meeting,
      user,
      "participant",
      "joined",
    );
    const auth = t.withIdentity({
      subject,
      email: "in-call-participant@example.com",
      name: "In-call Participant",
    });
    return { user, meeting, auth, participantRowId };
  }

  const realOp = { type: "insert" as const, position: 0, content: "hello" };

  it("hook-shaped batch payload is rejected by the real args validator", async () => {
    const { meeting, auth } = await setupMeeting();
    // Exactly what src/hooks/useCollaborativeNotes.ts sends today: bare ops
    // carrying `text`, no { operation, clientSequence } wrapper, plus a
    // top-level clientTimestamp the endpoint does not declare.
    await expect(
      auth.mutation(api.notes.mutations.batchApplyNoteOperations, {
        meetingId: meeting,
        operations: [
          { type: "insert", position: 0, text: "hello", length: 5 },
        ],
        clientTimestamp: Date.now(),
      } as never),
    ).rejects.toThrow(
      "Validator error: Missing required field `operation` in object",
    );
  });

  it("hook-shaped singular payload is rejected — `text` is not a valid note-op field", async () => {
    const { meeting, auth } = await setupMeeting();
    await expect(
      auth.mutation(api.notes.mutations.applyNoteOperation, {
        meetingId: meeting,
        operation: { type: "insert", position: 0, text: "x", length: 1 },
        clientSequence: 1,
        clientTimestamp: Date.now(),
      } as never),
    ).rejects.toThrow("Validator error: Unexpected field `text` in object");
  });

  it("a removed participant's write is rejected by assertMeetingAccess", async () => {
    const { meeting, auth, participantRowId } = await setupMeeting();
    // The lifecycle removal path deletes the participant row; the guard
    // (convex/auth/guards.ts:143) then finds no row for (meeting, user).
    await t.run(async (ctx) => {
      await ctx.db.delete(participantRowId);
    });

    await expect(
      auth.mutation(api.notes.mutations.batchApplyNoteOperations, {
        meetingId: meeting,
        operations: [{ operation: realOp, clientSequence: 1 }],
      }),
    ).rejects.toThrow("Access denied: Not a meeting participant");

    // Same guard on the realtime offline-queue writer
    // (convex/realtime/batchedOperations.ts:110).
    await expect(
      auth.mutation(api.realtime.batchedOperations.batchApplyNoteOperation, {
        meetingId: meeting,
        operation: realOp,
        clientSequence: 1,
        expectedVersion: 0,
      }),
    ).rejects.toThrow("Access denied: Not a meeting participant");
  });

  it("the realtime writer has no operationId dedupe — replaying the same op applies it twice", async () => {
    const { meeting, auth } = await setupMeeting();
    // batchApplyNoteOperation takes no operationId at all, and no endpoint
    // queries the schema's by_queue_and_operation index — pin that reality.
    const first = await auth.mutation(
      api.realtime.batchedOperations.batchApplyNoteOperation,
      {
        meetingId: meeting,
        operation: realOp,
        clientSequence: 1,
        expectedVersion: 0,
      },
    );
    expect(first.serverSequence).toBe(1);

    const second = await auth.mutation(
      api.realtime.batchedOperations.batchApplyNoteOperation,
      {
        meetingId: meeting,
        operation: realOp,
        clientSequence: 1,
        expectedVersion: 1,
      },
    );
    expect(second.serverSequence).toBe(2);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q: any) =>
          q.eq("meetingId", meeting),
        )
        .collect(),
    );
    expect(rows).toHaveLength(2);
    const notes = await t.run(async (ctx) =>
      ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q: any) => q.eq("meetingId", meeting))
        .unique(),
    );
    expect(notes?.content).toBe("hellohello");
  });

  it("the offline queue does not dedupe by operationId — duplicate ids both sync", async () => {
    const { user, meeting, auth } = await setupMeeting();
    const queueOp = (id: string, content: string) => ({
      type: "insert" as const,
      position: 0,
      content,
      id,
      authorId: String(user),
      timestamp: Date.now(),
      sequence: 1,
      clientId: "client-in-call",
      queuedAt: Date.now(),
      attempts: 0,
      status: "pending" as const,
    });
    const { queueId } = await auth.mutation(
      api.notes.offline.queueOfflineOperations,
      {
        meetingId: meeting,
        clientId: "client-in-call",
        operations: [queueOp("op-dup", "A"), queueOp("op-dup", "B")],
      },
    );
    const result = await auth.mutation(
      api.notes.offline.syncOfflineOperations,
      {
        meetingId: meeting,
        clientId: "client-in-call",
        queueId,
      },
    );
    expect(result.success).toBe(true);
    expect(result.synced).toBe(2);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q: any) =>
          q.eq("meetingId", meeting),
        )
        .collect(),
    );
    expect(rows).toHaveLength(2);
  });

  it("batch response shape and version-conflict behavior", async () => {
    const { meeting, auth } = await setupMeeting();
    const first = await auth.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId: meeting,
        operations: [{ operation: realOp, clientSequence: 1 }],
      },
    );
    // The response contract the client must adopt (convex/notes/mutations.ts:392).
    expect(first).toMatchObject({
      success: true,
      processed: 1,
      failed: 0,
      results: [{ serverSequence: 1, conflicts: [] }],
      newVersion: 1,
    });

    await expect(
      auth.mutation(api.notes.mutations.batchApplyNoteOperations, {
        meetingId: meeting,
        operations: [{ operation: realOp, clientSequence: 2 }],
        expectedVersion: 0,
      }),
    ).rejects.toThrow("Version mismatch: expected 0, got 1");
  });
});
