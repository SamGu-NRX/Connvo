/**
 * Client-side operation ledger for collaborative notes.
 *
 * WHY THIS EXISTS: the Convex server dedupes NOTHING by operationId — the
 * `by_queue_and_operation` index (convex/schema/offline.ts:40) is queried by
 * no code, and every accepted operation is applied. The ledger here is the
 * ONLY dedupe that will ever exist. It is a per-meeting, framework-agnostic
 * external store so it outlives React instances and survives render
 * contexts (the witness harness renders through react-dom/server, where
 * effects never run).
 *
 * States (canonical, exposed to components via useCollaborativeNotes):
 * - pending:     accepted locally, not yet sent (offline queue).
 * - syncing:     sent, awaiting the server ack.
 * - saved:       server confirmed (response or reconcile). Never re-sent.
 * - rejected:    definite domain rejection (e.g. FORBIDDEN after removal).
 *                The document rolls back to last server-confirmed content;
 *                the user's words stay visible in the record.
 * - conflict:    CONFLICT from expectedVersion mismatch.
 * - unconfirmed: the outcome is unknowable (ack/request lost mid-flight).
 *                Surfaced explicitly — never blind-resend an op the ledger
 *                shows as saved, and never silently drop unconfirmed work.
 *
 * Pure functions only; no React imports.
 */

export type NoteOperationState =
  | "pending"
  | "syncing"
  | "saved"
  | "rejected"
  | "conflict"
  | "unconfirmed";

export interface FailureDetail {
  code: string;
  message: string;
}

export interface NoteOperationInput {
  type: "insert" | "delete" | "retain";
  position?: number;
  /** Legacy field name from the old hook; normalized to `content`. */
  text?: string;
  /** Server-shaped field (convex/schema/offline.ts uses `content`). */
  content?: string;
  length?: number;
}

/** Server-shaped operation sent to batchApplyNoteOperations. */
export interface NormalizedNoteOperation {
  type: "insert" | "delete" | "retain";
  /** Required — the server validator demands a numeric position
   * (convex/notes/mutations.ts operationValidator). */
  position: number;
  content?: string;
  length?: number;
}

export interface NoteOperationRecord {
  /** Ledger key: the operationId, with a generation suffix only when the
   * same deterministic id was re-submitted after a terminal outcome. */
  ledgerKey: string;
  /** Deterministic uuid: same logical edit, same id (dedupe on duplicate
   * submission, on late responses, and across generations). */
  operationId: string;
  operation: NormalizedNoteOperation;
  /** The content the user typed — preserved even when rejected. */
  content: string;
  /** Monotonic per-meeting client sequence for batch ordering. */
  clientSequence: number;
  state: NoteOperationState;
  inFlight: boolean;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  savedAtVersion?: number;
  /** Version this op was sent with (diagnostics for conflict analysis). */
  sentWithExpectedVersion?: number;
  error?: FailureDetail;
  /** Late/duplicate acks observed for this op (state unchanged). */
  duplicateAcks: number;
}

export interface LedgerSnapshot {
  /** Keyed by ledgerKey. */
  records: Map<string, NoteOperationRecord>;
  /** Freshest server version the ledger knows about. */
  knownServerVersion: number;
  /** Monotonic count of late/duplicate acks observed (whole ledger). */
  duplicateAcknowledgementCount: number;
  /** Bumped on every notify — lets useSyncExternalStore depend on a
   * primitive instead of Map identity. */
  revision: number;
}

export interface BatchApplyNoteOperationsResponse {
  success: boolean;
  processed: number;
  failed: number;
  results: Array<{
    serverSequence: number;
    transformedOperation: NormalizedNoteOperation;
    conflicts: string[];
  }>;
  newVersion: number;
}

export interface NotesQuerySnapshot {
  content: string;
  version: number;
  /** Client sequences the server has actually accepted (fake-transport
   * bridge; absent in production, where reconcile degrades to version
   * semantics). */
  acceptedClientSequences?: number[];
}

export interface ReconcileReport {
  /** Ops confirmed saved from reconcile (never re-sent afterwards). */
  confirmedIds: string[];
  /** Ops re-sent with their ORIGINAL operationId/clientSequence. */
  reSentIds: string[];
  /** Ops still owned by an in-flight send (left alone, not re-sent). */
  leftInFlightIds: string[];
  /** Ops whose server outcome is unknowable (ack lost, effect not
   * identifiable) — explicitly unconfirmed and surfaced, never re-sent. */
  unconfirmedIds: string[];
  duplicateAcknowledgementCount: number;
  serverVersion: number;
  serverContent: string;
}

