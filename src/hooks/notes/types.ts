/**
 * Notes ledger contract types — task connvo-notes-ledger-f1 (S1).
 *
 * Types only; the ledger/hook implementation lands with the ledger milestone
 * (see docs/notes-ledger-f1/design.md §3). The server side of this contract is
 * the registered notes API (convex/notes/*) plus the additive identity /
 * watermark fields described in design.md §2:
 *   - noteOps rows carry optional clientId / clientOpId / clientSequence;
 *   - batch results echo per-op identity and failedOps carries it for failures;
 *   - getMeetingNotes accepts an optional clientId and returns headSequence
 *     (incorporated server-history watermark) and clientAcks (identity acks).
 *
 * Acknowledgement is by operation identity only — never by matching text.
 */

import type { Id } from "@convex/_generated/dataModel";

/** Server-shaped note operation (NoteV.operation). */
export interface NotesOperation {
  type: "insert" | "delete" | "retain";
  position: number;
  content?: string;
  length?: number;
}

/**
 * Shape returned by api.notes.mutations.batchApplyNoteOperations, including
 * the additive per-op identity echo (`clientOpId` / `clientSequence` /
 * `deduped`) and `failedOps`. Legacy fields are unchanged.
 */
export interface BatchApplyNoteOperationsResponse {
  success: boolean;
  processed: number;
  failed: number;
  results: Array<{
    serverSequence: number;
    transformedOperation: NotesOperation;
    conflicts: string[];
    clientOpId?: string;
    clientSequence?: number;
    /** True when the server had already applied this clientOpId (idempotent resend). */
    deduped?: boolean;
  }>;
  newVersion: number;
  failedOps?: Array<{
    index: number;
    clientOpId?: string;
    clientSequence?: number;
    reason?: string;
  }>;
}

/**
 * Additive snapshot consumed by the ledger from
 * api.notes.queries.getMeetingNotes when a clientId is supplied.
 */
export interface NotesServerSnapshot {
  content: string;
  version: number;
  /** Max applied noteOps server sequence (0 when none) — the history watermark W. */
  headSequence: number;
  /** Identity acks for this client (≤100 most recent applied ops, asc by sequence). */
  clientAcks: Array<{
    clientOpId: string;
    clientSequence: number;
    serverSequence: number;
    appliedAt: number;
  }>;
}

/** One entry of an outgoing batch. */
export interface NotesBatchOp {
  operation: NotesOperation;
  /** Incorporated server-history watermark at op creation (OT basis for the server). */
  clientSequence: number;
  /** Stable per-op identity — the server's dedupe key and the ack's join key. */
  clientOpId: string;
}

/**
 * Transport seam in front of the registered notes API. Production wiring uses
 * the Convex React client; tests inject a fault-injecting transport that fronts
 * a convex-test backend (docs/notes-ledger-f1/design.md §5).
 */
export interface NotesTransport {
  /**
   * Subscribe to server snapshots. Snapshots may repeat or arrive out of
   * order; the ledger ingests them monotonically (never regresses on stale
   * results, never drops pending work on loading/undefined).
   */
  subscribe(
    meetingId: Id<"meetings">,
    clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): () => void;
  /** Send one batch; resolves with the registered response, rejects on failure. */
  applyBatch(
    meetingId: Id<"meetings">,
    clientId: string,
    batch: { operations: NotesBatchOp[]; expectedVersion?: number },
  ): Promise<BatchApplyNoteOperationsResponse>;
  /**
   * Optional: report whether the connection to the server is up. A transport
   * whose client queues writes while disconnected (Convex does) never fails a
   * send, so without this the ledger could only say "saving" through an
   * outage. Called with the current state on subscribe, then on each change.
   */
  subscribeConnection?(onChange: (online: boolean) => void): () => void;
  close(): void;
}

/** Honest aggregate sync state derived from ledger truth. */
export type NotesLedgerStatus =
  | "loading"
  | "synced"
  | "saving"
  | "unconfirmed"
  | "conflict"
  | "offline"
  | "updating";

/**
 * Pinned public hook API for the notes ledger (design.md §3).
 * MeetingNotesPanel (M3) codes against exactly this surface.
 */
export interface UseNotesLedgerResult {
  /** Composed view: server truth of the record base + unacked sibling ops. */
  content: string;
  /** Ingested server version. */
  version: number;
  isLoading: boolean;
  status: NotesLedgerStatus;
  unconfirmedCount: number;
  /** Unsaved work the user can still see (their words are never hidden). */
  unsavedRecords: ReadonlyArray<{
    clientOpId: string;
    state: "pending" | "sending" | "unconfirmed" | "rejected" | "conflict";
    content: string;
    attempts: number;
  }>;
  /**
   * Words waiting in the edit buffer because a diff over the current
   * composed view would be coordinate-unsound (live records make it
   * speculative). Display-only: rendered as the unsaved list's "Unsent"
   * row. Empty once records exist for every buffered word.
   */
  bufferedContent: string;
  isEditing: boolean;
  /** Call on every textarea change; debounces a flush internally. */
  onEdit(text: string): void;
  /** Immediate flush (blur/unmount). */
  flushNow(): void;
  /** Recompute conflicted/rejected ops against fresh server truth. */
  retryConflicts(): void;
  transportOnline: boolean;
}
