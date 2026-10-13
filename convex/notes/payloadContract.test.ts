/**
 * Notes payload contract tests: the client hook (src/hooks/useCollaborativeNotes.ts)
 * must send payloads the REGISTERED note mutations actually validate.
 *
 * Three layers, per the red-first repair protocol:
 *
 * 1. Source contract — reads the hook's source text and asserts the mutation
 *    boundary no longer sends the pre-fix shape (`clientTimestamp`) and now
 *    sends `clientSequence` / `expectedVersion`. RED on the pre-fix hook,
 *    GREEN after the fix; the hook file itself is the subject, so the test
 *    cannot drift from the code it pins.
 *
 * 2. Mapping contract — dynamically imports the hook module and executes its
 *    `toServerOperation` mapping (hook NoteOperation -> NoteV.operation).
 *    RED on the pre-fix hook (export does not exist), GREEN after.
 *
 * 3. Registered-function receipts — invokes api.notes.mutations.*
 *    through convex-test (no mocks). The defect pins prove the EXACT payload
 *    shape the pre-fix hook sent is rejected by the validator (these pass
 *    before and after — they pin the defect). The corrected-shape tests prove
 *    the repaired hook's payloads succeed and persist (noteOps row +
 *    materialized meetingNotes content advanced, documented return shapes).
 */

import { api } from "@convex/_generated/api";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  createTestEnvironment,
  createTestUser,
  createTestMeeting,
  addMeetingParticipant,
} from "../../test/convex/helpers";

const HOOK_PATH = path.resolve(
  process.cwd(),
  "src/hooks/useCollaborativeNotes.ts",
);

describe("Hook payload contract (source): src/hooks/useCollaborativeNotes.ts", () => {
  const source = readFileSync(HOOK_PATH, "utf8");

  it("no longer sends the unknown field clientTimestamp to any mutation", () => {
    expect(source).not.toContain("clientTimestamp");
  });

  it("sends clientSequence and expectedVersion at the mutation boundary", () => {
    expect(source).toMatch(/clientSequence/);
    expect(source).toMatch(/expectedVersion/);
  });
});

describe("Hook operation mapping (executed from the hook module)", () => {
  it("maps insert: text becomes content, no text field survives", async () => {
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );
    const mapped = toServerOperation({
      type: "insert",
      position: 3,
      text: "hi",
    });
    expect(mapped).toEqual({
      type: "insert",
      position: 3,
      content: "hi",
    });
    expect(mapped).not.toHaveProperty("text");
  });

  it("maps delete: length survives, no text field survives", async () => {
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );
    const mapped = toServerOperation({
      type: "delete",
      position: 2,
      length: 5,
    });
    expect(mapped).toEqual({ type: "delete", position: 2, length: 5 });
    expect(mapped).not.toHaveProperty("text");
  });

  it("maps retain: calculateOperation omits position, so position defaults to 0", async () => {
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );
    // calculateOperation returns { type: "retain", length } with no position.
    const mapped = toServerOperation({ type: "retain", length: 7 });
    expect(mapped).toEqual({ type: "retain", position: 0, length: 7 });
    expect(mapped).not.toHaveProperty("text");
  });
});

