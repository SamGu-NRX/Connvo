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
import {
  applyBatchOps,
  applyOperations,
  diffToHunks,
  transformHunksToSiblingOps,
} from "./notesDiff";
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
  /**
   * How long a sent batch may stay unsettled before its records flip
   * VISIBLY to "unconfirmed" and the batch slot is released so later edits
   * can send. 0 (the default) disables the deadline.
   */
  sendTimeoutMs?: number;
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
  /** Older payloads omit this; restore reconstructs it when absent. */
  bufferBasis?: string | null;
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
  private readonly sendTimeoutMs: number;
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
  /** The composed view the buffered words were typed against (null when the
   * buffer holds nothing unsent). A remote snapshot landing mid-debounce
   * moves the base; the flush must diff the LOCAL edit from THIS basis and
   * transform it against the drift — diffing from the moved base instead
   * would express the local edit as "delete the remote words" (the
   * lost-remote-words defect). */
  private bufferBasis: string | null = null;
  private awaitingAdoptionVersion: number | null = null;
  private batchInFlight = false;
  private flushRequested = false;
  private transport: NotesTransport | null = null;
  private unsubscribeTransport: (() => void) | undefined;
  private unsubscribeConnection: (() => void) | undefined;
  private transportOnline = true;
  private destroyed = true;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private sendDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotCache: UseNotesLedgerResult | undefined;
  private serverSnapshotCache: UseNotesLedgerResult | undefined;

  constructor(options: NotesLedgerOptions) {
    this.meetingId = options.meetingId;
    this.clientId = options.clientId;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.sendTimeoutMs = options.sendTimeoutMs ?? 0;
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

  /**
   * Server-safe snapshot for React hydration (useSyncExternalStore's third
   * argument): deterministic, recovery-free — restored pending work or a
   * recovery buffer must never leak into the SERVER render, or the
   * client's first render would mismatch the HTML. Recovery still applies:
   * after hydration React switches to getSnapshot, and start()'s recovery
   * flush runs on mount.
   */
  getServerSnapshot = (): UseNotesLedgerResult => {
    if (this.serverSnapshotCache === undefined) {
      this.serverSnapshotCache = {
        content: "",
        version: -1,
        isLoading: true,
        status: "loading",
        unconfirmedCount: 0,
        unsavedRecords: [],
        bufferedContent: "",
        isEditing: false,
        onEdit: this.onEdit,
        flushNow: this.flushNow,
        retryConflicts: this.retryConflicts,
        transportOnline: true,
      };
    }
    return this.serverSnapshotCache;
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
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = transport.subscribeConnection?.(
      this.onConnection,
    );
    // Restored pending work (or a buffer ahead of its base) must flush even
    // when the meeting has no notes row yet — the query returns null until
    // the first batch, so waiting for a defined ingest would deadlock the
    // recovery. The bootstrap flush diffs from empty content; a later fresh
    // read reconciles.
    // bufferHoldsUnsentWords covers the unmount-inside-in-flight-batch case:
    // destroy() kept those words in the buffer (flushRequested is not
    // persisted, and in-flight records restore as unconfirmed, not pending),
    // so without this check they would strand until the next keystroke.
    if (
      this.flushRequested ||
      this.bufferHoldsUnsentWords ||
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
    // Only words the user typed and nobody has sent are unsent. When the
    // buffer holds none, it is just the last text typed, and the composed
    // view may have moved past it (a remote snapshot, or a sent record):
    // treating that gap as unsent words would turn it into a delete of the
    // other person's text on the next flush.
    if (this.bufferHoldsUnsentWords && this.buffer !== composed) {
      if ([...this.records.values()].some(isUnsaved)) {
        // Words stay buffered: with live records the composed view is
        // speculative, and ops diffed over it would carry effects above
        // their stamped clientSequence — the server would re-transform
        // them. The remount re-diffs from acked truth after resolution.
        if (!this.bufferHoldsUnsentWords) this.bufferBasis = composed;
        this.bufferHoldsUnsentWords = true;
      } else if (
        [...this.records.values()].some(
          (record) =>
            record.state === "saved" &&
            record.serverSequence !== undefined &&
            record.serverSequence > this.headSequence,
        )
      ) {
        // Same absorption guard as the flush path: the composed view is
        // ahead of the last incorporated read. Keep the words buffered;
        // the remount's first ingest rebases and its requested flush
        // converts from acked truth.
        if (!this.bufferHoldsUnsentWords) this.bufferBasis = composed;
        this.bufferHoldsUnsentWords = true;
      } else {
        this.rebaseIfSafe();
        const ops = this.convertBufferToOps(this.composedText());
        if (ops.length > 0) {
          this.createRecords(ops);
        }
        this.bufferHoldsUnsentWords = false;
        this.bufferBasis = null;
      }
    }
    this.persist();
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = undefined;
    this.transport = null;
  }

  /** The transport's connection state: offline holds sends; online runs them. */
  private onConnection = (online: boolean): void => {
    if (this.destroyed || online === this.transportOnline) return;
    this.transportOnline = online;
    if (online) this.runRequestedFlush();
    this.commit();
  };

  /** Call on every textarea change; debounces a flush internally. */
  onEdit = (text: string): void => {
    if (this.destroyed) return;
    // Capture the divergence basis: when the buffer was clean, the textarea
    // displayed the composed view, so the user's edit applies to exactly
    // that text. Later remote snapshots move the base; the local edit keeps
    // THIS basis and the flush transforms it against the drift.
    if (!this.bufferHoldsUnsentWords) this.bufferBasis = this.composedText();
    this.buffer = text;
    // Only "unsent" when the buffer differs from the composed view — a
    // no-op edit must not latch the updating state forever.
    this.bufferHoldsUnsentWords = text !== this.composedText();
    if (!this.bufferHoldsUnsentWords) this.bufferBasis = null;
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
    // Basis for the buffered words: the composed view WITHOUT the
    // conflicted records' effects. Always recapture — the buffer may
    // already hold user words typed on top of the refused effects, and
    // those effects must leave the basis together with the records
    // (otherwise the flush's transform would delete the refused words
    // from the server truth instead of re-sending them).
    const conflictedIds = new Set(
      conflicted.map((record) => record.clientOpId),
    );
    this.bufferBasis = applyOperations(
      this.baseContent,
      [...this.records.values()]
        .filter((record) => !conflictedIds.has(record.clientOpId))
        .map((record) => record.op),
    );
    if (!this.bufferHoldsUnsentWords) {
      this.buffer = this.composedText();
      this.bufferHoldsUnsentWords = true;
    }
    for (const record of conflicted) {
      this.records.delete(record.clientOpId);
    }
    this.rebaseIfSafe();
    if ([...this.records.values()].some(isUnsaved)) {
      // Other live records remain: their effects are speculative, so the
      // re-diff must wait until they resolve and the base rebases. The
      // words stay buffered (they include the conflicted ops' effects).
      this.flushRequested = true;
      this.commit();
      return;
    }
    // The flush's diff branch re-diffs from the captured basis and
    // transforms against the drift — including the ops that conflicted —
    // so retried words can never overwrite remote additions. It also
    // clears the buffer flags when it hands the words to records (or the
    // drift already carries them), mirroring the keystroke path.
    this.flushRequested = true;
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
      if (this.retireFromAcks(snapshot)) this.batchInFlight = false;
      this.demoteUnconfirmedWithoutAcks(snapshot);
      this.runRequestedFlush();
      return;
    }
    if (snapshot.version <= this.serverVersion) return; // stale — never rewind

    this.mergeAcks(snapshot);
    if (this.retireFromAcks(snapshot)) this.batchInFlight = false;
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

  /** Retire records on per-op identity evidence from the server acks.
   * Returns true when a SENDING record was retired: the in-flight batch's
   * response is then known-lost (a read, not the response, delivered the
   * acknowledgement), so the caller releases the batch slot — otherwise a
   * response that never settles would block every later flush forever. */
  private retireFromAcks(snapshot: NotesServerSnapshot): boolean {
    let retiredInFlight = false;
    for (const ack of snapshot.clientAcks) {
      if (typeof ack?.clientOpId !== "string") continue;
      const record = this.records.get(ack.clientOpId);
      if (!record || record.state === "saved") continue;
      if (record.state === "sending") retiredInFlight = true;
      record.state = "saved";
      record.serverSequence = ack.serverSequence;
      record.failureReason = undefined;
    }
    return retiredInFlight;
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
    const live = [...this.records.values()].filter(isUnsaved);
    const stale = live.filter(
      (record) =>
        record.state === "pending" &&
        record.attempts === 0 &&
        record.clientSequence < snapshot.headSequence,
    );
    if (stale.length === 0) return;
    if (stale.length !== live.length) {
      // Other live records were positioned using the stale ops' effects:
      // dropping the stale records would misposition them in the composed
      // fold (an out-of-range apply). Keep everything — the resend path
      // re-sends the never-sent ops under their own ids and the server
      // transforms them against the newer history.
      return;
    }
    // Basis for the buffered words: the composed view WITHOUT the stale
    // records' effects (here: the bare base — the stale records are the
    // only live ones). Always recapture: the buffer may already hold user
    // words typed on top of the stale effects, and those effects must
    // leave the basis together with the records.
    this.bufferBasis = this.baseContent;
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
    // A diff over the composed view is only sound when every record is
    // saved — then the coordinates are relative to acked server truth and
    // the op's clientSequence stamps exactly the state those coordinates
    // assume. With unsaved records the composed view is speculative: its
    // effects sit ABOVE the clientSequence a new op would stamp, so the
    // server would transform the new ops against them and double-apply
    // their shifts. Keep the words buffered; the resolution ingest rebases
    // and the requested flush re-diffs from acked truth.
    if ([...this.records.values()].some(isUnsaved)) {
      this.flushRequested = true;
      return;
    }
    // Saved-but-unabsorbed records (retired by a settle or ack whose
    // follow-up read has not landed) still sit between baseContent and
    // the composed view: a diff over the composed view would carry their
    // effects above the stamped clientSequence, and the server would
    // re-transform against them (observed: two batches sharing one
    // clientSequence). Absorb them first — but only onto a read that has
    // actually incorporated their server sequences; otherwise hold the
    // words for the next ingest, which rebases and re-fires this flush.
    const unabsorbed = [...this.records.values()].some(
      (record) =>
        record.state === "saved" &&
        record.serverSequence !== undefined &&
        record.serverSequence > this.headSequence,
    );
    if (unabsorbed) {
      this.flushRequested = true;
      return;
    }
    this.rebaseIfSafe();
    // Bootstrap/keystroke path: diff the buffer from the current base. With
    // no base yet (a meeting with no notes row), the diff runs from empty
    // content and the first batch creates the row server-side.
    const composed = this.composedText();
    if (this.bufferHoldsUnsentWords && this.buffer === composed) {
      // The drift resolved in the buffer's favor (a remote snapshot already
      // carries the buffered words): nothing to send, nothing unsent.
      this.bufferHoldsUnsentWords = false;
      this.bufferBasis = null;
    }
    if (this.bufferHoldsUnsentWords && this.buffer !== composed) {
      // Shared basis-frame conversion: diff the local edit from its
      // ORIGINAL basis and transform it as whole hunks against everything
      // that moved since — a remote snapshot that landed mid-debounce
      // included. Diffing from the moved base instead would express the
      // local edit as "delete the remote words" and lose them.
      const ops = this.convertBufferToOps(composed);
      if (ops.length > 0) {
        const created = this.createRecords(ops);
        this.bufferHoldsUnsentWords = false;
        this.bufferBasis = null;
        this.sendBatch(created);
        return;
      }
    }
    this.flushRequested = false;
  }

  /**
   * Shared basis-frame conversion for flush and teardown: diff the buffered
   * edit from its ORIGINAL basis and transform the resulting hunks as ONE
   * unit against the drift between that basis and the current composed
   * view. Both callers share this so a teardown inside a drifted window
   * persists exactly the edit a flush would have sent (the S1/S3 shapes),
   * and a replacement transforms without its sibling pair splitting (S2).
   */
  private convertBufferToOps(composed: string): NotesOperation[] {
    if (!this.bufferHoldsUnsentWords || this.buffer === composed) return [];
    const basis = this.bufferBasis ?? composed;
    // Remote representation: the MULTI-HUNK decomposition of the drift,
    // never the collapsed sibling diff — a collapse degenerates into a
    // whole-text substitution (no common affixes) and the transform basis
    // is destroyed (the S2 shape). Decomposing the drift hunks without
    // remote drift yields exactly the real remote operations.
    const remoteOps = transformHunksToSiblingOps(
      diffToHunks(basis, composed),
      [],
    );
    const raw = transformHunksToSiblingOps(
      diffToHunks(basis, this.buffer),
      remoteOps,
    );
    // The drift transform can overshoot the composed frame when remote ops
    // and local hunks interleave at the text's end; a position beyond the
    // stamp frame is illegal for the server and produced the rejected
    // insert(10) on an 8-char document (seed 20261011 path 4). Clamp to
    // the composed frame — the words land at the frame's edge.
    const docLen = composed.length;
    const ops = raw
      .map((op) => {
        const position = Math.min(Math.max(op.position, 0), docLen);
        if (op.type === "insert") return { ...op, position };
        return {
          ...op,
          position,
          length: Math.min(op.length ?? 0, docLen - position),
        };
      })
      .filter((op) =>
        op.type === "insert" ? (op.content ?? "") !== "" : (op.length ?? 0) > 0,
      );
    return ops;
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
    this.armSendDeadline(batch);
  }

  /**
   * Arm the honest-state deadline for an in-flight batch: records still
   * "sending" when it fires flip VISIBLY to "unconfirmed" (the client
   * cannot prove the server incorporated them) and the batch slot is
   * released so later edits are not blocked on a response that may never
   * settle. A late response still resolves — its identity echo retires the
   * records (never a downgrade), and a late rejection still marks them.
   */
  private armSendDeadline(batch: NotesLedgerRecord[]): void {
    if (this.sendTimeoutMs <= 0) return;
    this.clearSendDeadline();
    this.sendDeadlineTimer = setTimeout(() => {
      this.sendDeadlineTimer = undefined;
      let flipped = false;
      for (const record of batch) {
        if (record.state !== "sending") continue;
        record.state = "unconfirmed";
        record.failureReason = "send deadline exceeded without a confirmation";
        flipped = true;
      }
      if (flipped) {
        this.batchInFlight = false;
        this.commit();
      }
    }, this.sendTimeoutMs);
  }

  private clearSendDeadline(): void {
    if (this.sendDeadlineTimer !== undefined) {
      clearTimeout(this.sendDeadlineTimer);
      this.sendDeadlineTimer = undefined;
    }
  }

  private onBatchSettled(
    response: BatchApplyNoteOperationsResponse,
    batch: NotesLedgerRecord[],
  ): void {
    this.clearSendDeadline();
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
      // A fresh read may have retired this record first (a lost response
      // whose acknowledgement arrived by identity): never downgrade it.
      if (record.state === "saved") continue;
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
    this.clearSendDeadline();
    this.batchInFlight = false;
    const failure = describeError(error);
    switch (classifyTransportError(error)) {
      case "conflict":
      case "forbidden": {
        // A definite server answer — the ops were seen and refused. The
        // records stay for the conflict surface; retryConflicts re-diffs.
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
    // Mirror the server's batch application. The absorption guards in
    // flush()/destroy() ensure the map holds at most ONE batch's records:
    // a new batch is only created after the base has absorbed every
    // earlier record. Each op of that batch shares one clientSequence
    // frame, so — exactly like the server — each transforms against the
    // applied transformed forms of its earlier siblings before applying.
    let doc = this.baseContent;
    const ops: NotesOperation[] = [];
    for (const record of this.records.values()) {
      // Mirror every op that still fits the base frame — including refused
      // ones: a transport-level refusal (conflict/rejected from a bounced
      // batch) must keep the user's words visible until retryConflicts
      // re-diffs them. An op whose frame no longer fits (the base moved
      // under a refused op) cannot be applied without throwing; its words
      // surface through the conflict records and the explicit retry.
      const op = record.op;
      const fits =
        op.type === "insert"
          ? op.position >= 0 && op.position <= doc.length
          : op.position >= 0 && op.position + (op.length ?? 0) <= doc.length;
      if (fits) ops.push(op);
    }
    if (ops.length > 0) doc = applyBatchOps(doc, ops);
    return doc;
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
    const composedNow = this.composedText();
    return {
      content: composedNow,
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
      // Words waiting in the buffer because creating records over the
      // composed view would stamp speculative coordinates (the guards in
      // flush()/destroy()). Display-only: the "Unsent" row keeps the
      // loss-proof promise (every not-yet-confirmed word stays visible
      // with a state label) without sending a coordinate-unsound op.
      bufferedContent:
        this.bufferHoldsUnsentWords && this.buffer !== composedNow
          ? diffToHunks(composedNow, this.buffer)
              .map((hunk) => hunk.inserted)
              .join("")
          : "",
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
      bufferBasis: this.bufferBasis,
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
    // The basis persists with the buffer; for older payloads without it,
    // the composed view of the restored records is the best available
    // reconstruction (the words were typed against that view unless a
    // remote snapshot landed — which the flush's transform then absorbs).
    this.bufferBasis =
      typeof payload.bufferBasis === "string"
        ? payload.bufferBasis
        : payload.bufferHoldsUnsentWords
          ? this.composedText()
          : null;
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
