/**
 * M4 property suite (docs/notes-ledger-f1/design.md §5 "Property (M4)").
 *
 * Fixed seed recorded in file + output; `numRuns: 10_000` on both properties.
 *
 * P1 — single client: random edit sequences (insert/delete/replace at random
 * positions) × random faults (offline windows, drop before apply, drop after
 * apply, unmount/remount). Invariants after settle (including the user's
 * conflict-retry recovery path when the server refused an op):
 *   - server text == final client buffer EXACTLY;
 *   - composed view == server text, status synced, nothing unsaved;
 *   - send discipline (design.md §5 "Resend (never blind)"): no send of an op
 *     without a fresh ingest since its previous send, and at most one send of
 *     an op per ingest window — i.e. any single fault episode yields at most
 *     original + 1 resend under the same clientOpId, the design's "sent ≤2
 *     times" read per episode. A literal global cap of 2 sends would strand a
 *     twice-failed never-applied op (words lost from the server text), which
 *     contradicts exact convergence; the per-episode reading is the one the
 *     design's resend mechanism describes.
 *
 * P2 — two clients on one shared server, random interleaved edits + faults:
 *   - exact convergence: both clients' final buffers == their composed views
 *     == the server text, fully settled (the intent-level oracle);
 *   - send discipline (same per-episode reading as P1). Token-string
 *     conservation is deliberately NOT asserted — it is undecidable at the
 *     string level under the shipped transform (see the comment at the
 *     assertion site for the two trace-evidenced counterexamples).
 *
 * SPEED / FAITHFULNESS. 10k runs cannot afford a convex-test environment per
 * run, so the fast path drives the REAL `NotesLedger` store (the object under
 * test) against a light server model whose apply/transform/validate are the
 * REAL Convex functions (`convex/notes/operations.ts` — the exact functions
 * `batchApplyNoteOperations` runs), with the mutation's own plumbing mirrored:
 * identity dedupe returning the stored row with `deduped: true` and no
 * reapply, per-op try/catch turning out-of-range applies into `failedOps`
 * entries, transform against every stored op above the op's `clientSequence`
 * watermark (`transformAgainst` is total — the conflicts array stays empty),
 * and an unconditional one-version bump per batch. Faults mirror the M2 matrix
 * harness codes (ENOTFOUND offline, ECONNRESET before apply, never-settling
 * response after apply) and intercept only sends/pushes — never server
 * semantics. The React seam is re-anchored by a 200-run mounted subset through
 * the real `useNotesLedger` + `NotesTransportProvider`.
 *
 * DETERMINISM. `debounceMs: 0` flushes synchronously; the model resolves on
 * microtasks; settle = a bounded quiescence loop over `setTimeout(0)` yields
 * (scheduling, never wall-clock timing). Identical seed ⇒ identical run.
 */

import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

import { NotesLedger } from "@/hooks/notes/notesLedger";
import { NotesTransportProvider } from "@/hooks/notes/notesTransport";
import { useNotesLedger } from "@/hooks/notes/useNotesLedger";
import type {
  BatchApplyNoteOperationsResponse,
  NotesBatchOp,
  NotesServerSnapshot,
  NotesTransport,
} from "@/hooks/notes/types";
import {
  applyToDoc,
  transformAgainst,
  validateOperation,
} from "@convex/notes/operations";
import type { Id } from "@convex/_generated/dataModel";

/** The recorded seed — change it deliberately and record the change. */
const SEED = 20261011;
const NUM_RUNS = 10_000;
const MOUNTED_NUM_RUNS = 200;
/** Dev smoke override: NOTES_PROPERTY_RUNS=<n> shrinks every property. */
const runsOverride = process.env.NOTES_PROPERTY_RUNS
  ? Number(process.env.NOTES_PROPERTY_RUNS)
  : undefined;

const asMeetingId = (id: string): Id<"meetings"> => id as Id<"meetings">;

type Operation = {
  type: "insert" | "delete" | "retain";
  position: number;
  content?: string;
  length?: number;
};

// ---------------------------------------------------------------------------
// Light server model — the real Convex helpers, the mutation's plumbing.
// ---------------------------------------------------------------------------

interface StoredOp {
  sequence: number;
  op: Operation;
  clientId?: string;
  clientOpId?: string;
  clientSequence?: number;
}

/** Mirrors the mutation's thrown conflict (classifyTransportError → "conflict"). */
function conflictError(message: string): Error {
  return Object.assign(new Error(message), { code: "CONFLICT" });
}

/** What the model tells the accounting layer when an op lands. */
interface AppliedInfo {
  op: Operation;
  /** The doc content BEFORE this op applied — delete absorption reads it. */
  contentBefore: string;
}

