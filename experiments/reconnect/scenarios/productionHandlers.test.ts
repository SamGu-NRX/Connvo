/**
 * [production-handler] layer of the reconnect study.
 *
 * Unlike the notes/lifecycle suites (which drive the REAL HOOKS over the
 * owned fake transport), this suite exercises the REGISTERED PRODUCTION
 * Convex handlers directly — through convex-test against the real schema,
 * the real validators, and the real auth guards — and records what each
 * handler ACTUALLY DID when the same delivery arrives twice (duplicate
 * delivery, i.e. at-least-once re-send after a lost ack or a replay).
 *
 * Nothing here is scripted: the accept/reject verdict per delivery is the
 * observed outcome of calling the registered function (args validator +
 * handler) and diffing server state before/after. The experiment-owned
 * fake transport (fake/fakeConvex.ts) hardcodes none of it anymore.
 *
 * Handlers under test:
 *  - convex/notes/mutations.ts      applyNoteOperation, batchApplyNoteOperations
 *  - convex/notes/offline.ts        queueOfflineOperations, syncOfflineOperations,
 *                                   retryFailedOperations
 *  - convex/meetings/lifecycle.ts   createMeeting, startMeeting, endMeeting
 *                                   (note: withIdempotency is IMPORTED there but
 *                                   never invoked — see the lifecycle receipts)
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "@convex/schema";
import { api } from "@convex/_generated/api";

/**
 * Explicit module map for convex-test (keys are file-relative paths; the key
 * containing "_generated" anchors the functions root, so its prefix must
 * match the other keys' prefix). We do not use import.meta.glob here: in this
 * setup Vite silently returns an empty object for glob patterns that climb
 * above experiments/reconnect/, and an explicit map also keeps the layer's
 * dependency surface (exactly the handlers under test) auditable.
 */
const modules = {
  "../../convex/_generated/api.js": () => import("@convex/_generated/api"),
  "../../convex/_generated/server.js": () => import("@convex/_generated/server"),
  "../../convex/notes/mutations.ts": () => import("@convex/notes/mutations"),
  "../../convex/notes/offline.ts": () => import("@convex/notes/offline"),
  "../../convex/meetings/lifecycle.ts": () => import("@convex/meetings/lifecycle"),
  "../../convex/lib/idempotency.ts": () => import("@convex/lib/idempotency"),
};

const HOST_SUBJECT = "workos-host-user";

function writeResults(name: string, data: unknown): void {
  const dir = path.join(process.cwd(), "experiments", "reconnect", "results", "vitest");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name.endsWith(".json") ? name : name + ".json");
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Error normalizer: ConvexError carries .data {code,message}; nested ConvexErrors
 * round-trip .data double-JSON-encoded — parse until an object emerges. */
function errorOf(err: unknown): { code: string; message: string } {
  let data: unknown = (err as { data?: unknown })?.data;
  for (let hop = 0; typeof data === "string" && hop < 3; hop++) {
    try {
      data = JSON.parse(data);
    } catch {
      break; // not JSON — leave as-is
    }
  }
  if (data && typeof data === "object" && (data as { message?: string }).message) {
    const d = data as { code?: string; message?: string };
    return { code: String(d.code ?? "UNKNOWN"), message: String(d.message) };
  }
  return { code: "ERROR", message: String((err as Error)?.message ?? err) };
}

/** Outcome classification, computed from what the call did — never scripted. */
type Outcome = "accepted" | "rejected" | "deduped";

