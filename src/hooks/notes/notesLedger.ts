/**
 * Framework-free notes ledger (docs/notes-ledger-f1/design.md §3).
 *
 * Owns the loss-proof sync state machine for in-call collaborative notes:
 *  - a pending-operation ledger keyed by `clientOpId`, each op stamped with
 *    `clientSequence` = the incorporated server-history watermark at creation
 *    (the OT basis the server transforms against — never a counter);
 *  - sibling-op diffs (delete+insert from ONE base coordinate system);
 *  - monotonic snapshot ingest (stale/loading results never drop or rewind
 *    local work);
 *  - serialized flushes (never two batches in flight; a follow-up batch only
 *    after a fresh snapshot incorporates the previous one);
 *  - identity-only acknowledgement retirement (per-op echo / clientAcks —
 *    never text matching, never blanket batch acks);
 *  - evidence-gated resend reusing the SAME clientOpId (server dedupe makes
 *    this safe; a `deduped: true` echo retires the op);
 *  - synchronous teardown commit + sessionStorage recovery per meeting+client.
 *
 * The React hook (`useNotesLedger.ts`) binds this store into
 * `useSyncExternalStore`; all logic lives here, framework-free.
 */

import type { Id } from "@convex/_generated/dataModel";
import { applyOperations, diffToSiblingOps } from "./notesDiff";
import type {
  BatchApplyNoteOperationsResponse,
  NotesBatchOp,
  NotesOperation,
  NotesServerSnapshot,
  NotesTransport,
  UseNotesLedgerResult,
} from "./types";

/** Internal lifecycle of one pending operation. */
export type NotesLedgerRecordState =
  | "pending"
  | "sending"
  | "unconfirmed"
  | "saved"
  | "conflict"
  | "rejected";

/** One operation in the pending ledger. */
export interface NotesLedgerRecord {
  clientOpId: string;
  op: NotesOperation;
  /** Incorporated server-history watermark at op creation (OT basis). */
  clientSequence: number;
  /** Server version the op was diffed against. */
  baseVersion: number;
  state: NotesLedgerRecordState;
  /** Words this op contributes to the composed view (inserts only). */
  content: string;
  attempts: number;
  failureReason?: string;
  serverSequence?: number;
}

export interface NotesLedgerOptions {
  /** Branded meeting id — passed verbatim to the transport seam (types.ts). */
  meetingId: Id<"meetings">;
  clientId: string;
  /** Debounce for keystroke flushes; 0 sends on the next microtask-ish tick. */
  debounceMs?: number;
  /** Recovery store; defaults to sessionStorage when available. */
  storage?: Storage | null;
  now?: () => number;
  generateId?: () => number;
}

interface PersistedRecord {
  clientOpId: string;
  op: NotesOperation;
  clientSequence: number;
  baseVersion: number;
  state: NotesLedgerRecordState;
  content: string;
  attempts: number;
  failureReason?: string;
  serverSequence?: number;
}

interface PersistedLedger {
  payloadVersion: 1;
  meetingId: string;
  clientId: string;
  serverVersion: number;
  serverContent: string;
  headSequence: number;
  baseVersion: number;
  baseContent: string;
  baseHeadSequence: number;
  buffer: string;
  bufferHoldsUnsentWords: boolean;
  records: PersistedRecord[];
  awaitingAdoptionVersion: number | null;
  transportOnline: boolean;
}

/** Transports may optionally expose a manual refresh (re-read trigger). */
interface NotesTransportWithRefresh {
  refresh?(): void;
}

type TransportFailureClass =
  | "conflict"
  | "forbidden"
  | "unreachable"
  | "unknown";

const PAYLOAD_VERSION = 1;
const STORAGE_PREFIX = "connvo-notes-ledger";
const DEFAULT_DEBOUNCE_MS = 800;

