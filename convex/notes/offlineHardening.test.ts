/**
 * Notes hardening tests: offline queue scoping, batched-writer acks,
 * and checkpoint-guarded log pruning.
 *
 * These tests assert the FIXED behavior. On the pre-fix baseline they fail,
 * reproducing the defects:
 *  - offline sync resolved queue rows by bare queueId, so a caller could
 *    inject/replay another meeting's (or another user's) queued operations;
 *  - the batched realtime writer acked operations its stub flusher never
 *    persisted (ack-without-persist);
 *  - note-log pruning deleted history with no durable checkpoint, making
 *    full replay diverge from the materialized document.
 *
 * The "control" tests pass before AND after the fixes and pin the
 * legitimate flows that must keep working.
 */

import { api, internal } from "@convex/_generated/api";
import { describe, expect, it, beforeEach } from "vitest";
import {
  createTestEnvironment,
  createTestUser,
  createTestMeeting,
  addMeetingParticipant,
} from "../../test/convex/helpers";

describe("Offline notes sync scoping", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  /** Author A owns meetingA (host). Attacker B owns meetingB (host). */
  async function setupTwoMeetings() {
    const subjectA = "author-a-subject";
    const subjectB = "attacker-b-subject";
    const userA = await createTestUser(t, { workosUserId: subjectA });
    const userB = await createTestUser(t, { workosUserId: subjectB });
    const meetingA = await createTestMeeting(t, userA, { title: "Meeting A" });
    await addMeetingParticipant(t, meetingA, userA, "host");
    const meetingB = await createTestMeeting(t, userB, { title: "Meeting B" });
    await addMeetingParticipant(t, meetingB, userB, "host");

    const authA = t.withIdentity({
      subject: subjectA,
      email: "author-a@example.com",
      name: "Author A",
    });
    const authB = t.withIdentity({
      subject: subjectB,
      email: "attacker-b@example.com",
      name: "Attacker B",
    });
    return { userA, userB, meetingA, meetingB, authA, authB };
  }

  async function queueOneOp(
    authA: ReturnType<typeof t.withIdentity>,
    meetingId: any,
    userA: any,
  ) {
    return await authA.mutation(api.notes.offline.queueOfflineOperations, {
      meetingId,
      clientId: "client-a",
      operations: [
        {
          type: "insert" as const,
          position: 0,
          content: "hello from meeting A",
          id: "op-1",
          authorId: String(userA),
          timestamp: Date.now(),
          sequence: 1,
          clientId: "client-a",
          queuedAt: Date.now(),
          attempts: 0,
          status: "pending" as const,
        },
      ],
    });
  }

  it("control: the author can queue and sync their own queue on their own meeting", async () => {
    const { userA, meetingA, authA } = await setupTwoMeetings();
    const { queueId } = await queueOneOp(authA, meetingA, userA);

    const result = await authA.mutation(api.notes.offline.syncOfflineOperations, {
      meetingId: meetingA,
      clientId: "client-a",
      queueId,
    });

    expect(result.success).toBe(true);
    expect(result.synced).toBe(1);

    const notes = await t.run(async (ctx) =>
      ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingA))
        .unique(),
    );
    expect(notes?.content).toBe("hello from meeting A");
  });

  it("rejects a cross-meeting queue replay: another user's queueId applied to their own meeting", async () => {
    const { userA, meetingA, meetingB, authA, authB } =
      await setupTwoMeetings();
    const { queueId } = await queueOneOp(authA, meetingA, userA);

    // B replays A's queueId against B's own meeting.
    await expect(
      authB.mutation(api.notes.offline.syncOfflineOperations, {
        meetingId: meetingB,
        clientId: "client-b",
        queueId,
      }),
    ).rejects.toThrow(/forbidden|denied|does not belong|access/i);

    // Meeting B must be untouched (no notes doc created by the injection)...
    const bNotes = await t.run(async (ctx) =>
      ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingB))
        .unique(),
    );
    expect(bNotes).toBeNull();

    // ...and A's queued operations must remain untouched in the queue.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("offlineOperationQueue")
        .withIndex("by_queue_id", (q) => q.eq("queueId", queueId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("rejects a queue replay across the author's own meetings: a queueId is meeting-scoped", async () => {
    const { userA, meetingA, authA } = await setupTwoMeetings();
    const { queueId } = await queueOneOp(authA, meetingA, userA);

    // Give A a second meeting they legitimately host.
    const meetingC = await createTestMeeting(t, userA, { title: "Meeting C" });
    await addMeetingParticipant(t, meetingC, userA, "host");

    await expect(
      authA.mutation(api.notes.offline.syncOfflineOperations, {
        meetingId: meetingC,
        clientId: "client-a",
        queueId,
      }),
    ).rejects.toThrow(/forbidden|denied|does not belong|access/i);
  });

  it("does not let a co-participant sync another user's queue rows by supplying their clientId", async () => {
    const { userA, userB, meetingA, authA, authB } = await setupTwoMeetings();
    await queueOneOp(authA, meetingA, userA);

    // B joins meeting A and tries to sync A's rows by guessing A's clientId.
    await addMeetingParticipant(t, meetingA, userB, "participant");
    const result = await authB.mutation(
      api.notes.offline.syncOfflineOperations,
      {
        meetingId: meetingA,
        clientId: "client-a",
      },
    );

    // Identity binding: the rows belong to A, so B sees none of them.
    expect(result.synced).toBe(0);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("offlineOperationQueue").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });
});