/** Thrown by applyOperation/applyOperations when the server (or transport)
 * rejects an edit; carries the ledger keys that remain unsaved so callers
 * and components can render the exact unsaved state. The edit's words stay
 * in the ledger record — nothing is silently discarded. */
export class NoteOperationsRejectedError extends Error {
  readonly code: string;
  readonly unsavedOperationIds: string[];
  readonly failures: Array<{
    ledgerKey: string;
    code: string;
    message: string;
  }>;

  constructor(
    message: string,
    options: {
      code: string;
      unsavedOperationIds: string[];
      failures: Array<{ ledgerKey: string; code: string; message: string }>;
    }
  ) {
    super(message);
    this.name = "NoteOperationsRejectedError";
    this.code = options.code;
    this.unsavedOperationIds = options.unsavedOperationIds;
    this.failures = options.failures;
  }
}

/** Normalize a client operation into the server shape: legacy `text` becomes
 * `content` (convex/schema/offline.ts — the server field is `content`),
 * absent fields are dropped. Pure. */
export function normalizeOperation(
  operation: NoteOperationInput,
  documentLength = 0
): NormalizedNoteOperation {
  const normalized: NormalizedNoteOperation = {
    type: operation.type,
    // An edit without an explicit position appends at the end of the
    // composed document.
    position: operation.position ?? documentLength,
  };
  const content = operation.content ?? operation.text;
  if (content !== undefined) normalized.content = content;
  if (operation.length !== undefined) normalized.length = operation.length;
  return normalized;
}

/** Deterministic uuid v5 for (meetingId, operation): identical logical edits
 * map to the same operationId — the ledger's dedupe identity. RFC-4122
 * variant bits set. Pure. */
export function deterministicOperationId(
  meetingId: string,
  operation: NormalizedNoteOperation
): string {
  const canonical = JSON.stringify([meetingId, operation]);
  let h1 = 0x9e3779b9 ^ canonical.length;
  let h2 = 0x85ebca6b;
  for (let i = 0; i < canonical.length; i += 1) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0xc2b2ae35) >>> 0;
    h1 = (h1 ^ (h1 >>> 13)) >>> 0;
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  const hex = h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  return `00000000-0000-5000-8000-${hex}00000000`;
}

/** Compose the visible document: the last server-confirmed content with
 * every unsaved-but-not-rolled-back edit optimistically applied on top in
 * clientSequence order. Rejected/conflict edits are NOT part of the
 * document — their words live in the ledger records. Pure. */
export function composeContent(
  serverContent: string,
  records: NoteOperationRecord[],
  serverVersion: number
): string {
  let content = serverContent;
  for (const record of records) {
    if (!isOptimisticallyApplied(record, serverVersion)) continue;
    const op = record.operation;
    if (op.type === "insert") {
      const position = op.position ?? content.length;
      const head = content.slice(0, position);
      const tail = content.slice(position);
      content = head + (op.content ?? "") + tail;
    } else if (op.type === "delete") {
      const position = op.position ?? content.length;
      const length = op.length ?? 0;
      content = content.slice(0, position) + content.slice(position + length);
    }
    // retain: no change
  }
  return content;
}

/** Whether the record's edit is part of the optimistic document — i.e.
 * whether the server snapshot this composition starts from predates the
 * op's effect. Once the server version reaches the op's own effect
 * (savedAtVersion for saved ops; the send-time version for syncing and
 * unconfirmed ops, which the server applies before acking), the effect
 * is already IN the server content and re-applying it would double it.
 * Rejected/conflict edits are never composed — their words live in the
 * ledger records. Pure. */
function isOptimisticallyApplied(
  record: NoteOperationRecord,
  serverVersion: number
): boolean {
  if (record.state === "saved") {
    return serverVersion < (record.savedAtVersion ?? 0);
  }
  if (record.state === "rejected" || record.state === "conflict") return false;
  if (record.state === "syncing" || record.state === "unconfirmed") {
    // While the server has not moved past the version this op was sent
    // with, the op cannot be in the server content (applying it would
    // have bumped the version) — keep it composed so the user's words
    // stay visible. Once the server moved, the document follows server
    // truth; the reconcile evidence check then confirms or re-sends.
    return serverVersion <= (record.sentWithExpectedVersion ?? 0);
  }
  return true;
}