function classify(
  thrown: unknown,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Outcome {
  if (thrown !== undefined) return "rejected";
  return JSON.stringify(before) === JSON.stringify(after) ? "deduped" : "accepted";
}

/** Deterministic server-state summary (no timestamps, no generated ids). */
function stableState(s: {
  notes: { content: string; version: number } | null;
  noteOpsSequences: number[];
  noteOpsCount: number;
  queueRows: Array<{ operationId: string; status: string; attempts: number; clientSequence: number }>;
  meetingState: string | null;
  meetingsCount: number;
  meetingStateRowActive: boolean | null;
  idempotencyKeysCount: number;
}): Record<string, unknown> {
  return {
    notes: s.notes,
    noteOpsCount: s.noteOpsCount,
    noteOpsSequences: s.noteOpsSequences,
    queueRows: [...s.queueRows].sort((a, b) =>
      a.operationId === b.operationId
        ? a.clientSequence - b.clientSequence
        : a.operationId.localeCompare(b.operationId),
    ),
    meetingState: s.meetingState,
    meetingsCount: s.meetingsCount,
    meetingStateRowActive: s.meetingStateRowActive,
    idempotencyKeysCount: s.idempotencyKeysCount,
  };
}

describe("production handlers under duplicate delivery (registered handlers, convex-test backend)", () => {
  it("notes: applyNoteOperation delivered twice — observed verdict", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });

    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "dup apply",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "joined",
        createdAt: 0,
      });
      return { meetingId: mid };
    });

    // The exact same delivery, twice (what at-least-once re-send looks like).
    const args = {
      meetingId,
      operation: { type: "insert" as const, position: 0, content: "hello world" },
      clientSequence: 1,
      expectedVersion: 0,
    };

    const deliveries: Array<Record<string, unknown>> = [];
    const readState = () =>
      host.run(async (ctx) => {
        const notes = await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
        const ops = await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
          .collect();
        const queue = await ctx.db
          .query("offlineOperationQueue")
          .withIndex("by_meeting_and_client", (q) => q.eq("meetingId", meetingId).eq("clientId", "c1"))
          .collect();
        const meeting = await ctx.db.get(meetingId);
        const stateRow = await ctx.db
          .query("meetingState")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
        const keys = await ctx.db.query("idempotencyKeys").collect();
        return stableState({
          notes: notes ? { content: notes.content, version: notes.version } : null,
          noteOpsSequences: ops.map((o) => o.sequence).sort((a, b) => a - b),
          noteOpsCount: ops.length,
          queueRows: queue.map((r) => ({
            operationId: r.operationId,
            status: r.status,
            attempts: r.attempts,
            clientSequence: r.clientSequence,
          })),
          meetingState: meeting?.state ?? null,
          meetingsCount: (await ctx.db.query("meetings").collect()).length,
          meetingStateRowActive: stateRow ? stateRow.active : null,
          idempotencyKeysCount: keys.length,
        });
      });

    const deliver = async (attempt: number, withArgs: typeof args) => {
      const before = await readState();
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.notes.mutations.applyNoteOperation, withArgs);
      } catch (err) {
        thrown = err;
      }
      const after = await readState();
      deliveries.push({
        attempt,
        sentArgs: { clientSequence: withArgs.clientSequence, expectedVersion: withArgs.expectedVersion, operation: withArgs.operation },
        outcome: classify(thrown, before, after),
        result: thrown ? undefined : result,
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    };

    // Delivery 1: the original op (version 0 -> 1).
    await deliver(1, args);
    // Delivery 2: the exact same message re-sent (at-least-once re-delivery,
    // still pinning the ORIGINAL expectedVersion).
    await deliver(2, args);
    // Delivery 3: a duplicate re-based on the version the first delivery
    // produced (what a client that re-reads state before retrying would send).
    const rebasedVersion = (deliveries[0].stateAfter as { notes: { version: number } }).notes.version;
    await deliver(3, { ...args, expectedVersion: rebasedVersion });

    const dupError = deliveries[1].error as { message: string };
    const finalState = deliveries[2].stateAfter as { notes: { content: string; version: number }; noteOpsCount: number; idempotencyKeysCount: number };

    expect(deliveries[0].outcome).toBe("accepted");
    expect(deliveries[1].outcome).toBe("rejected"); // expectedVersion guard, observed
    expect(dupError.message).toMatch(/mismatch|conflict|version/i);
    expect(deliveries[2].outcome).toBe("accepted"); // re-based duplicate re-applies
    expect(finalState.notes.content).toBe("hello worldhello world");
    expect(finalState.notes.version).toBe(2);
    expect(finalState.noteOpsCount).toBe(2); // two op records, same clientSequence
    expect(finalState.idempotencyKeysCount).toBe(0); // withIdempotency never engaged
    writeResults("production-notes-apply-duplicate.json", {
      scenario: "production/notes-apply-duplicate",
      layer: "production-handler",
      handler: "notes/mutations.ts: applyNoteOperation",
      deliveries,
      observedDuplicateVerdict:
        "verbatim duplicate (stale expectedVersion) REJECTED by the expectedVersion guard; a re-based duplicate (same clientSequence) is ACCEPTED and applied a second time — clientSequence dedupes nothing, content doubled",
    });
  });

  it("notes: the hook's actual send shape (clientTimestamp, no clientSequence) is REJECTED by the registered validator", async () => {
    // src/hooks/useCollaborativeNotes.ts sends { operation, clientTimestamp }.
    // The registered validator requires clientSequence. This confirms the
    // REPORT's source-level suspicion against the real handler, observed.
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "hook shape",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "joined",
        createdAt: 0,
      });
      return { meetingId: mid };
    });

    let thrown: unknown;
    try {
      await host.mutation(api.notes.mutations.applyNoteOperation, {
        meetingId,
        operation: { type: "insert" as const, position: 0, content: "hello world" },
        clientTimestamp: Date.now(),
      } as unknown as Record<string, unknown>);
    } catch (err) {
      thrown = err;
    }
    const err = errorOf(thrown);
    expect(thrown).toBeDefined();
    expect(JSON.stringify(err)).toMatch(/clientSequence/i);

    writeResults("production-notes-hook-args.json", {
      scenario: "production/notes-hook-args",
      layer: "production-handler",
      handler: "notes/mutations.ts: applyNoteOperation",
      deliveries: [
        {
          attempt: 1,
          sentArgs: { operation: "insert@0 'hello world'", clientTimestamp: "<hook sends this>", clientSequence: "(absent)" },
          outcome: "rejected",
          error: err,
        },
      ],
      observedDuplicateVerdict: "n/a — single delivery; confirms hook↔validator arg mismatch",
    });
  });

  it("notes: batchApplyNoteOperations delivered twice — observed verdict", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "dup batch",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "joined",
        createdAt: 0,
      });
      return { meetingId: mid };
    });

    const args = {
      meetingId,
      operations: [
        { operation: { type: "insert" as const, position: 0, content: "AA" }, clientSequence: 1 },
        { operation: { type: "insert" as const, position: 2, content: "BB" }, clientSequence: 2 },
      ],
      expectedVersion: 0,
    };

    const readState = () =>
      host.run(async (ctx) => {
        const notes = await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
        const ops = await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
          .collect();
        const keys = await ctx.db.query("idempotencyKeys").collect();
        return stableState({
          notes: notes ? { content: notes.content, version: notes.version } : null,
          noteOpsSequences: ops.map((o) => o.sequence).sort((a, b) => a - b),
          noteOpsCount: ops.length,
          queueRows: [],
          meetingState: "active",
          meetingsCount: 1,
          meetingStateRowActive: null,
          idempotencyKeysCount: keys.length,
        });
      });

    const deliveries: Array<Record<string, unknown>> = [];
    const deliver = async (attempt: number, withArgs: typeof args) => {
      const before = await readState();
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.notes.mutations.batchApplyNoteOperations, withArgs);
      } catch (err) {
        thrown = err;
      }
      const after = await readState();
      deliveries.push({
        attempt,
        sentArgs: { clientSequences: withArgs.operations.map((o) => o.clientSequence), expectedVersion: withArgs.expectedVersion },
        outcome: classify(thrown, before, after),
        result: thrown ? undefined : result,
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    };

    // Delivery 1: the original batch.
    await deliver(1, args);
    // Delivery 2: the exact same message re-sent (at-least-once re-delivery
    // with the ORIGINAL expectedVersion still pinned).
    await deliver(2, args);
    // Delivery 3: a duplicate that re-bases on the version the first batch
    // produced (what a client that re-reads state before retrying would send).
    const rebasedVersion = (deliveries[0].stateAfter as { notes: { version: number } }).notes.version;
    await deliver(3, { ...args, expectedVersion: rebasedVersion });

    const first = deliveries[0].result as { processed: number };
    const secondErr = deliveries[1].error as { message: string };
    const third = deliveries[2].result as { processed: number };
    const finalState = deliveries[2].stateAfter as { notes: { content: string; version: number }; noteOpsCount: number };

    expect(deliveries[0].outcome).toBe("accepted");
    expect(first.processed).toBe(2);
    expect(deliveries[1].outcome).toBe("rejected"); // expectedVersion guard, observed
    expect(secondErr.message).toMatch(/mismatch|conflict|version/i);
    expect(deliveries[2].outcome).toBe("accepted");
    expect(third.processed).toBe(2); // the re-based duplicate re-applied every op
    // OBSERVED (not predicted): on the second application the server transforms
    // the batch's later ops against earlier ones (insert BB@2 shifts to BB@4),
    // so the doubled document is "AAAABBBB", not a naive "AABBAABB".
    expect(finalState.notes.content).toBe("AAAABBBB");
    expect(finalState.noteOpsCount).toBe(4);
    // OBSERVED: the version bumps once per BATCH (two batches applied -> 2),
    // even though four individual operations were recorded.
    expect(finalState.notes.version).toBe(2);
    writeResults("production-notes-batch-duplicate.json", {
      scenario: "production/notes-batch-duplicate",
      layer: "production-handler",
      handler: "notes/mutations.ts: batchApplyNoteOperations",
      deliveries,
      observedDuplicateVerdict:
        "stale duplicate REJECTED by the expectedVersion guard (seen as CONFLICT after the first batch bumped the version); a re-based duplicate (same clientSequences) is ACCEPTED and re-applies every op with positions transformed server-side — sequence numbers dedupe nothing",
    });
  });

  it("offline: queueOfflineOperations delivered twice — observed verdict", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "dup queue",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "joined",
        createdAt: 0,
      });
      return { meetingId: mid };
    });

    const queuedOp = {
      type: "insert" as const,
      position: 0,
      content: "offline edit",
      id: "op_client_1",
      authorId: HOST_SUBJECT,
      timestamp: 0,
      sequence: 1,
      clientId: "c1",
      queuedAt: 0,
      attempts: 0,
      status: "pending" as const,
    };
    const args = { meetingId, operations: [queuedOp], clientId: "c1" };

    const readState = () =>
      host.run(async (ctx) => {
        const queue = await ctx.db
          .query("offlineOperationQueue")
          .withIndex("by_meeting_and_client", (q) => q.eq("meetingId", meetingId).eq("clientId", "c1"))
          .collect();
        const notes = await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
        const keys = await ctx.db.query("idempotencyKeys").collect();
        return stableState({
          notes: notes ? { content: notes.content, version: notes.version } : null,
          noteOpsSequences: [],
          noteOpsCount: 0,
          queueRows: queue.map((r) => ({
            operationId: r.operationId,
            status: r.status,
            attempts: r.attempts,
            clientSequence: r.clientSequence,
          })),
          meetingState: "active",
          meetingsCount: 1,
          meetingStateRowActive: null,
          idempotencyKeysCount: keys.length,
        });
      });

    const deliveries: Array<Record<string, unknown>> = [];
    let queueIds: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = await readState();
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.notes.offline.queueOfflineOperations, args);
      } catch (err) {
        thrown = err;
      }
      const after = await readState();
      if (result) queueIds.push((result as { queueId: string }).queueId);
      deliveries.push({
        attempt,
        outcome: classify(thrown, before, after),
        result: thrown ? undefined : { success: (result as { success: boolean }).success, queued: (result as { queued: number }).queued },
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    }

    const finalState = deliveries[1].stateAfter as { queueRows: Array<Record<string, unknown>> };
    expect(deliveries[0].outcome).toBe("accepted");
    expect(deliveries[1].outcome).toBe("accepted");
    expect(finalState.queueRows.length).toBe(2); // queue duplicated, same operationId twice
    expect(new Set(queueIds).size).toBe(2); // server-minted queueId differs every time
    writeResults("production-offline-queue-duplicate.json", {
      scenario: "production/offline-queue-duplicate",
      layer: "production-handler",
      handler: "notes/offline.ts: queueOfflineOperations",
      deliveries,
      observedDuplicateVerdict:
        "duplicate ACCEPTED again — two queue rows for the same operationId (no dedupe; queueIds differ per call)",
    });
  });

  it("offline: syncOfflineOperations delivered twice — applies once, then the status transition dedupes", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "dup sync",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "joined",
        createdAt: 0,
      });
      // Seed a single queued op (queue delivered ONCE).
      await ctx.db.insert("offlineOperationQueue", {
        meetingId: mid,
        clientId: "c1",
        queueId: "queue_seed",
        operation: { type: "insert", position: 0, content: "offline edit" },
        operationId: "op_client_1",
        authorId: userId,
        clientSequence: 1,
        timestamp: 0,
        queuedAt: 0,
        attempts: 0,
        status: "pending",
      });
      return { meetingId: mid };
    });

    const readState = () =>
      host.run(async (ctx) => {
        const notes = await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
        const ops = await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
          .collect();
        const queue = await ctx.db
          .query("offlineOperationQueue")
          .withIndex("by_meeting_and_client", (q) => q.eq("meetingId", meetingId).eq("clientId", "c1"))
          .collect();
        const keys = await ctx.db.query("idempotencyKeys").collect();
        return stableState({
          notes: notes ? { content: notes.content, version: notes.version } : null,
          noteOpsSequences: ops.map((o) => o.sequence).sort((a, b) => a - b),
          noteOpsCount: ops.length,
          queueRows: queue.map((r) => ({
            operationId: r.operationId,
            status: r.status,
            attempts: r.attempts,
            clientSequence: r.clientSequence,
          })),
          meetingState: "active",
          meetingsCount: 1,
          meetingStateRowActive: null,
          idempotencyKeysCount: keys.length,
        });
      });

    const args = { meetingId, clientId: "c1" };
    const deliveries: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = await readState();
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.notes.offline.syncOfflineOperations, args);
      } catch (err) {
        thrown = err;
      }
      const after = await readState();
      deliveries.push({
        attempt,
        outcome: classify(thrown, before, after),
        result: thrown ? undefined : result,
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    }

    const first = deliveries[0].result as { synced: number; newVersion: number };
    const second = deliveries[1].result as { synced: number };
    const finalState = deliveries[1].stateAfter as { notes: { content: string }; noteOpsCount: number };

    expect(deliveries[0].outcome).toBe("accepted");
    expect(deliveries[1].outcome).toBe("deduped"); // no state change: pending -> synced guard
    expect(first.synced).toBe(1);
    expect(second.synced).toBe(0);
    expect(finalState.notes.content).toBe("offline edit"); // NOT doubled
    writeResults("production-offline-sync-duplicate.json", {
      scenario: "production/offline-sync-duplicate",
      layer: "production-handler",
      handler: "notes/offline.ts: syncOfflineOperations",
      deliveries,
      observedDuplicateVerdict:
        "duplicate DEDUPED by the pending->synced status transition (second sync is a no-op); content applied once",
    });
  });

  it("offline: retryFailedOperations delivered repeatedly — observed verdict", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "dup retry",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "joined",
        createdAt: 0,
      });
      // A queued op that can never apply: delete beyond document length.
      await ctx.db.insert("offlineOperationQueue", {
        meetingId: mid,
        clientId: "c1",
        queueId: "queue_seed",
        operation: { type: "delete", position: 999, length: 5 },
        operationId: "op_client_bad",
        authorId: userId,
        clientSequence: 1,
        timestamp: 0,
        queuedAt: 0,
        attempts: 0,
        status: "pending",
      });
      // A second row already in the exhausted state (attempts >= maxRetries),
      // on its own client, so the maxRetries exclusion can be observed without
      // the handler's nested-sync leg.
      await ctx.db.insert("offlineOperationQueue", {
        meetingId: mid,
        clientId: "c2",
        queueId: "queue_seed_c2",
        operation: { type: "delete", position: 999, length: 5 },
        operationId: "op_client_exhausted",
        authorId: userId,
        clientSequence: 2,
        timestamp: 0,
        queuedAt: 0,
        attempts: 3,
        status: "failed",
      });
      return { meetingId: mid };
    });

    // Setup (production path): a sync attempts the bad op, fails it, and parks
    // the row in status "failed" with attempts=1. retryFailedOperations only
    // picks up rows already marked failed.
    const syncReceipt: Record<string, unknown> = await (async () => {
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.notes.offline.syncOfflineOperations, { meetingId, clientId: "c1" });
      } catch (err) {
        thrown = err;
      }
      return { outcome: thrown ? "rejected" : "accepted", result: thrown ? undefined : result, error: thrown ? errorOf(thrown) : undefined };
    })();

    const readQueueState = () =>
      host.run(async (ctx) => {
        const c1 = await ctx.db
          .query("offlineOperationQueue")
          .withIndex("by_meeting_and_client", (q) => q.eq("meetingId", meetingId).eq("clientId", "c1"))
          .collect();
        const c2 = await ctx.db
          .query("offlineOperationQueue")
          .withIndex("by_meeting_and_client", (q) => q.eq("meetingId", meetingId).eq("clientId", "c2"))
          .collect();
        const keys = await ctx.db.query("idempotencyKeys").collect();
        const rows = [...c1, ...c2];
        return stableState({
          notes: null,
          noteOpsSequences: [],
          noteOpsCount: 0,
          queueRows: rows.map((r) => ({
            operationId: r.operationId,
            status: r.status,
            attempts: r.attempts,
            clientSequence: r.clientSequence,
          })),
          meetingState: "active",
          meetingsCount: 1,
          meetingStateRowActive: null,
          idempotencyKeysCount: keys.length,
        });
      });

    const deliveries: Array<Record<string, unknown>> = [];
    const deliverRetry = async (attempt: number, clientId: string) => {
      const before = await readQueueState();
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.notes.offline.retryFailedOperations, { meetingId, clientId });
      } catch (err) {
        thrown = err;
      }
      const after = await readQueueState();
      deliveries.push({
        attempt,
        clientId,
        outcome: thrown ? "rejected" : classify(thrown, before, after),
        result: thrown ? undefined : result,
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    };

    // Deliveries 1-2: duplicate retries for client c1, whose bad row is failed
    // with attempts=1 (a row the handler would reset and re-sync).
    await deliverRetry(1, "c1");
    await deliverRetry(2, "c1");
    // Deliveries 3-4: duplicate retries for client c2 (exhausted row only:
    // attempts=3 >= maxRetries=3, so the handler's filter excludes it and no
    // nested sync runs).
    await deliverRetry(3, "c2");
    await deliverRetry(4, "c2");

    const c1Err = deliveries[0].error as { code: string; message: string };
    const c1ErrDup = deliveries[1].error as { code: string; message: string };
    const c2r1 = deliveries[2].result as { retriedCount: number; successCount: number };
    const c2r2 = deliveries[3].result as { retriedCount: number; successCount: number };
    const finalState = deliveries[3].stateAfter as { queueRows: Array<{ operationId: string; status: string; attempts: number }> };

    expect(syncReceipt.outcome).toBe("accepted");
    const syncResult = syncReceipt.result as { success: boolean; failed: number; errors: string[] };
    expect(syncResult.success).toBe(false);
    expect(syncResult.failed).toBe(1);
    expect(syncResult.errors[0]).toMatch(/Invalid delete position/i);

    // OBSERVED: both duplicate retries reject identically. The handler resets
    // the failed row to pending, then runs its sync through a NESTED
    // ctx.runMutation — and convex-test 0.0.38 does not propagate the caller's
    // identity into nested contexts (get-convex/convex-test#50, open), so the
    // nested sync's auth guard throws UNAUTHORIZED and the whole retry
    // transaction rolls back. Recorded as observed; in production Convex a
    // nested runMutation carries the caller's identity, so this leg is a
    // harness artifact for the nested sync only.
    expect(deliveries[0].outcome).toBe("rejected");
    expect(c1Err.code).toBe("UNAUTHORIZED");
    expect(c1Err.message).toMatch(/Authentication required/i);
    expect(deliveries[1].outcome).toBe("rejected");
    expect(c1ErrDup).toEqual(c1Err); // deterministic duplicate verdict
    // Rollback preserved the failed row untouched.
    const badRow = finalState.queueRows.find((r) => r.operationId === "op_client_bad");
    expect(badRow?.status).toBe("failed");
    expect(badRow?.attempts).toBe(1);

    // OBSERVED: the maxRetries exclusion — an exhausted row (attempts >= 3) is
    // silently dropped (retriedCount 0); the duplicate retry is a zero-delta
    // no-op.
    expect(deliveries[2].outcome).toBe("deduped");
    expect(c2r1.retriedCount).toBe(0);
    expect(c2r1.successCount).toBe(0);
    expect(deliveries[3].outcome).toBe("deduped");
    expect(c2r2.retriedCount).toBe(0);
    const exhaustedRow = finalState.queueRows.find((r) => r.operationId === "op_client_exhausted");
    expect(exhaustedRow?.status).toBe("failed");
    expect(exhaustedRow?.attempts).toBe(3);

    writeResults("production-offline-retry-duplicate.json", {
      scenario: "production/offline-retry-duplicate",
      layer: "production-handler",
      handler: "notes/offline.ts: retryFailedOperations",
      harnessNote:
        "convex-test 0.0.38 does not propagate caller identity into nested ctx.runMutation (get-convex/convex-test#50, open), so a retry whose row-set is non-empty rejects UNAUTHORIZED before the nested sync can run; the post-reset sync behavior is not observable through this harness. Recorded as observed.",
      setupSync: syncReceipt,
      deliveries,
      observedDuplicateVerdict:
        "duplicate retries reject deterministically (UNAUTHORIZED 'Authentication required' — nested sync loses caller identity under convex-test, a harness artifact; transaction rolls back, row untouched); retries on an exhausted row (attempts >= maxRetries) are zero-delta no-ops (retriedCount 0) — silently, with no surfaced error",
    });
  });

  it("lifecycle: startMeeting delivered twice — accepted once, duplicate REJECTED by the state guard (no idempotency)", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "dup start",
        state: "scheduled",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "invited",
        createdAt: 0,
      });
      await ctx.db.insert("meetingState", {
        meetingId: mid,
        active: false,
        topics: [],
        recordingEnabled: false,
        updatedAt: 0,
      });
      return { meetingId: mid };
    });

    const readState = () =>
      host.run(async (ctx) => {
        const meeting = await ctx.db.get(meetingId);
        const stateRow = await ctx.db
          .query("meetingState")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
        const keys = await ctx.db.query("idempotencyKeys").collect();
        return stableState({
          notes: null,
          noteOpsSequences: [],
          noteOpsCount: 0,
          queueRows: [],
          meetingState: meeting?.state ?? null,
          meetingsCount: 1,
          meetingStateRowActive: stateRow ? stateRow.active : null,
          idempotencyKeysCount: keys.length,
        });
      });

    const deliveries: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = await readState();
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.meetings.lifecycle.startMeeting, { meetingId });
      } catch (err) {
        thrown = err;
      }
      const after = await readState();
      deliveries.push({
        attempt,
        outcome: classify(thrown, before, after),
        result: thrown ? undefined : { success: (result as { success: boolean }).success },
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    }

    const finalState = deliveries[1].stateAfter as { meetingState: string; idempotencyKeysCount: number };
    expect(deliveries[0].outcome).toBe("accepted");
    expect(deliveries[1].outcome).toBe("rejected");
    expect((deliveries[1].error as { message: string }).message).toMatch(/already active/i);
    expect(finalState.meetingState).toBe("active");
    expect(finalState.idempotencyKeysCount).toBe(0); // withIdempotency imported but NOT wired in lifecycle.ts
    writeResults("production-lifecycle-start-duplicate.json", {
      scenario: "production/lifecycle-start-duplicate",
      layer: "production-handler",
      handler: "meetings/lifecycle.ts: startMeeting",
      deliveries,
      observedDuplicateVerdict:
        "duplicate REJECTED by the state guard ('Meeting is already active') — protection is incidental state-machine ordering, not idempotency (idempotencyKeys rows: 0)",
    });
  });

  it("lifecycle: endMeeting delivered twice — accepted once, duplicate REJECTED by the state guard", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    const { meetingId } = await host.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const mid = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: "dup end",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId,
        role: "host",
        presence: "joined",
        createdAt: 0,
      });
      await ctx.db.insert("meetingState", {
        meetingId: mid,
        active: true,
        startedAt: 0,
        topics: [],
        recordingEnabled: false,
        updatedAt: 0,
      });
      return { meetingId: mid };
    });

    const readState = () =>
      host.run(async (ctx) => {
        const meeting = await ctx.db.get(meetingId);
        const keys = await ctx.db.query("idempotencyKeys").collect();
        return stableState({
          notes: null,
          noteOpsSequences: [],
          noteOpsCount: 0,
          queueRows: [],
          meetingState: meeting?.state ?? null,
          meetingsCount: 1,
          meetingStateRowActive: null,
          idempotencyKeysCount: keys.length,
        });
      });

    const deliveries: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = await readState();
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.meetings.lifecycle.endMeeting, { meetingId });
      } catch (err) {
        thrown = err;
      }
      const after = await readState();
      deliveries.push({
        attempt,
        outcome: classify(thrown, before, after),
        result: thrown ? undefined : { success: (result as { success: boolean }).success },
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    }

    expect(deliveries[0].outcome).toBe("accepted");
    expect(deliveries[1].outcome).toBe("rejected");
    expect((deliveries[1].error as { message: string }).message).toMatch(/can only end active meetings/i);
    writeResults("production-lifecycle-end-duplicate.json", {
      scenario: "production/lifecycle-end-duplicate",
      layer: "production-handler",
      handler: "meetings/lifecycle.ts: endMeeting",
      deliveries,
      observedDuplicateVerdict:
        "duplicate REJECTED by the state guard ('Can only end active meetings') — again ordering, not idempotency",
    });
  });

  it("lifecycle: createMeeting delivered twice — both ACCEPTED, two meetings created (no dedupe)", async () => {
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: HOST_SUBJECT, email: "host@example.test", name: "Host" });
    // createMeeting expects the caller to be provisioned at sign-in time
    // (requireAuth reads users by workos user id).
    await host.run(async (ctx) => {
      await ctx.db.insert("users", {
        workosUserId: HOST_SUBJECT,
        email: "host@example.test",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
    });

    const deliveries: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      let thrown: unknown;
      let result: unknown;
      try {
        result = await host.mutation(api.meetings.lifecycle.createMeeting, { title: "dup create" });
      } catch (err) {
        thrown = err;
      }
      const after = await host.run(async (ctx) => {
        const meetings = await ctx.db.query("meetings").collect();
        const keys = await ctx.db.query("idempotencyKeys").collect();
        return {
          meetingsCount: meetings.length,
          meetingStates: meetings.map((m) => m.state).sort(),
          idempotencyKeysCount: keys.length,
        };
      });
      deliveries.push({
        attempt,
        outcome: thrown ? "rejected" : "accepted",
        result: thrown
          ? undefined
          : { meetingId: "<generated>", webrtcReady: (result as { webrtcReady: boolean }).webrtcReady, videoProvider: (result as { videoProvider: string }).videoProvider },
        error: thrown ? errorOf(thrown) : undefined,
        stateAfter: after,
      });
    }

    const finalState = deliveries[1].stateAfter as { meetingsCount: number; meetingStates: string[] };
    expect(deliveries[0].outcome).toBe("accepted");
    expect(deliveries[1].outcome).toBe("accepted");
    expect(finalState.meetingsCount).toBe(2);
    writeResults("production-lifecycle-create-duplicate.json", {
      scenario: "production/lifecycle-create-duplicate",
      layer: "production-handler",
      handler: "meetings/lifecycle.ts: createMeeting",
      deliveries,
      observedDuplicateVerdict:
        "duplicate ACCEPTED again — two separate meeting documents created (retry after a lost create ack duplicates the meeting)",
    });
  });
});