describe("Batched realtime writer (persist before ack)", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  async function setupWriter() {
    const subject = "writer-user-subject";
    const user = await createTestUser(t, { workosUserId: subject });
    const meetingId = await createTestMeeting(t, user, {
      title: "Writer meeting",
    });
    await addMeetingParticipant(t, meetingId, user, "host");
    const authT = t.withIdentity({
      subject,
      email: "writer@example.com",
      name: "Writer",
    });
    return { user, meetingId, authT };
  }

  it("control: a batched ack corresponds to a durable operation and advanced document", async () => {
    const { user, meetingId, authT } = await setupWriter();

    const first = await authT.mutation(
      api.realtime.batchedOperations.batchApplyNoteOperation,
      {
        meetingId,
        operation: { type: "insert", position: 0, content: "hello" },
        clientSequence: 0,
        expectedVersion: 0,
      },
    );
    expect(first.queued).toBe(true);
    expect(first.serverSequence).toBe(1);

    const [opRow, notes] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) =>
            q.eq("meetingId", meetingId),
          )
          .first(),
        ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique(),
      ]),
    );

    // The ack is only allowed because the op is durable: the returned
    // serverSequence must exist as an applied noteOp row.
    expect(opRow).toBeDefined();
    expect(opRow?.sequence).toBe(first.serverSequence);
    expect(opRow?.applied).toBe(true);
    expect(opRow?.authorId).toBe(user);
    expect(notes?.content).toBe("hello");
    expect(notes?.version).toBe(1);

    // A second op on the advanced version also persists durably.
    const second = await authT.mutation(
      api.realtime.batchedOperations.batchApplyNoteOperation,
      {
        meetingId,
        operation: { type: "insert", position: 5, content: " world" },
        clientSequence: 1,
        expectedVersion: 1,
      },
    );
    expect(second.serverSequence).toBe(2);
    const notes2 = await t.run(async (ctx) =>
      ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique(),
    );
    expect(notes2?.content).toBe("hello world");
    expect(notes2?.version).toBe(2);
  });

  it("never acks a stale-version operation: it rejects without persisting", async () => {
    const { meetingId, authT } = await setupWriter();

    await expect(
      authT.mutation(
        api.realtime.batchedOperations.batchApplyNoteOperation,
        {
          meetingId,
          operation: { type: "insert", position: 0, content: "x" },
          clientSequence: 0,
          expectedVersion: 99,
        },
      ),
    ).rejects.toThrow(/mismatch|conflict/i);

    const opCount = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) =>
            q.eq("meetingId", meetingId),
          )
          .collect()).length,
    );
    expect(opCount).toBe(0);
  });
});

describe("Checkpoint-guarded note-log pruning", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  async function setupOldOps() {
    const subject = "prune-user-subject";
    const user = await createTestUser(t, { workosUserId: subject });
    const meetingId = await createTestMeeting(t, user, {
      title: "Prune meeting",
    });
    await addMeetingParticipant(t, meetingId, user, "host");

    const oldTimestamp = Date.now() - 90 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      for (let sequence = 1; sequence <= 3; sequence++) {
        await ctx.db.insert("noteOps", {
          meetingId,
          sequence,
          authorId: user,
          operation: {
            type: "insert",
            position: 0,
            content: `op-${sequence}`,
          },
          timestamp: oldTimestamp,
          applied: true,
        });
      }
    });
    return { user, meetingId, oldTimestamp };
  }

  const pruneArgs = (meetingId: any) => ({
    meetingId,
    olderThanMs: 1000, // ops are 90 days old, so all are past the cutoff
    keepMinimumOps: 0,
  });

  it("does not prune any operations when no durable checkpoint exists", async () => {
    const { meetingId } = await setupOldOps();

    const result = await t.mutation(
      internal.notes.mutations.cleanupOldNoteOperations,
      pruneArgs(meetingId),
    );

    expect(result.deleted).toBe(0);
    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
        .collect(),
    );
    expect(remaining.map((op) => op.sequence).sort()).toEqual([1, 2, 3]);
  });

  it("control: with a durable checkpoint, pruning removes only ops at or below its sequence", async () => {
    const { meetingId, oldTimestamp } = await setupOldOps();

    // A durable checkpoint covers state up to sequence 2.
    await t.run(async (ctx) => {
      await ctx.db.insert("offlineCheckpoints", {
        checkpointId: "ckpt-1",
        meetingId,
        clientId: "client-a",
        sequence: 2,
        version: 2,
        contentHash: "hash-at-seq-2",
        timestamp: oldTimestamp,
        createdAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.notes.mutations.cleanupOldNoteOperations,
      pruneArgs(meetingId),
    );

    expect(result.deleted).toBe(2);
    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
        .collect(),
    );
    // Ops above the checkpoint sequence are never removed: they are still
    // needed for a consistent replay on top of the checkpointed state.
    expect(remaining.map((op) => op.sequence).sort()).toEqual([3]);
  });
});