/** Classify a Convex mutation failure from its error shape. The fake
 * transport throws { errorCode, message }; Convex throws Error with
 * { data: { code } }. Pure. */
export function describeMutationError(err: unknown): FailureDetail {
  const anyErr = err as
    | { errorCode?: unknown; message?: unknown; data?: { code?: unknown; message?: unknown } }
    | undefined;
  const dataCode =
    anyErr && typeof anyErr === "object" && anyErr.data && typeof anyErr.data === "object"
      ? (anyErr.data as { code?: unknown }).code
      : undefined;
  const dataMessage =
    anyErr && typeof anyErr === "object" && anyErr.data && typeof anyErr.data === "object"
      ? (anyErr.data as { message?: unknown }).message
      : undefined;
  const code =
    (typeof dataCode === "string" && dataCode) ||
    (typeof anyErr?.errorCode === "string" && anyErr.errorCode) ||
    "UNKNOWN";
  const message =
    (typeof dataMessage === "string" && dataMessage) ||
    (typeof anyErr?.message === "string" ? anyErr.message : String(err));
  return { code, message };
}

/** Whether a failure code means the edit did NOT reach the document (as
 * opposed to an ambiguous transport failure). Pure. */
export function isDefiniteRejectionCode(code: string): boolean {
  return code === "FORBIDDEN" || code === "CONFLICT";
}

/** Reconcile evidence for an unconfirmed op (ack lost mid-flight), read
 * from the server document (content + version) — the ONLY channels the
 * real contract provides (getMeetingNotes returns content/version only).
 * Pure.
 * - "applied": the server version moved past the version the op was sent
 *   with AND the op's effect is identifiable in the server content. The
 *   op is confirmed saved from reconcile and NEVER re-sent (the server
 *   dedupes nothing — a re-send would double-apply).
 * - "not-applied": the server is still at the exact version the op was
 *   sent with, so nothing was applied; the op is safe to re-send.
 * - "unknowable": the version moved but the effect is not identifiable
 *   (another writer's op, or a delete whose text is not recoverable).
 *   The op stays explicitly unconfirmed and is surfaced — never
 *   blind-resend an op the server may have applied. */
export function serverHasOperationEvidence(
  serverContent: string,
  operation: NormalizedNoteOperation,
  sentWithExpectedVersion: number | undefined,
  serverVersion: number
): "applied" | "not-applied" | "unknowable" {
  if (sentWithExpectedVersion === undefined) return "unknowable";
  if (serverVersion === sentWithExpectedVersion) return "not-applied";
  if (
    serverVersion > sentWithExpectedVersion &&
    operation.type === "insert" &&
    operation.content
  ) {
    if (serverContent.includes(operation.content)) return "applied";
  }
  return "unknowable";
}

const LEDGERS = new Map<string, NotesOperationLedger>();

/** Per-meeting ledger accessor — module-level so it outlives React. */
export function getNotesOperationLedger(meetingId: string): NotesOperationLedger {
  let ledger = LEDGERS.get(meetingId);
  if (!ledger) {
    ledger = new NotesOperationLedger(meetingId);
    LEDGERS.set(meetingId, ledger);
  }
  return ledger;
}

/** Test isolation: drop a meeting's ledger (NOT used in production code
 * paths — witnesses call this between scenarios). */
export function resetNotesOperationLedger(meetingId: string): void {
  LEDGERS.delete(meetingId);
}

/** Pure helper: ledger keys that are NOT server-confirmed. */
export function unsavedKeys(records: NoteOperationRecord[]): string[] {
  return records.filter((r) => r.state !== "saved").map((r) => r.ledgerKey);
}

/**
 * The per-meeting operation ledger: an external store (subscribe /
 * getSnapshot) so the hook can read it through useSyncExternalStore.
 */