describe("Registered functions reject the pre-fix hook payload shape (defect pins)", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  async function setup() {
    const subject = "payload-contract-user-subject";
    const user = await createTestUser(t, { workosUserId: subject });
    const meetingId = await createTestMeeting(t, user, {
      title: "Payload contract meeting",
    });
    await addMeetingParticipant(t, meetingId, user, "host");
    const authT = t.withIdentity({
      subject,
      email: "payload-contract@example.com",
      name: "Payload Contract",
    });
    return { user, meetingId, authT };
  }

  /**
   * EXACT payload shape the pre-fix hook sent (src/hooks/useCollaborativeNotes.ts
   * before the repair): operation carries `text`, and the mutation receives
   * `clientTimestamp`. Both fields are unknown to the registered validators
   * (convex/types/validators/note.ts NoteV.operation and the mutation args).
   */
  function preFixSinglePayload(meetingId: any, text: string) {
    return {
      meetingId,
      operation: {
        type: "insert" as const,
        position: 0,
        text,
        length: undefined,
      },
      clientTimestamp: Date.now(),
    };
  }

  /** EXACT pre-fix batch shape: bare operations + clientTimestamp. */
  function preFixBatchPayload(meetingId: any, text: string) {
    return {
      meetingId,
      operations: [
        {
          type: "insert" as const,
          position: 0,
          text,
          length: undefined,
        },
      ],
      clientTimestamp: Date.now(),
    };
  }

  it("applyNoteOperation rejects the pre-fix single payload (extra fields text/clientTimestamp)", async () => {
    const { meetingId, authT } = await setup();
    await expect(
      authT.mutation(
        api.notes.mutations.applyNoteOperation,
        // @ts-expect-error — the pre-fix payload is deliberately malformed;
        // its rejection by the validator IS the assertion.
        preFixSinglePayload(meetingId, "hello"),
      ),
    ).rejects.toThrow(/validator error|unexpected field/i);
  });

  it("batchApplyNoteOperations rejects the pre-fix batch payload (text vs content, no clientSequence, clientTimestamp)", async () => {
    const { meetingId, authT } = await setup();
    await expect(
      authT.mutation(
        api.notes.mutations.batchApplyNoteOperations,
        // @ts-expect-error — the pre-fix payload is deliberately malformed;
        // its rejection by the validator IS the assertion.
        preFixBatchPayload(meetingId, "hello"),
      ),
    ).rejects.toThrow(/validator error|missing required field/i);
  });

  it("the pre-fix rejection is validator-level: nothing persists", async () => {
    const { meetingId, authT } = await setup();
    await expect(
      authT.mutation(
        api.notes.mutations.applyNoteOperation,
        // @ts-expect-error — the pre-fix payload is deliberately malformed;
        // its rejection by the validator IS the assertion.
        preFixSinglePayload(meetingId, "hello"),
      ),
    ).rejects.toThrow();

    const notes = await t.run(async (ctx) =>
      ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique(),
    );
    expect(notes).toBeNull();
    const ops = await t.run(async (ctx) =>
      ctx.db.query("noteOps").withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId),
      ).collect(),
    );
    expect(ops).toHaveLength(0);
  });
});