/** Classify a transport failure: did the server SEE the ops or not? */
export function classifyTransportError(error: unknown): TransportFailureClass {
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === "CONFLICT") return "conflict";
  if (code === "FORBIDDEN" || code === "UNAUTHORIZED") return "forbidden";
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT"
  ) {
    return "unreachable";
  }
  const text = error instanceof Error ? error.message : String(error);
  if (/conflict/i.test(text)) return "conflict";
  if (/forbidden|unauthorized|not authorized/i.test(text)) return "forbidden";
  if (/unreachable|network|econnrefused|enotfound|econnreset|timeout|timed out|abort/i.test(text)) {
    return "unreachable";
  }
  return "unknown";
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * A record persisted mid-flight ("sending") or held "unconfirmed" can never
 * receive its response after a remount — the transport that would have
 * answered is gone. The only resolution path is a resend under the SAME
 * clientOpId, which the server dedupes; "conflict"/"rejected" are kept so
 * the remounted panel can still surface and retry them.
 */
function normalizeRestoredRecord(record: NotesLedgerRecord): NotesLedgerRecord {
  if (record.state === "sending" || record.state === "unconfirmed") {
    return { ...record, state: "pending" as const };
  }
  return record;
}

/** Record states the pinned contract exposes as visible unsaved work. */
type UnsavedRecordState = Exclude<NotesLedgerRecordState, "saved">;

/** Type predicate: filtering on it proves the mapped records match the pinned
 * `unsavedRecords` state union — no cast between map and snapshot. */
function isUnsaved(
  record: NotesLedgerRecord,
): record is NotesLedgerRecord & { state: UnsavedRecordState } {
  return record.state !== "saved";
}

function isWellFormedSnapshot(snapshot: NotesServerSnapshot): boolean {
  return (
    typeof snapshot.content === "string" &&
    typeof snapshot.version === "number" &&
    Number.isFinite(snapshot.version) &&
    typeof snapshot.headSequence === "number" &&
    Array.isArray(snapshot.clientAcks)
  );
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Denylisted storage access (Safari private mode etc.) — recovery is
    // degraded but the ledger stays correct.
    return null;
  }
}

export class NotesLedger {
  readonly meetingId: Id<"meetings">;
  readonly clientId: string;

  private readonly debounceMs: number;
  private readonly storage: Storage | null;
  private readonly now: () => number;
  private readonly generateId: () => number;
  private readonly listeners = new Set<() => void>();

  private records = new Map<string, NotesLedgerRecord>();
  private acks = new Map<
    string,
    { serverSequence: number; clientSequence: number }
  >();
  private serverVersion = -1;
  private serverContent = "";
  private headSequence = 0;
  private baseVersion = -1;
  private baseContent = "";
  private baseHeadSequence = 0;
  private buffer = "";
  private bufferHoldsUnsentWords = false;
  private awaitingAdoptionVersion: number | null = null;
  private batchInFlight = false;
  private flushRequested = false;
  private transport: NotesTransport | null = null;
  private unsubscribeTransport: (() => void) | undefined;
  private transportOnline = true;
  private destroyed = true;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotCache: UseNotesLedgerResult | undefined;

  constructor(options: NotesLedgerOptions) {
    this.meetingId = options.meetingId;
    this.clientId = options.clientId;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? Math.random;
    this.restore();
  }