export class NotesOperationLedger {
  private meetingId: string;
  private recordsMap = new Map<string, NoteOperationRecord>();
  private listeners = new Set<() => void>();
  private revisionCounter = 0;
  private knownServerVersionValue = 0;
  private duplicateAckCount = 0;
  private clientSequenceCounter = 0;
  /** Outcome promise per ledger key (batch outcome shared by the batch). */
  private outcomePromises = new Map<string, { promise: Promise<void> }>();
  /** Ops sent before the current batch whose ack has not settled — used to
   * correct the expected version for queued batches. */
  private unsettledDepth = 0;

  constructor(meetingId: string) {
    this.meetingId = meetingId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LedgerSnapshot => {
    return {
      records: this.recordsMap,
      knownServerVersion: this.knownServerVersionValue,
      duplicateAcknowledgementCount: this.duplicateAckCount,
      revision: this.revisionCounter,
    };
  };

  get meetingKey(): string {
    return this.meetingId;
  }

  get knownVersion(): number {
    return this.knownServerVersionValue;
  }

  get duplicateCount(): number {
    return this.duplicateAckCount;
  }

  get unsettledDepthCount(): number {
    return this.unsettledDepth;
  }

  private notify(): void {
    this.revisionCounter += 1;
    for (const listener of this.listeners) listener();
  }

  /** Monotonic ingest of the freshest query version. A version BELOW the
   * known one means a new document lineage: reset the ledger (a fresh
   * meeting/document must not inherit stale ops). */
  ingestQuerySnapshot(version: number): void {
    if (version < this.knownServerVersionValue) {
      this.recordsMap.clear();
      this.outcomePromises.clear();
      this.unsettledDepth = 0;
      this.clientSequenceCounter = 0;
    }
    // The freshest snapshot is authoritative in every case: bump forward on
    // progress, and adopt the lower version outright on a lineage reset —
    // otherwise expectedVersion would be built from a stale, higher version
    // and every batch would CONFLICT against the new document.
    this.knownServerVersionValue = version;
  }

  /**
   * Submit an edit to the ledger.
   * - Identical unresolved edit: coalesced — the ORIGINAL record is kept,
   *   no second send (the server would apply it twice).
   * - Identical edit whose record is terminal (saved/rejected/conflict):
   *   a NEW generation with a suffixed ledger key; the same operationId
   *   links late responses to the right lineage.
   */
  submit(
    operationId: string,
    operation: NormalizedNoteOperation
  ): { ledgerKey: string; clientSequence: number; coalesced: boolean } {
    const existing = this.recordsMap.get(operationId);
    if (
      existing &&
      existing.state !== "saved" &&
      existing.state !== "rejected" &&
      existing.state !== "conflict"
    ) {
      return {
        ledgerKey: existing.ledgerKey,
        clientSequence: existing.clientSequence,
        coalesced: true,
      };
    }
    if (existing) {
      let generation = 2;
      while (this.recordsMap.has(`${operationId}#g${generation}`)) generation += 1;
      const ledgerKey = `${operationId}#g${generation}`;
      const record = this.newRecord(operationId, ledgerKey, operation);
      this.recordsMap.set(ledgerKey, record);
      this.notify();
      return { ledgerKey, clientSequence: record.clientSequence, coalesced: false };
    }
    const record = this.newRecord(operationId, operationId, operation);
    this.recordsMap.set(operationId, record);
    this.notify();
    return { ledgerKey: operationId, clientSequence: record.clientSequence, coalesced: false };
  }

  private newRecord(
    operationId: string,
    ledgerKey: string,
    operation: NormalizedNoteOperation
  ): NoteOperationRecord {
    this.clientSequenceCounter += 1;
    return {
      ledgerKey,
      operationId,
      operation,
      content: operation.content ?? "",
      clientSequence: this.clientSequenceCounter,
      state: "pending",
      inFlight: false,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      duplicateAcks: 0,
    };
  }

  /** Mark a batch as sent: pending → syncing, expectedVersion recorded,
   * in-flight ownership taken. */
  markSendBatch(
    entries: Array<{ ledgerKey: string }>,
    expectedVersion: number
  ): void {
    for (const { ledgerKey } of entries) {
      const record = this.recordsMap.get(ledgerKey);
      if (!record) continue;
      record.state = "syncing";
      record.inFlight = true;
      record.attempts += 1;
      record.sentWithExpectedVersion = expectedVersion;
      record.updatedAt = Date.now();
    }
    this.unsettledDepth += entries.length;
    this.notify();
  }

  /** Server confirmed the batch: syncing → saved. A second settle for an
   * already-saved op counts as a DUPLICATE ack and changes nothing
   * (observable in tests). */
  settleBatchSaved(ledgerKeys: string[], newVersion: number): void {
    let changed = false;
    for (const ledgerKey of ledgerKeys) {
      const record = this.recordsMap.get(ledgerKey);
      if (!record) continue;
      if (record.state === "saved") {
        record.duplicateAcks += 1;
        this.duplicateAckCount += 1;
        changed = true; // observable, but the state does not change
        continue;
      }
      if (record.state === "rejected" || record.state === "conflict") {
        // A late success after a definite rejection is also a duplicate
        // response; the ledger keeps the explicit human-meaningful state.
        record.duplicateAcks += 1;
        this.duplicateAckCount += 1;
        changed = true;
        continue;
      }
      record.state = "saved";
      record.savedAtVersion = newVersion;
      record.inFlight = false;
      record.updatedAt = Date.now();
      changed = true;
    }
    this.unsettledDepth = Math.max(0, this.unsettledDepth - ledgerKeys.length);
    if (newVersion > this.knownServerVersionValue) {
      this.knownServerVersionValue = newVersion;
    }
    if (changed) this.notify();
  }

  /** Server rejected the batch. FORBIDDEN/CONFLICT are definite rejections;
   * other codes mean an ambiguous send — the ledger marks them unconfirmed,
   * NOT rejected, because the server may still have applied the op.
   * Returns whether any op is genuinely unsaved. */
  settleBatchFailed(ledgerKeys: string[], failure: FailureDetail): boolean {
    const definite = isDefiniteRejectionCode(failure.code);
    let anyUnsaved = false;
    for (const ledgerKey of ledgerKeys) {
      const record = this.recordsMap.get(ledgerKey);
      if (!record) continue;
      if (record.state === "saved") {
        // A late failure after reconcile confirmed the op: duplicate
        // response, state unchanged, observable.
        record.duplicateAcks += 1;
        this.duplicateAckCount += 1;
        continue;
      }
      record.state = definite ? "rejected" : "unconfirmed";
      record.inFlight = false;
      record.updatedAt = Date.now();
      record.error = { code: failure.code, message: failure.message };
      anyUnsaved = true;
    }
    this.unsettledDepth = Math.max(0, this.unsettledDepth - ledgerKeys.length);
    this.notify();
    return anyUnsaved;
  }

  /** Reconcile confirmation: the server shows this op as accepted. Marking
   * saved from reconcile NEVER re-sends it; a later ack for the same op is
   * then a plain duplicate and changes nothing. */
  confirmFromReconcile(ledgerKey: string, serverVersion: number): void {
    const record = this.recordsMap.get(ledgerKey);
    if (!record) return;
    if (record.state === "saved") {
      record.duplicateAcks += 1;
      this.duplicateAckCount += 1;
      return;
    }
    record.state = "saved";
    record.savedAtVersion = serverVersion;
    record.inFlight = false;
    record.updatedAt = Date.now();
    record.error = undefined;
    if (serverVersion > this.knownServerVersionValue) {
      this.knownServerVersionValue = serverVersion;
    }
    this.notify();
  }

  /** Records not yet settled-saved: candidates for reconcile inspection. */
  pendingRecords(): NoteOperationRecord[] {
    return [...this.recordsMap.values()].filter((r) => r.state !== "saved");
  }

  recordsInSequenceOrder(): NoteOperationRecord[] {
    return [...this.recordsMap.values()].sort(
      (a, b) => a.clientSequence - b.clientSequence
    );
  }

  unsavedKeysAmong(ledgerKeys: string[]): string[] {
    return ledgerKeys.filter((key) => {
      const record = this.recordsMap.get(key);
      return record !== undefined && record.state !== "saved";
    });
  }

  linkOutcome(ledgerKey: string, promise: Promise<void>): void {
    this.outcomePromises.set(ledgerKey, { promise });
  }

  outcomeFor(ledgerKey: string): Promise<void> | undefined {
    return this.outcomePromises.get(ledgerKey)?.promise;
  }

  getRecord(ledgerKey: string): NoteOperationRecord | undefined {
    return this.recordsMap.get(ledgerKey);
  }
}