describe("Corrected payload shape through the registered functions (E2E)", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  async function setup() {
    const subject = "payload-e2e-user-subject";
    const user = await createTestUser(t, { workosUserId: subject });
    const meetingId = await createTestMeeting(t, user, {
      title: "Payload E2E meeting",
    });
    await addMeetingParticipant(t, meetingId, user, "host");
    const authT = t.withIdentity({
      subject,
      email: "payload-e2e@example.com",
      name: "Payload E2E",
    });
    return { user, meetingId, authT };
  }

  async function readState(meetingId: any) {
    return await t.run(async (ctx) => ({
      notes: await ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique(),
      ops: await ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) =>
          q.eq("meetingId", meetingId),
        )
        .order("asc")
        .collect(),
    }));
  }

  it("single insert succeeds and persists: return shape, noteOps row, materialized content", async () => {
    const { user, meetingId, authT } = await setup();
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );

    // Hook state: no notes doc observed yet -> version 0, clientSequence 0.
    const result = await authT.mutation(api.notes.mutations.applyNoteOperation, {
      meetingId,
      operation: toServerOperation({
        type: "insert",
        position: 0,
        text: "hello",
      }),
      clientSequence: 0,
      expectedVersion: 0,
    });

    expect(result).toEqual({
      success: true,
      serverSequence: 1,
      transformedOperation: {
        type: "insert",
        position: 0,
        content: "hello",
        length: undefined,
      },
      newVersion: 1,
      conflicts: [],
    });

    const { notes, ops } = await readState(meetingId);
    expect(notes?.content).toBe("hello");
    expect(notes?.version).toBe(1);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      sequence: 1,
      authorId: user,
      applied: true,
      operation: { type: "insert", position: 0, content: "hello" },
    });
  });

  it("sequential ops with the hook's monotonic clientSequence and expectedVersion advance the document", async () => {
    const { meetingId, authT } = await setup();
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );

    // Op 1: clientSequence 0, expectedVersion 0 (empty server state).
    const first = await authT.mutation(
      api.notes.mutations.applyNoteOperation,
      {
        meetingId,
        operation: toServerOperation({
          type: "insert",
          position: 0,
          text: "hello",
        }),
        clientSequence: 0,
        expectedVersion: 0,
      },
    );
    expect(first.serverSequence).toBe(1);
    expect(first.newVersion).toBe(1);

    // Op 2: the hook advanced its ref to the observed serverSequence (1) and
    // reads expectedVersion from the observed notes version (1).
    const second = await authT.mutation(
      api.notes.mutations.applyNoteOperation,
      {
        meetingId,
        operation: toServerOperation({
          type: "insert",
          position: 5,
          text: " world",
        }),
        clientSequence: first.serverSequence,
        expectedVersion: first.newVersion,
      },
    );
    expect(second.success).toBe(true);
    expect(second.serverSequence).toBe(2);
    expect(second.newVersion).toBe(2);

    const { notes } = await readState(meetingId);
    expect(notes?.content).toBe("hello world");
    expect(notes?.version).toBe(2);
  });

  it("retain (emitted by calculateOperation for same-length text) validates and persists", async () => {
    const { meetingId, authT } = await setup();
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );

    // Seed content via a normal insert first.
    await authT.mutation(api.notes.mutations.applyNoteOperation, {
      meetingId,
      operation: toServerOperation({
        type: "insert",
        position: 0,
        text: "hello",
      }),
      clientSequence: 0,
      expectedVersion: 0,
    });

    const result = await authT.mutation(
      api.notes.mutations.applyNoteOperation,
      {
        meetingId,
        // calculateOperation("hello", "hello") -> { type: "retain", length: 5 }
        operation: toServerOperation({ type: "retain", length: 5 }),
        clientSequence: 1,
        expectedVersion: 1,
      },
    );
    expect(result.success).toBe(true);

    const { notes } = await readState(meetingId);
    expect(notes?.content).toBe("hello");
  });

  it("batch insert succeeds: {success, processed, failed, results, newVersion}, noteOps rows, content advanced", async () => {
    const { user, meetingId, authT } = await setup();
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );

    // Hook batch state: base clientSequence 0, expectedVersion 0. Within the
    // batch each op's clientSequence advances by one (base + index): the
    // client's local state after op i incorporates i sibling ops, so sibling
    // ops must be excluded from each other's transform sets.
    const result = await authT.mutation(
      api.notes.mutations.batchApplyNoteOperations,
      {
        meetingId,
        operations: [
          {
            operation: toServerOperation({
              type: "insert",
              position: 0,
              text: "AB",
            }),
            clientSequence: 0,
          },
          {
            operation: toServerOperation({
              type: "insert",
              position: 2,
              text: "CD",
            }),
            clientSequence: 1,
          },
        ],
        expectedVersion: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.newVersion).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.serverSequence)).toEqual([1, 2]);
    for (const r of result.results) {
      expect(r.transformedOperation).not.toHaveProperty("text");
      expect(Array.isArray(r.conflicts)).toBe(true);
    }

    const { notes, ops } = await readState(meetingId);
    expect(notes?.content).toBe("ABCD");
    expect(notes?.version).toBe(1);
    expect(ops).toHaveLength(2);
    expect(ops.map((op) => op.sequence)).toEqual([1, 2]);
    expect(ops.every((op) => op.applied && op.authorId === user)).toBe(true);
  });

  it("stale expectedVersion is rejected as a conflict and nothing persists", async () => {
    const { meetingId, authT } = await setup();
    const { toServerOperation } = await import(
      "../../src/hooks/useCollaborativeNotes"
    );

    await authT.mutation(api.notes.mutations.applyNoteOperation, {
      meetingId,
      operation: toServerOperation({
        type: "insert",
        position: 0,
        text: "hello",
      }),
      clientSequence: 0,
      expectedVersion: 0,
    });

    // The hook would have refetched; simulate a stale view (expectedVersion 0).
    await expect(
      authT.mutation(api.notes.mutations.applyNoteOperation, {
        meetingId,
        operation: toServerOperation({
          type: "insert",
          position: 5,
          text: "!",
        }),
        clientSequence: 1,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/mismatch|conflict/i);

    const { notes, ops } = await readState(meetingId);
    expect(notes?.content).toBe("hello");
    expect(notes?.version).toBe(1);
    expect(ops).toHaveLength(1);
  });
});