  // ---------------------------------------------------------------------
  // External-store surface
  // ---------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): UseNotesLedgerResult => {
    if (this.snapshotCache === undefined) {
      this.snapshotCache = this.buildSnapshot();
    }
    return this.snapshotCache;
  };

  /** Mount: restore persisted state, then subscribe to server snapshots. */
  start(transport: NotesTransport): void {
    this.transport = transport;
    this.destroyed = false;
    this.unsubscribeTransport?.();
    this.restore();
    this.unsubscribeTransport = transport.subscribe(
      this.meetingId,
      this.clientId,
      this.ingest,
    );
    // Restored pending work (or a buffer ahead of its base) must flush even
    // when the meeting has no notes row yet — the query returns null until
    // the first batch, so waiting for a defined ingest would deadlock the
    // recovery. The bootstrap flush diffs from empty content; a later fresh
    // read reconciles.
    if (
      this.flushRequested ||
      [...this.records.values()].some((record) => record.state === "pending")
    ) {
      this.flushRequested = true;
      this.flush();
    }
  }

  /**
   * Unmount: synchronously commit the edit buffer into the ledger (D7 — an
   * unmount inside the debounce window must never lose words), persist, and
   * unsubscribe. The words survive as records; the remount's flush resends
   * them under the same clientOpIds (server dedupe makes this safe).
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearDebounce();
    const composed = this.composedText();
    if (this.buffer !== composed) {
      if (this.batchInFlight) {
        // Keep the words in the buffer; the remount re-diffs them against
        // whatever the in-flight batch produced.
        this.bufferHoldsUnsentWords = true;
      } else {
        const ops = diffToSiblingOps(composed, this.buffer);
        if (ops.length > 0) this.createRecords(ops);
        this.bufferHoldsUnsentWords = false;
      }
    }
    this.persist();
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    this.transport = null;
  }

  /** Call on every textarea change; debounces a flush internally. */
  onEdit = (text: string): void => {
    if (this.destroyed) return;
    this.buffer = text;
    // Only "unsent" when the buffer differs from the composed view — a
    // no-op edit must not latch the updating state forever.
    this.bufferHoldsUnsentWords = text !== this.composedText();
    this.scheduleDebounce();
    this.commit();
  };

  /** Immediate flush (blur/unmount). */
  flushNow = (): void => {
    this.clearDebounce();
    this.flush();
  };

  /** Recompute conflicted/rejected ops against fresh server truth. */
  retryConflicts = (): void => {
    const conflicted = [...this.records.values()].filter(
      (record) => record.state === "conflict" || record.state === "rejected",
    );
    if (conflicted.length === 0) return;
    // Preserve the visible words in the buffer before dropping their records,
    // so the re-diff below can rebuild them from fresh server truth.
    if (!this.bufferHoldsUnsentWords) {
      this.buffer = this.composedText();
      this.bufferHoldsUnsentWords = true;
    }
    for (const record of conflicted) {
      this.records.delete(record.clientOpId);
    }
    this.rebaseIfSafe();
    const ops = diffToSiblingOps(this.composedText(), this.buffer);
    if (ops.length > 0) this.createRecords(ops);
    // The buffer's words now live in ledger records (or were already
    // composed) — mirror the keystroke-path handoff in flush(), otherwise
    // the status latches on "updating" after a successful retry.
    this.bufferHoldsUnsentWords = false;
    this.flush();
    this.commit();
  };

  // ---------------------------------------------------------------------
  // Snapshot ingest
  // ---------------------------------------------------------------------

  private ingest = (snapshot: NotesServerSnapshot | undefined): void => {
    if (this.destroyed) return;
    if (snapshot === undefined) return; // a loading result carries no evidence
    this.transportOnline = true; // a well-formed delivery proves the read path
    if (!isWellFormedSnapshot(snapshot)) return;

    if (
      snapshot.version === this.serverVersion &&
      snapshot.content === this.serverContent
    ) {
      // Idempotent redelivery — still fresh read evidence for demotion.
      this.mergeAcks(snapshot);
      this.demoteUnconfirmedWithoutAcks(snapshot);
      this.runRequestedFlush();
      return;
    }
    if (snapshot.version <= this.serverVersion) return; // stale — never rewind

    this.mergeAcks(snapshot);
    this.retireFromAcks(snapshot);
    this.demoteUnconfirmedWithoutAcks(snapshot);
    this.recomputeStalePendingOps(snapshot);
    this.advanceServerState(snapshot);
    this.rebaseIfSafe();
    this.runRequestedFlush();
    this.commit();
  };

  private mergeAcks(snapshot: NotesServerSnapshot): void {
    for (const ack of snapshot.clientAcks) {
      if (typeof ack?.clientOpId !== "string") continue;
      this.acks.set(ack.clientOpId, {
        serverSequence: ack.serverSequence,
        clientSequence: ack.clientSequence,
      });
    }
  }

  /** Retire records on per-op identity evidence from the server acks. */
  private retireFromAcks(snapshot: NotesServerSnapshot): void {
    for (const ack of snapshot.clientAcks) {
      if (typeof ack?.clientOpId !== "string") continue;
      const record = this.records.get(ack.clientOpId);
      if (!record || record.state === "saved") continue;
      record.state = "saved";
      record.serverSequence = ack.serverSequence;
      record.failureReason = undefined;
    }
  }

  /**
   * Demote unconfirmed → pending when a fresh read past the op's basis shows
   * no ack for it: the server is beyond the op's creation basis without the
   * op, which is evidence it was never applied. failureReason stays metadata.
   */
  private demoteUnconfirmedWithoutAcks(snapshot: NotesServerSnapshot): void {
    let demoted = false;
    for (const record of this.records.values()) {
      if (record.state !== "unconfirmed") continue;
      if (this.acks.has(record.clientOpId)) continue;
      if (record.baseVersion < snapshot.version) {
        record.state = "pending";
        record.failureReason = "no acknowledgement on a fresh read";
        demoted = true;
      }
    }
    if (demoted) {
      this.flushRequested = true;
      this.commit();
    }
  }

  /**
   * Never-sent pending operations based on an older watermark are stale: drop
   * them and re-diff from the preserved buffer. Sent or unconfirmed operations
   * keep their clientOpIds (their outcome must resolve on identity evidence).
   */
  private recomputeStalePendingOps(snapshot: NotesServerSnapshot): void {
    // Only NEVER-SENT pending ops are stale (attempts === 0): they carry no
    // server identity to preserve. A pended op that was already transmitted
    // — including one just demoted from unconfirmed — keeps its clientOpId:
    // its outcome must resolve on identity evidence, and the resend under
    // the same id is exactly what server dedupe makes safe.
    const stale = [...this.records.values()].filter(
      (record) =>
        record.state === "pending" &&
        record.attempts === 0 &&
        record.clientSequence < snapshot.headSequence,
    );
    if (stale.length === 0) return;
    // Buffer-preservation guard: the words of dropped records must survive.
    // If the buffer is not holding newer user words, capture the composed
    // view (which includes those words) into it first.
    if (!this.bufferHoldsUnsentWords) {
      this.buffer = this.composedText();
      this.bufferHoldsUnsentWords = true;
    }
    for (const record of stale) {
      this.records.delete(record.clientOpId);
    }
  }

  private advanceServerState(snapshot: NotesServerSnapshot): void {
    this.serverVersion = snapshot.version;
    this.serverContent = snapshot.content;
    this.headSequence = snapshot.headSequence;
    if (
      this.awaitingAdoptionVersion !== null &&
      this.serverVersion >= this.awaitingAdoptionVersion
    ) {
      this.awaitingAdoptionVersion = null;
    }
  }

  /** Rebase onto server truth when no live records exist. */
  private rebaseIfSafe(): void {
    const live = [...this.records.values()].filter(isUnsaved);
    if (live.length > 0) return;
    this.baseVersion = this.serverVersion;
    this.baseContent = this.serverContent;
    this.baseHeadSequence = this.headSequence;
    this.records.clear();
  }

  // ---------------------------------------------------------------------
  // Flush pipeline
  // ---------------------------------------------------------------------

  private flushIsBlocked(): boolean {
    if (this.destroyed) return true;
    if (!this.transport) return true;
    if (this.batchInFlight) {
      this.flushRequested = true;
      return true;
    }
    if (!this.transportOnline) {
      this.flushRequested = true;
      return true;
    }
    if (this.awaitingAdoptionVersion !== null) {
      this.flushRequested = true;
      return true;
    }
    return false;
  }

  private runRequestedFlush(): void {
    if (this.flushRequested) this.flush();
  }

  flush(): void {
    if (this.flushIsBlocked()) return;
    const resendable = [...this.records.values()].filter(
      (record) => record.state === "pending",
    );
    if (resendable.length > 0) {
      this.sendBatch(resendable);
      return;
    }
    // Bootstrap/keystroke path: diff the buffer from the current base. With
    // no base yet (a meeting with no notes row), the diff runs from empty
    // content and the first batch creates the row server-side.
    const composed = this.composedText();
    if (this.bufferHoldsUnsentWords && this.buffer !== composed) {
      const ops = diffToSiblingOps(composed, this.buffer);
      if (ops.length > 0) {
        const created = this.createRecords(ops);
        this.bufferHoldsUnsentWords = false;
        this.sendBatch(created);
        return;
      }
    }
    this.flushRequested = false;
  }

  /** Create ledger records for sibling ops; stamps the base watermark as the
   * OT client sequence and stores them in the map before sending. */
  private createRecords(ops: NotesOperation[]): NotesLedgerRecord[] {
    const created: NotesLedgerRecord[] = [];
    for (const op of ops) {
      const record: NotesLedgerRecord = {
        clientOpId: `n-${this.clientId}-${this.now().toString(36)}-${Math.floor(
          this.generateId() * 1e9,
        )
          .toString(36)}`,
        op,
        clientSequence: this.baseHeadSequence,
        baseVersion: this.baseVersion,
        state: "pending",
        content: op.type === "insert" ? (op.content ?? "") : "",
        attempts: 0,
      };
      this.records.set(record.clientOpId, record);
      created.push(record);
    }
    this.persist();
    return created;
  }

  private sendBatch(batch: NotesLedgerRecord[]): void {
    if (!this.transport || batch.length === 0) return;
    this.batchInFlight = true;
    for (const record of batch) {
      record.state = "sending";
      record.attempts += 1;
    }
    this.commit();
    const payload: { operations: NotesBatchOp[]; expectedVersion?: number } = {
      operations: batch.map((record) => ({
        operation: record.op,
        clientSequence: record.clientSequence,
        clientOpId: record.clientOpId,
      })),
      // Deliberately no expectedVersion: concurrency is resolved by the
      // server transforming against clientSequence, not by optimistic
      // version locking, which would conflict on every legitimate
      // concurrent write.
    };
    this.transport
      .applyBatch(this.meetingId, this.clientId, payload)
      .then((response) => this.onBatchSettled(response, batch))
      .catch((error: unknown) => this.onBatchFailed(error, batch));
  }

  private onBatchSettled(
    response: BatchApplyNoteOperationsResponse,
    batch: NotesLedgerRecord[],
  ): void {
    this.batchInFlight = false;
    const applied = new Map<string, number>();
    for (const result of response.results ?? []) {
      // `deduped: true` retires the op too — the server had already applied it.
      if (result?.clientOpId) applied.set(result.clientOpId, result.serverSequence);
    }
    const rejected = new Map<string, string>();
    for (const failedOp of response.failedOps ?? []) {
      if (failedOp?.clientOpId) {
        rejected.set(failedOp.clientOpId, failedOp.reason ?? "rejected by the server");
      }
    }
    let savedCount = 0;
    for (const record of batch) {
      const serverSequence = applied.get(record.clientOpId);
      if (serverSequence !== undefined) {
        record.state = "saved";
        record.serverSequence = serverSequence;
        record.failureReason = undefined;
        this.acks.set(record.clientOpId, {
          serverSequence,
          clientSequence: record.clientSequence,
        });
        savedCount += 1;
        continue;
      }
      const reason = rejected.get(record.clientOpId);
      if (reason !== undefined) {
        record.state = "rejected";
        record.failureReason = reason;
        continue;
      }
      record.state = "unconfirmed";
      record.failureReason = "the response did not echo this operation";
    }
    // Adoption gate: only a batch that produced saved work gates follow-up
    // flushes, and the gate is the op's own basis + 1 — never a response
    // field, so a wrong or foreign response cannot poison it.
    if (savedCount > 0 && batch.length > 0) {
      this.awaitingAdoptionVersion = batch[0].baseVersion + 1;
      // The adoption read may already have landed — a push can precede the
      // response. The gate only waits for a version the client has not
      // incorporated yet, mirroring the ingest-time check.
      if (this.serverVersion >= this.awaitingAdoptionVersion) {
        this.awaitingAdoptionVersion = null;
      }
    }
    this.flushRequested = false;
    this.flush(); // a follow-up batch only proceeds if the gate allows
    this.commit();
  }

  private onBatchFailed(error: unknown, batch: NotesLedgerRecord[]): void {
    this.batchInFlight = false;
    const failure = describeError(error);
    switch (classifyTransportError(error)) {
      case "conflict":
      case "forbidden": {
        // A definite server answer — the ops were seen and refused.
        for (const record of batch) {
          record.state =
            classifyTransportError(error) === "conflict" ? "conflict" : "rejected";
          record.failureReason = failure;
        }
        this.flushRequested = false;
        break;
      }
      case "unreachable": {
        // Definite non-delivery: re-pend. The reconnect read marks the
        // transport online again and runs the requested flush.
        for (const record of batch) {
          record.state = "pending";
          record.failureReason = failure;
        }
        this.transportOnline = false;
        this.flushRequested = true;
        break;
      }
      case "unknown": {
        // Ambiguous: hold as unconfirmed until a fresh read yields evidence
        // (a version advance, or a completed re-read with no ack for the op).
        for (const record of batch) {
          record.state = "unconfirmed";
          record.failureReason = failure;
        }
        this.nudgeFreshRead();
        break;
      }
    }
    this.commit();
  }

  private nudgeFreshRead(): void {
    const transport = this.transport as NotesTransportWithRefresh | null;
    if (!transport || typeof transport.refresh !== "function") return;
    try {
      transport.refresh();
    } catch (error) {
      console.error("notes ledger: transport refresh failed", error);
    }
  }

  // ---------------------------------------------------------------------
  // Composition, snapshots, persistence
  // ---------------------------------------------------------------------

  /** Composed view: server truth of the record base + every record's op
   * replayed in creation order (saved ops remain until the rebase absorbs
   * them into the base, so their words never vanish from the view). */
  private composedText(): string {
    const ops = [...this.records.values()].map((record) => record.op);
    return applyOperations(this.baseContent, ops);
  }

  private buildSnapshot(): UseNotesLedgerResult {
    const all = [...this.records.values()];
    const live = all.filter(isUnsaved);
    const isLoading = this.serverVersion < 0;
    const hasConflict = live.some(
      (record) => record.state === "conflict" || record.state === "rejected",
    );
    let status: UseNotesLedgerResult["status"];
    if (isLoading) {
      status = "loading";
    } else if (!this.transportOnline) {
      status = "offline";
    } else if (hasConflict) {
      status = "conflict";
    } else if (live.some((record) => record.state === "unconfirmed")) {
      status = "unconfirmed";
    } else if (live.length > 0) {
      status = "saving";
    } else if (this.bufferHoldsUnsentWords) {
      status = "updating";
    } else {
      status = "synced";
    }
    return {
      content: this.composedText(),
      version: this.serverVersion,
      isLoading,
      status,
      unconfirmedCount: all.filter(
        (record) => record.state === "unconfirmed",
      ).length,
      unsavedRecords: live.map((record) => ({
        clientOpId: record.clientOpId,
        state: record.state,
        content: record.content,
        attempts: record.attempts,
      })),
      // "Editing" means un-retired local work exists: words still in the
      // debounce buffer, or ledger records the server has not confirmed.
      isEditing: this.bufferHoldsUnsentWords || live.length > 0,
      onEdit: this.onEdit,
      flushNow: this.flushNow,
      retryConflicts: this.retryConflicts,
      transportOnline: this.transportOnline,
    };
  }

  private commit(): void {
    this.snapshotCache = undefined;
    this.persist();
    for (const listener of this.listeners) listener();
  }

  private scheduleDebounce(): void {
    this.clearDebounce();
    if (this.debounceMs <= 0) {
      this.flush();
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.flush();
    }, this.debounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  // ---------------------------------------------------------------------
  // Recovery (sessionStorage, keyed by meetingId + clientId)
  // ---------------------------------------------------------------------

  private get storageKey(): string {
    return `${STORAGE_PREFIX}:${this.meetingId}:${this.clientId}`;
  }

  private persist(): void {
    if (!this.storage) return;
    const payload: PersistedLedger = {
      payloadVersion: PAYLOAD_VERSION,
      meetingId: this.meetingId,
      clientId: this.clientId,
      serverVersion: this.serverVersion,
      serverContent: this.serverContent,
      headSequence: this.headSequence,
      baseVersion: this.baseVersion,
      baseContent: this.baseContent,
      baseHeadSequence: this.baseHeadSequence,
      buffer: this.buffer,
      bufferHoldsUnsentWords: this.bufferHoldsUnsentWords,
      records: [...this.records.values()].map((record) => ({
        clientOpId: record.clientOpId,
        op: record.op,
        clientSequence: record.clientSequence,
        baseVersion: record.baseVersion,
        state: record.state,
        content: record.content,
        attempts: record.attempts,
        failureReason: record.failureReason,
        serverSequence: record.serverSequence,
      })),
      awaitingAdoptionVersion: this.awaitingAdoptionVersion,
      transportOnline: this.transportOnline,
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(payload));
    } catch (error) {
      // Recovery is best-effort; a failed write must not break the ledger.
      console.error("notes ledger: persisting recovery state failed", error);
    }
  }

  private restore(): void {
    if (!this.storage) return;
    let raw: string | null | undefined;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch (error) {
      console.error("notes ledger: reading recovery state failed", error);
      return;
    }
    if (!raw) return;
    let payload: PersistedLedger;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPersistedLedger(parsed)) return;
      payload = parsed;
    } catch {
      return; // corrupt payload — start fresh rather than guess
    }
    if (
      payload.meetingId !== this.meetingId ||
      payload.clientId !== this.clientId
    ) {
      return;
    }
    this.serverVersion = payload.serverVersion;
    this.serverContent = payload.serverContent;
    this.headSequence = payload.headSequence;
    this.baseVersion = payload.baseVersion;
    this.baseContent = payload.baseContent;
    this.baseHeadSequence = payload.baseHeadSequence;
    this.buffer = payload.buffer;
    this.bufferHoldsUnsentWords = payload.bufferHoldsUnsentWords;
    this.awaitingAdoptionVersion = payload.awaitingAdoptionVersion;
    this.transportOnline = payload.transportOnline;
    this.records = new Map(
      payload.records
        .filter((record) => typeof record?.clientOpId === "string")
        .map((record) => [
          record.clientOpId,
          normalizeRestoredRecord(record),
        ]),
    );
  }
}

function isPersistedLedger(value: unknown): value is PersistedLedger {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<PersistedLedger>;
  return (
    payload.payloadVersion === PAYLOAD_VERSION &&
    typeof payload.meetingId === "string" &&
    typeof payload.clientId === "string" &&
    typeof payload.serverContent === "string" &&
    typeof payload.baseContent === "string" &&
    typeof payload.buffer === "string" &&
    Array.isArray(payload.records)
  );
}