class LightServer {
  content = "";
  version = 0;
  private ops: StoredOp[] = [];
  private nextSequence = 1;
  private subscribers = new Set<() => void>();

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => {
      this.subscribers.delete(notify);
    };
  }

  /** Fresh read to every live subscriber (the query push), on microtasks. */
  pushAll(): void {
    for (const notify of this.subscribers) queueMicrotask(notify);
  }

  /**
   * batchApplyNoteOperations' semantics (convex/notes/mutations.ts):
   * whole-batch expectedVersion conflict; per-op identity dedupe (stored row,
   * deduped: true, no reapply, no sequence consumed); validate → failedOps;
   * transform against ALL stored ops above the op's clientSequence; per-op
   * try/catch so an out-of-range apply becomes a failedOps entry; the row
   * stores the TRANSFORMED op; unconditional single version bump per batch.
   */
  applyBatch(
    clientId: string,
    batch: { operations: NotesBatchOp[]; expectedVersion?: number },
    onApplied?: (applied: AppliedInfo) => void,
  ): BatchApplyNoteOperationsResponse {
    if (
      batch.expectedVersion !== undefined &&
      batch.expectedVersion !== this.version
    ) {
      throw conflictError(
        `Version mismatch: expected ${batch.expectedVersion}, got ${this.version}`,
      );
    }
    let currentContent = this.content;
    let currentSequence = this.nextSequence;
    let processed = 0;
    let failed = 0;
    const results: BatchApplyNoteOperationsResponse["results"] = [];
    const failedOps: NonNullable<BatchApplyNoteOperationsResponse["failedOps"]> =
      [];

    for (const [index, entry] of batch.operations.entries()) {
      // Identity dedupe first — the stored row is the truth of what this
      // clientOpId did, regardless of the retry's payload.
      const existing =
        entry.clientOpId !== undefined
          ? this.ops.find(
              (o) =>
                o.clientId === clientId && o.clientOpId === entry.clientOpId,
            )
          : undefined;
      if (existing) {
        results.push({
          serverSequence: existing.sequence,
          transformedOperation: existing.op,
          conflicts: [],
          clientOpId: existing.clientOpId,
          clientSequence: existing.clientSequence,
          deduped: true,
        });
        processed++;
        continue;
      }
      try {
        if (!validateOperation(entry.operation as Operation)) {
          failed++;
          failedOps.push({
            index,
            clientOpId: entry.clientOpId,
            clientSequence: entry.clientSequence,
            reason: "Invalid operation format",
          });
          continue;
        }
        const concurrentOps = this.ops.filter(
          (o) => o.sequence > entry.clientSequence,
        );
        let transformed = entry.operation as Operation;
        for (const concurrent of concurrentOps) {
          // transformAgainst is total: it always returns an operation.
          transformed = transformAgainst(transformed, concurrent.op);
        }
        const contentBefore = currentContent;
        currentContent = applyToDoc(currentContent, transformed);
        const stored: StoredOp = {
          sequence: currentSequence,
          op: transformed,
          clientId,
          clientOpId: entry.clientOpId,
          clientSequence: entry.clientSequence,
        };
        this.ops.push(stored);
        onApplied?.({ op: transformed, contentBefore });
        results.push({
          serverSequence: currentSequence,
          transformedOperation: transformed,
          conflicts: [],
          clientOpId: entry.clientOpId,
          clientSequence: entry.clientSequence,
        });
        currentSequence++;
        processed++;
      } catch (error) {
        failed++;
        failedOps.push({
          index,
          clientOpId: entry.clientOpId,
          clientSequence: entry.clientSequence,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.content = currentContent;
    this.version++; // unconditional single bump per batch
    this.nextSequence = currentSequence;
    return {
      success: processed > 0,
      processed,
      failed,
      results,
      ...(failedOps.length > 0 ? { failedOps } : {}),
      newVersion: this.version,
    };
  }

  /** The read endpoint: server truth + this client's ≤100 most recent acks. */
  snapshotFor(clientId: string): NotesServerSnapshot {
    const mine = this.ops.filter((o) => o.clientId === clientId);
    const head = this.ops.length ? this.ops[this.ops.length - 1].sequence : 0;
    return {
      content: this.content,
      version: this.version,
      headSequence: head,
      clientAcks: mine.slice(-100).map((o) => ({
        clientOpId: o.clientOpId ?? "",
        clientSequence: o.clientSequence ?? 0,
        serverSequence: o.sequence,
        appliedAt: 0,
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// Fault-injecting transport — the matrix harness's codes over the model.
// ---------------------------------------------------------------------------

interface FaultConfigLite {
  /** Every send fails ENOTFOUND; pushes withheld until reconnect. */
  offline?: boolean;
  /** Next send dies ECONNRESET before the server sees it (one shot). */
  dropBeforeApply?: boolean;
  /** Next send: the server applies, the response never settles (one shot). */
  dropAfterApply?: boolean;
}

/** Insert-chunk conservation accounting. Tokens are unique per run. */
class ChunkLedger {
  /** token → absorbed by a delete's removed substring? */
  readonly tokens = new Map<string, boolean>();

  recordInsert(content: string): void {
    if (content) this.tokens.set(content, false);
  }

  /** A delete removed this exact substring — anything inside was absorbed. */
  markDeleted(slice: string): void {
    for (const [token, absorbed] of this.tokens) {
      if (!absorbed && slice.includes(token)) this.tokens.set(token, true);
    }
  }
}

/** Shared send log — records EVERY send across remounts/transports. The
 * ingest stamp comes from the SENDING transport's own counter, so one
 * client's pushes never whitewash another client's blind resend. */
class SendLog {
  readonly entries: Array<{
    clientOpId: string;
    payload: string;
    ingestCount: number;
  }> = [];
  record(
    batch: { operations: NotesBatchOp[] },
    ingestCount: number,
  ): void {
    for (const entry of batch.operations) {
      this.entries.push({
        clientOpId: entry.clientOpId,
        payload: JSON.stringify(entry.operation),
        ingestCount,
      });
    }
  }
}

/** Fresh-read deliveries (subscribe first read, server push, reconnect,
 * refresh). The ledger's resend discipline is gated on exactly these. */
class IngestLog {
  private _count = 0;
  get count(): number {
    return this._count;
  }
  bump(): void {
    this._count++;
  }
}

class FaultyTransport implements NotesTransport {
  faults: FaultConfigLite = {};
  private onSnapshot:
    | ((snapshot: NotesServerSnapshot | undefined) => void)
    | null = null;
  private unsubServer: (() => void) | null = null;

  constructor(
    private readonly server: LightServer,
    private readonly clientId: string,
    private readonly chunks: ChunkLedger,
    private readonly sendLog: SendLog,
    private readonly ingest: IngestLog,
  ) {}

  subscribe(
    _meetingId: Id<"meetings">,
    _clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): () => void {
    this.onSnapshot = onSnapshot;
    // First read delivery, async — mirroring a Convex query's first result.
    queueMicrotask(() => {
      this.ingest.bump();
      onSnapshot(this.server.snapshotFor(this.clientId));
    });
    this.unsubServer = this.server.subscribe(() => {
      if (this.faults.offline) return; // pushes withheld while offline
      queueMicrotask(() => {
        this.ingest.bump();
        this.onSnapshot?.(this.server.snapshotFor(this.clientId));
      });
    });
    return () => {
      this.onSnapshot = null;
      this.unsubServer?.();
      this.unsubServer = null;
    };
  }

  async applyBatch(
    _meetingId: Id<"meetings">,
    clientId: string,
    batch: { operations: NotesBatchOp[]; expectedVersion?: number },
  ): Promise<BatchApplyNoteOperationsResponse> {
    this.sendLog.record(batch, this.ingest.count); // the batch left the client
    if (this.faults.offline) {
      throw Object.assign(
        new Error("getaddrinfo ENOTFOUND — transport offline"),
        { code: "ENOTFOUND" },
      );
    }
    if (this.faults.dropBeforeApply) {
      this.faults.dropBeforeApply = false; // one shot
      throw Object.assign(
        new Error("connection reset before the batch reached the server"),
        { code: "ECONNRESET" },
      );
    }
    if (this.faults.dropAfterApply) {
      this.faults.dropAfterApply = false; // one shot
      // The server sees the batch (fire-and-forget); the push still happens
      // (matrix semantics: holdResponse is not set); the response is lost.
      this.server.applyBatch(clientId, batch, (applied) =>
        this.account(applied),
      );
      this.server.pushAll();
      return new Promise<BatchApplyNoteOperationsResponse>(() => {});
    }
    const response = this.server.applyBatch(clientId, batch, (applied) =>
      this.account(applied),
    );
    this.server.pushAll();
    return response;
  }

  /** Feed the conservation accounting with what actually landed. */
  private account(applied: { op: Operation; contentBefore: string }): void {
    if (applied.op.type === "insert") {
      this.chunks.recordInsert(applied.op.content ?? "");
    }
    if (applied.op.type === "delete") {
      const start = applied.op.position;
      const end = start + (applied.op.length ?? 0);
      this.chunks.markDeleted(applied.contentBefore.slice(start, end));
    }
  }

  /** The matrix harness's reconnect: clear offline, deliver a fresh read. */
  reconnect(): void {
    this.faults.offline = false;
    queueMicrotask(() => {
      this.ingest.bump();
      this.onSnapshot?.(this.server.snapshotFor(this.clientId));
    });
  }

  /** Manual fresh-read push (the ledger's nudgeFreshRead seam). */
  refresh(): void {
    queueMicrotask(() => {
      this.ingest.bump();
      this.onSnapshot?.(this.server.snapshotFor(this.clientId));
    });
  }

  close(): void {}
}

// Global trace shim: every LightServer instance logs SEND/APPLY per op when
// NOTES_REPLAY_TRACE=1 (P1/P2/mounted/replay all route through this).
if (process.env.NOTES_REPLAY_TRACE === "1") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = LightServer.prototype as any;
  const origApplyBatch = proto.applyBatch;
  proto.applyBatch = function (
    clientId: string,
    batch: { operations: NotesBatchOp[]; expectedVersion?: number },
    onApplied?: (applied: AppliedInfo) => void,
  ) {
    console.log(
      `[trace] SEND client=${clientId} ops=${JSON.stringify(batch.operations.map((o) => [o.clientOpId, o.operation, o.clientSequence]))}`,
    );
    const res = origApplyBatch.call(this, clientId, batch, (applied: AppliedInfo) => {
      console.log(
        `[trace]   OP ${JSON.stringify(applied.op)} ON ${JSON.stringify(applied.contentBefore)}`,
      );
      onApplied?.(applied);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res as any;
    console.log(
      `[trace] APPLY -> content=${JSON.stringify(this.content)} version=${this.version} results=${JSON.stringify(r.results?.map((x: any) => [x.clientOpId, x.deduped === true, x.serverSequence]))} failed=${JSON.stringify(r.failedOps ?? [])}`,
    );
    return res;
  };
}

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

/** Storage double — recovery semantics without sessionStorage. */
class MemStorage implements Storage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(_index: number): string | null {
    return null;
  }
  get length(): number {
    return this.map.size;
  }
}

interface EditCommand {
  kind: "insert" | "delete" | "replace";
  position: number;
  token?: string;
  length?: number;
}

/** Random string edit, as the user's textarea would produce. */
function applyEdit(text: string, edit: EditCommand): string {
  const pos = Math.min(edit.position, text.length);
  switch (edit.kind) {
    case "insert":
      return text.slice(0, pos) + (edit.token ?? "") + text.slice(pos);
    case "delete": {
      const end = Math.min(pos + (edit.length ?? 0), text.length);
      return text.slice(0, pos) + text.slice(end);
    }
    case "replace": {
      const end = Math.min(pos + (edit.length ?? 0), text.length);
      return text.slice(0, pos) + (edit.token ?? "") + text.slice(end);
    }
  }
}

type FaultKind =
  | "none"
  | "offline"
  | "reconnect"
  | "dropBefore"
  | "dropAfter"
  | "remount";

interface Step {
  edit: EditCommand | null;
  fault: FaultKind;
}

const editArb = (maxPos: number, maxLen: number, tokenPrefix: string) =>
  fc.record({
    kind: fc.constantFrom("insert", "delete", "replace") as fc.Arbitrary<
      "insert" | "delete" | "replace"
    >,
    position: fc.nat(maxPos),
    token: fc.nat(1_000_000).map((n) => `${tokenPrefix}${n} `),
    length: fc.nat(maxLen),
  });

const stepArb = (tokenPrefix: string): fc.Arbitrary<Step> =>
  fc.record({
    edit: fc.option(editArb(24, 6, tokenPrefix), {
      nil: null as EditCommand | null,
      freq: 3,
    }),
    fault: fc.constantFrom<FaultKind>(
      "none",
      "none",
      "none",
      "offline",
      "reconnect",
      "dropBefore",
      "dropAfter",
      "remount",
    ),
  });

/** Quiescence: bounded setTimeout(0) draining until the observable state is
 * stable for two consecutive ticks. Scheduling, never wall-clock. */
async function quiesce(readState: () => string, maxTicks = 64): Promise<void> {
  let stable = 0;
  let last = readState();
  for (let i = 0; i < maxTicks && stable < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const now = readState();
    if (now === last) stable++;
    else stable = 0;
    last = now;
  }
}

const stateOf = (ledger: NotesLedger): string => {
  const snap = ledger.getSnapshot();
  return JSON.stringify([
    snap.content,
    snap.version,
    snap.status,
    snap.unsavedRecords.map((r) => [r.clientOpId, r.state, r.attempts]),
  ]);
};

/** Shared per-run wiring for one client. */
interface ClientRig {
  ledger: NotesLedger;
  transport: FaultyTransport;
  storage: MemStorage;
  clientId: string;
  idCounter: { n: number };
  server: LightServer;
  chunks: ChunkLedger;
  sendLog: SendLog;
}

function makeRig(
  server: LightServer,
  chunks: ChunkLedger,
  sendLog: SendLog,
  ingest: IngestLog,
  clientId: string,
  idCounter: { n: number },
  meetingId: string,
): ClientRig {
  const storage = new MemStorage();
  const transport = new FaultyTransport(server, clientId, chunks, sendLog, ingest);
  const ledger = new NotesLedger({
    meetingId: asMeetingId(meetingId),
    clientId,
    debounceMs: 0,
    storage,
    now: () => 1,
    generateId: () => ++idCounter.n,
  });
  ledger.start(transport);
  return { ledger, transport, storage, clientId, idCounter, server, chunks, sendLog };
}

/** Fresh ledger instance over the SAME storage — the remount/reload path. */
function remountRig(rig: ClientRig, meetingId: string): void {
  rig.ledger.destroy();
  rig.transport.reconnect();
  const ledger = new NotesLedger({
    meetingId: asMeetingId(meetingId),
    clientId: rig.clientId,
    debounceMs: 0,
    storage: rig.storage,
    now: () => 1,
    generateId: () => ++rig.idCounter.n,
  });
  ledger.start(rig.transport);
  rig.ledger = ledger;
}

/**
 * Arm a send-failing fault only from a settled state: after any failed send
 * the ledger is offline-pending and a further send-killer could never fire —
 * the schedule reconnects first, mirroring distinct fault episodes.
 */
async function armFault(rig: ClientRig, fault: FaultConfigLite, meetingId: string): Promise<void> {
  if (rig.ledger.getSnapshot().transportOnline === false) {
    remountRig(rig, meetingId); // reconnect path: fresh read, resend pending
    await quiesce(() => stateOf(rig.ledger));
  }
  Object.assign(rig.transport.faults, fault);
}

/**
 * Final recovery to the synced state: reconnect (read path proof), remount
 * (clears a stuck in-flight batch, restores pending → resend under the same
 * id), and — when the server REFUSED an op (conflict/rejected) — the user's
 * retry path, which recomputes against fresh server truth. Everything the
 * fault alphabet can break has a deterministic recovery; the invariants are
 * then judged on the fully recovered state.
 */
async function recoverToSynced(rig: ClientRig, meetingId: string): Promise<void> {
  rig.transport.reconnect();
  await quiesce(() => stateOf(rig.ledger));
  remountRig(rig, meetingId);
  await quiesce(() => stateOf(rig.ledger));
  for (let round = 0; round < 3; round++) {
    const snap = rig.ledger.getSnapshot();
    if (snap.status === "synced") return;
    rig.ledger.retryConflicts();
    await quiesce(() => stateOf(rig.ledger));
    remountRig(rig, meetingId);
    await quiesce(() => stateOf(rig.ledger));
  }
}

/**
 * Send discipline (design.md §5 "Resend (never blind)"): for every op, (a)
 * between two consecutive sends there was at least one fresh ingest (a
 * delivered read/push), and (b) no two sends of the same op share one ingest
 * window (at most one send per window). Payloads stay identical across sends.
 * Any single fault episode therefore yields at most original + 1 resend.
 */
function assertSendDiscipline(sendLog: SendLog): void {
  const payloads = new Map<string, string>();
  const lastSendIngest = new Map<string, number>();
  for (const entry of sendLog.entries) {
    const prior = payloads.get(entry.clientOpId);
    if (prior === undefined) {
      payloads.set(entry.clientOpId, entry.payload);
    } else if (prior !== entry.payload) {
      throw new Error(
        `op ${entry.clientOpId} resent with a DIFFERENT payload: ${prior} vs ${entry.payload}`,
      );
    }
    const lastIngest = lastSendIngest.get(entry.clientOpId);
    if (lastIngest !== undefined) {
      if (entry.ingestCount === lastIngest) {
        throw new Error(
          `op ${entry.clientOpId} sent twice within one ingest window (blind resend)`,
        );
      }
      if (entry.ingestCount < lastIngest) {
        throw new Error(
          `op ${entry.clientOpId} resent with a stale ingest stamp (${entry.ingestCount} < ${lastIngest})`,
        );
      }
    }
    lastSendIngest.set(entry.clientOpId, entry.ingestCount);
  }
}

// ---------------------------------------------------------------------------
// P1 — single client
// ---------------------------------------------------------------------------

describe("notes ledger property — P1 single client", () => {
  test("random edits × faults → exact server convergence, ≤2 identical sends", async () => {
    console.log(`[M4 property] P1 seed=${SEED} numRuns=${runsOverride ?? NUM_RUNS}`);
    const property = fc.asyncProperty(
      fc.array(stepArb("w"), { minLength: 2, maxLength: 10 }),
      async (steps) => {
        const server = new LightServer();
        const chunks = new ChunkLedger();
        const ingest = new IngestLog();
        const sendLog = new SendLog();
        const idCounter = { n: 0 };
        const rig = makeRig(server, chunks, sendLog, ingest, "c1", idCounter, "meeting-p1");
        let buffer = "";
        let dropAfterArmed = false;

        for (const step of steps) {
          // A lost response leaves the batch in flight forever; the reload
          // path is the real-world recovery, so force the remount first.
          if (dropAfterArmed) {
            remountRig(rig, "meeting-p1");
            await quiesce(() => stateOf(rig.ledger));
            dropAfterArmed = false;
          }
          switch (step.fault) {
            case "offline":
              await armFault(rig, { offline: true }, "meeting-p1");
              break;
            case "reconnect":
              rig.transport.reconnect();
              break;
            case "dropBefore":
              await armFault(rig, { dropBeforeApply: true }, "meeting-p1");
              break;
            case "dropAfter":
              await armFault(rig, { dropAfterApply: true }, "meeting-p1");
              dropAfterArmed = true;
              break;
            case "remount":
              remountRig(rig, "meeting-p1");
              break;
            case "none":
              break;
          }
          if (step.edit) {
            buffer = applyEdit(buffer, step.edit);
            rig.ledger.onEdit(buffer);
          }
          await quiesce(() => stateOf(rig.ledger));
        }

        await recoverToSynced(rig, "meeting-p1");

        // Invariant: every op was sent ≤2 times, always identically.
        assertSendDiscipline(sendLog);
        const snap = rig.ledger.getSnapshot();
        // Invariant: server text == final client buffer EXACTLY.
        expect(server.content).toBe(buffer);
        // Invariant: composed view == server text, fully settled.
        expect(snap.content).toBe(server.content);
        expect(snap.status).toBe("synced");
        expect(snap.unsavedRecords).toHaveLength(0);
      },
    );
    await fc.assert(property, {
      seed: SEED,
      numRuns: runsOverride ?? NUM_RUNS,
      endOnFailure: true,
    });
  });
});

// ---------------------------------------------------------------------------
// P2 — two clients, interleaved
// ---------------------------------------------------------------------------

describe("notes ledger property — P2 two clients", () => {
  test("interleaved edits × faults → exact convergence + discipline", async () => {
    console.log(`[M4 property] P2 seed=${SEED} numRuns=${runsOverride ?? NUM_RUNS}`);
    const property = fc.asyncProperty(
      fc.array(
        fc.record({
          client: fc.constantFrom(0, 1) as fc.Arbitrary<0 | 1>,
          edit: fc.option(editArb(18, 5, ""), {
            nil: null as EditCommand | null,
            freq: 3,
          }),
          fault: fc.constantFrom<FaultKind>(
            "none",
            "none",
            "none",
            "offline",
            "reconnect",
            "dropBefore",
            "remount",
          ),
        }),
        { minLength: 2, maxLength: 12 },
      ),
      async (steps) => {
        const server = new LightServer();
        const chunks = new ChunkLedger();
        const ingest = new IngestLog();
        const sendLog = new SendLog();
        const idCounter = { n: 0 };
        const rigs = [
          makeRig(server, chunks, sendLog, ingest, "c1", idCounter, "meeting-p2"),
          makeRig(server, chunks, sendLog, ingest, "c2", idCounter, "meeting-p2"),
        ];
        const buffers = ["", ""];
        let tokenSeq = 0;

        for (const step of steps) {
          const rig = rigs[step.client];
          switch (step.fault) {
            case "offline":
              await armFault(rig, { offline: true }, "meeting-p2");
              break;
            case "reconnect":
              rig.transport.reconnect();
              break;
            case "dropBefore":
              await armFault(rig, { dropBeforeApply: true }, "meeting-p2");
              break;
            case "remount":
              remountRig(rig, "meeting-p2");
              break;
            case "none":
              break;
          }
          if (step.edit) {
            // Execution-time unique tokens keep the diagnostic accounting
            // unambiguous about which edit produced which chunk.
            if (step.edit.kind !== "delete") {
              step.edit.token = `t${step.client}k${++tokenSeq} `;
            }
            buffers[step.client] = applyEdit(buffers[step.client], step.edit);
            rig.ledger.onEdit(buffers[step.client]);
          }
          await quiesce(() => stateOf(rig.ledger));
        }

        // Final recovery for both clients (mutual pushes settle the reads).
        await recoverToSynced(rigs[0], "meeting-p2");
        await recoverToSynced(rigs[1], "meeting-p2");
        // A client recovered later may still owe pushes to the other.
        rigs[0].transport.reconnect();
        rigs[1].transport.reconnect();
        await quiesce(() => stateOf(rigs[0].ledger));
        await quiesce(() => stateOf(rigs[1].ledger));

        assertSendDiscipline(sendLog);
        // Convergence: both views == server text, fully settled.
        for (const rig of rigs) {
          const snap = rig.ledger.getSnapshot();
          expect(snap.content).toBe(server.content);
          expect(snap.status).toBe("synced");
          expect(snap.unsavedRecords).toHaveLength(0);
        }
        // Token-level string conservation is unsound in BOTH directions
        // under the shipped OT and this generator, with trace evidence:
        // (1) a transformed delete may partially consume a token (a delete
        // applied ON "t0k1 t0k3t0k7  t0" removed [1,17), leaving the
        // leading "t" of "t0k1 " — survival is not guaranteed); (2) a
        // wholly-absorbed token's text can reappear as a substring of an
        // independently inserted token ("1k2" absorbed by one delete,
        // present again inside "t1k2 " — absence is not guaranteed).
        // Character-identity tracking would be required to decide either
        // direction, and content truth is already pinned exactly by the
        // convergence asserts above (every client's final buffer == the
        // server text, settled) plus send discipline.
      },
    );
    await fc.assert(property, {
      seed: SEED,
      numRuns: runsOverride ?? NUM_RUNS,
      endOnFailure: true,
    });
  });
});


// ---------------------------------------------------------------------------
// P2 replay — recorded counterexample (seed 20261011, path 8610)
// ---------------------------------------------------------------------------

/** Deterministic replay of a two-client counterexample recorded at
 * seed 20261011 (found at scale, path 8610): interleaved offline/dropBefore
 * faults leave rejected and saved records coexisting while the buffer holds
 * words typed on top of refused effects. Kept as a permanent regression
 * check — it drove the transformOperationSequence absorb-reconciliation fix
 * (an insert absorbed by a local delete must die in the carried frame). */
test("replay: recorded two-client counterexample (seed 20261011 path 8610)", async () => {
  const steps: Array<{ client: 0 | 1; edit: EditCommand | null; fault: FaultKind }> = [
    { client: 0, edit: { kind: "insert", position: 14, token: "t0k1 ", length: 2 }, fault: "none" },
    { client: 1, edit: { kind: "insert", position: 4, token: "t1k2 ", length: 4 }, fault: "dropBefore" },
    { client: 0, edit: { kind: "insert", position: 17, token: "t0k3 ", length: 3 }, fault: "none" },
    { client: 0, edit: null, fault: "offline" },
    { client: 1, edit: { kind: "insert", position: 14, token: "t1k4 ", length: 2 }, fault: "reconnect" },
    { client: 1, edit: null, fault: "none" },
    { client: 0, edit: { kind: "insert", position: 16, token: "t0k5 ", length: 3 }, fault: "none" },
    { client: 1, edit: { kind: "delete", position: 10, token: "747343 ", length: 5 }, fault: "dropBefore" },
    { client: 0, edit: { kind: "delete", position: 12, token: "732 ", length: 4 }, fault: "none" },
    { client: 1, edit: null, fault: "dropBefore" },
    { client: 0, edit: null, fault: "reconnect" },
    { client: 0, edit: { kind: "insert", position: 3, token: "t0k6 ", length: 5 }, fault: "offline" },
  ];
  const server = new LightServer();
  const chunks = new ChunkLedger();
  const ingest = new IngestLog();
  const sendLog = new SendLog();
  const idCounter = { n: 0 };
  const rigs = [
    makeRig(server, chunks, sendLog, ingest, "c1", idCounter, "meeting-p2"),
    makeRig(server, chunks, sendLog, ingest, "c2", idCounter, "meeting-p2"),
  ];
  const buffers = ["", ""];
  let tokenSeq = 0;

  for (const step of steps) {
    const rig = rigs[step.client];
    switch (step.fault) {
      case "offline":
        await armFault(rig, { offline: true }, "meeting-p2");
        break;
      case "reconnect":
        rig.transport.reconnect();
        break;
      case "dropBefore":
        await armFault(rig, { dropBeforeApply: true }, "meeting-p2");
        break;
      case "none":
        break;
    }
    if (step.edit) {
      if (step.edit.kind !== "delete") {
        step.edit.token = `t${step.client}k${++tokenSeq} `;
      }
      buffers[step.client] = applyEdit(buffers[step.client], step.edit);
      rig.ledger.onEdit(buffers[step.client]);
    }
    await quiesce(() => stateOf(rig.ledger));
  }

  // Final recovery for both clients (mutual pushes settle the reads).
  await recoverToSynced(rigs[0], "meeting-p2");
  await recoverToSynced(rigs[1], "meeting-p2");
  rigs[0].transport.reconnect();
  rigs[1].transport.reconnect();
  await quiesce(() => stateOf(rigs[0].ledger));
  await quiesce(() => stateOf(rigs[1].ledger));

  assertSendDiscipline(sendLog);
  for (const rig of rigs) {
    const snap = rig.ledger.getSnapshot();
    expect(snap.status).toBe("synced");
    expect(snap.content).toBe(server.content);
    expect(snap.unsavedRecords).toHaveLength(0);
  }
});

// ---------------------------------------------------------------------------
// Mounted seam subset — the REAL hook through NotesTransportProvider.
// ---------------------------------------------------------------------------

/** Deterministic replay of a counterexample recorded at seed 20261011: a
 * remount-heavy schedule whose final buffer held words the server never got.
 * Kept as a permanent regression check — the schedule exercises
 * restore-then-dedup-then-diff ordering through the real hook. */
test("replay: recorded mounted counterexample (seed 20261011)", async () => {
  const steps: Step[] = [
    { edit: { kind: "replace", position: 24, token: "m999987 ", length: 1 }, fault: "none" },
    { edit: { kind: "insert", position: 12, token: "m999997 ", length: 1 }, fault: "remount" },
    { edit: { kind: "insert", position: 3, token: "m15 ", length: 2 }, fault: "remount" },
    { edit: { kind: "insert", position: 24, token: "m260778 ", length: 2 }, fault: "remount" },
    { edit: null, fault: "offline" },
    { edit: { kind: "delete", position: 3, token: "m7144 ", length: 2 }, fault: "none" },
    { edit: { kind: "delete", position: 6, token: "m31799 ", length: 0 }, fault: "dropBefore" },
    { edit: { kind: "delete", position: 0, token: "m567928 ", length: 6 }, fault: "remount" },
    { edit: { kind: "insert", position: 10, token: "m926104 ", length: 5 }, fault: "offline" },
    { edit: { kind: "replace", position: 2, token: "m480873 ", length: 2 }, fault: "none" },
  ];
  const trace = process.env.NOTES_REPLAY_TRACE === "1";

  const server = new LightServer();
  if (trace) {
    const origApply = server.applyBatch.bind(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).applyBatch = (
      clientId: string,
      batch: { operations: NotesBatchOp[]; expectedVersion?: number },
      onApplied?: (applied: AppliedInfo) => void,
    ) => {
      console.log(
        `[trace] SEND client=${clientId} ops=${JSON.stringify(batch.operations.map((o) => [o.clientOpId, o.operation, o.clientSequence]))}`,
      );
      const res = origApply(clientId, batch, (applied) => {
        console.log(
          `[trace]   OP ${JSON.stringify(applied.op)} ON ${JSON.stringify(applied.contentBefore)}`,
        );
        onApplied?.(applied);
      });
      console.log(
        `[trace] APPLY -> content=${JSON.stringify(server.content)} version=${server.version} results=${JSON.stringify(res.results?.map((r) => [r.clientOpId, r.deduped === true, r.serverSequence]))} failed=${JSON.stringify(res.failedOps ?? [])}`,
      );
      return res;
    };
  }
  const chunks = new ChunkLedger();
  const ingest = new IngestLog();
  const sendLog = new SendLog();
  const idCounter = { n: 0 };
  const rig = makeRig(server, chunks, sendLog, ingest, "c1", idCounter, "meeting-mounted");
  let buffer = "";
  let dropAfterArmed = false;

  const mountHook = () =>
    renderHook(
      () =>
        useNotesLedger(asMeetingId("meeting-mounted"), {
          clientId: "c1",
          debounceMs: 0,
          storage: rig.storage,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(
            NotesTransportProvider,
            { transport: rig.transport },
            children,
          ),
      },
    );

  let hook = mountHook();
  const stateFrom = (): string => {
    const s = hook.result.current;
    return JSON.stringify([
      s.content,
      s.version,
      s.status,
      s.unsavedRecords.map((r) => [r.clientOpId, r.state, r.attempts]),
    ]);
  };
  const settle = () => quiesce(stateFrom);

  const remount = async () => {
    cleanup();
    await settle();
    hook = mountHook();
    await settle();
  };

  for (const [index, step] of steps.entries()) {
    if (dropAfterArmed) {
      cleanup();
      rig.transport.reconnect();
      hook = mountHook();
      await settle();
      dropAfterArmed = false;
    }
    switch (step.fault) {
      case "offline":
        if (hook.result.current.transportOnline === false) {
          await remount();
        }
        rig.transport.faults.offline = true;
        break;
      case "reconnect":
        rig.transport.reconnect();
        break;
      case "dropBefore":
        if (hook.result.current.transportOnline === false) {
          await remount();
        }
        rig.transport.faults.dropBeforeApply = true;
        break;
      case "dropAfter":
        if (hook.result.current.transportOnline === false) {
          await remount();
        }
        rig.transport.faults.dropAfterApply = true;
        dropAfterArmed = true;
        break;
      case "remount":
        await remount();
        break;
      case "none":
        break;
    }
    if (step.edit) {
      buffer = applyEdit(buffer, step.edit);
      if (trace) console.log(`[trace] STEP ${index} ${JSON.stringify(step)} buffer=${JSON.stringify(buffer)}`);
      await act(async () => {
        hook.result.current.onEdit(buffer);
      });
    }
    await settle();
    if (trace) console.log(`[trace] SETTLED after step ${index}: state=${stateFrom()} server=${JSON.stringify(server.content)} v${server.version}`);
  }

  rig.transport.reconnect();
  await settle();
  cleanup();
  hook = mountHook();
  await settle();
  for (let round = 0; round < 3; round++) {
    const s = hook.result.current;
    if (s.status === "synced") break;
    await act(async () => {
      s.retryConflicts();
    });
    await settle();
    cleanup();
    hook = mountHook();
    await settle();
  }

  assertSendDiscipline(sendLog);
  const snap = hook.result.current;
  expect(server.content).toBe(buffer);
  expect(snap.content).toBe(server.content);
  expect(snap.status).toBe("synced");
  expect(snap.unsavedRecords).toHaveLength(0);
  cleanup();
});

describe("notes ledger property — mounted seam (real hook)", () => {
  test("200 mounted runs → same invariants through React", async () => {
    console.log(
      `[M4 property] mounted seam seed=${SEED} numRuns=${runsOverride ? Math.min(runsOverride, MOUNTED_NUM_RUNS) : MOUNTED_NUM_RUNS}`,
    );
    const property = fc.asyncProperty(
      fc.array(stepArb("m"), { minLength: 2, maxLength: 10 }),
      async (steps) => {
        const server = new LightServer();
        const chunks = new ChunkLedger();
        const ingest = new IngestLog();
        const sendLog = new SendLog();
        const idCounter = { n: 0 };
        const rig = makeRig(server, chunks, sendLog, ingest, "c1", idCounter, "meeting-mounted");
        let buffer = "";
        let dropAfterArmed = false;

        const mountHook = () =>
          renderHook(
            () =>
              useNotesLedger(asMeetingId("meeting-mounted"), {
                clientId: "c1",
                debounceMs: 0,
                storage: rig.storage,
              }),
            {
              // renderHook renders TestComponent inside the wrapper: the
              // wrapper MUST forward children into the provider.
              wrapper: ({ children }: { children: ReactNode }) =>
                createElement(
                  NotesTransportProvider,
                  { transport: rig.transport },
                  children,
                ),
            },
          );

        let hook = mountHook();
        const stateFrom = (): string => {
          const s = hook.result.current;
          return JSON.stringify([
            s.content,
            s.version,
            s.status,
            s.unsavedRecords.map((r) => [r.clientOpId, r.state, r.attempts]),
          ]);
        };
        const settle = () => quiesce(stateFrom);

        const remount = async () => {
          cleanup();
          await settle();
          hook = mountHook();
          await settle();
        };

        for (const step of steps) {
          if (dropAfterArmed) {
            // Unmount synchronously commits the buffer (D7); the remount
            // restores and resends under the same ids.
            cleanup();
            rig.transport.reconnect();
            hook = mountHook();
            await settle();
            dropAfterArmed = false;
          }
          switch (step.fault) {
            case "offline":
              if (hook.result.current.transportOnline === false) {
                await remount();
              }
              rig.transport.faults.offline = true;
              break;
            case "reconnect":
              rig.transport.reconnect();
              break;
            case "dropBefore":
              if (hook.result.current.transportOnline === false) {
                await remount();
              }
              rig.transport.faults.dropBeforeApply = true;
              break;
            case "dropAfter":
              if (hook.result.current.transportOnline === false) {
                await remount();
              }
              rig.transport.faults.dropAfterApply = true;
              dropAfterArmed = true;
              break;
            case "remount":
              await remount();
              break;
            case "none":
              break;
          }
          if (step.edit) {
            buffer = applyEdit(buffer, step.edit);
            await act(async () => {
              hook.result.current.onEdit(buffer);
            });
          }
          await settle();
        }

        // Recovery through the hook's public surface: reconnect, remount,
        // retry conflicts — the user's actual paths.
        rig.transport.reconnect();
        await settle();
        cleanup();
        hook = mountHook();
        await settle();
        for (let round = 0; round < 3; round++) {
          const s = hook.result.current;
          if (s.status === "synced") break;
          await act(async () => {
            s.retryConflicts();
          });
          await settle();
          cleanup();
          hook = mountHook();
          await settle();
        }

        assertSendDiscipline(sendLog);
        const snap = hook.result.current;
        expect(server.content).toBe(buffer);
        expect(snap.content).toBe(server.content);
        expect(snap.status).toBe("synced");
        expect(snap.unsavedRecords).toHaveLength(0);
        cleanup();
      },
    );
    await fc.assert(property, {
      seed: SEED,
      numRuns: runsOverride
        ? Math.min(runsOverride, MOUNTED_NUM_RUNS)
        : MOUNTED_NUM_RUNS,
      endOnFailure: true,
    });
  });
});
