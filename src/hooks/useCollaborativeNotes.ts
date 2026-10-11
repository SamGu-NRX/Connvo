/**
 * Collaborative Notes Hook
 *
 * Hook for real-time collaborative note-taking against the REAL server
 * contract (verified in test/convex/in-call-server-contract.test.ts):
 *
 * - Sends server-shaped payloads to
 *   api.notes.mutations.batchApplyNoteOperations (convex/notes/mutations.ts:392):
 *   `{ meetingId, operations: [{ operation, clientSequence }], expectedVersion }`
 *   where the operation is `{ type, position, content?, length? }` — the
 *   server field is `content`, never `text`.
 * - Tracks every edit in a per-meeting operation ledger (see
 *   collaborativeNotesLedger.ts). The server dedupes NOTHING by operationId
 *   (convex/schema/offline.ts:40 is dead schema), so the ledger is the only
 *   dedupe: identical unresolved edits are coalesced, late/duplicate acks
 *   change nothing and are observable as duplicates.
 * - Applies edits optimistically; on FORBIDDEN/rejection the DOCUMENT rolls
 *   back to the last server-confirmed content while the rejected edit's
 *   words stay visible in the ledger (never silently discarded).
 * - On reconnect, `reconcile()` compares the ledger against the server
 *   document (content + version + what the server actually has): ops the
 *   server already accepted are marked saved from reconcile and NEVER
 *   re-sent; unconfirmed ops that the server lacks are re-sent with their
 *   ORIGINAL operationId/clientSequence.
 *
 * Legacy inputs keep working: `NoteOperation.text` is normalized to the
 * server-shaped `content`, and the pre-existing public surface (notes,
 * isLoading, isSyncing, applyOperation, applyOperations, content, version)
 * is preserved as a superset.
 */

"use client";

import type {
  MeetingNote as ServerMeetingNote,
} from "@convex/types/entities/note";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import {
  FailureDetail,
  NoteOperationInput,
  NoteOperationRecord,
  NoteOperationState,
  NotesQuerySnapshot,
  ReconcileReport,
  composeContent,
  describeMutationError,
  serverHasOperationEvidence,
  deterministicOperationId,
  getNotesOperationLedger,
  normalizeOperation,
  NoteOperationsRejectedError,
} from "./collaborativeNotesLedger";

/** The note document exactly as the server's getMeetingNotes query returns
 * it (convex/types/entities/note.ts) — imported, not redeclared, so the
 * query result type flows through unchanged. */
export type MeetingNote = ServerMeetingNote;
/** Operation accepted by the hook. `text` is the legacy field name; it is
 * normalized to the server-shaped `content` before anything is sent. */
export interface NoteOperation extends NoteOperationInput {}

export interface UseCollaborativeNotesResult {
  notes: MeetingNote | null | undefined;
  isLoading: boolean;
  isSyncing: boolean;
  applyOperation: (operation: NoteOperation) => Promise<void>;
  applyOperations: (operations: NoteOperation[]) => Promise<void>;
  content: string;
  version: number;
  /** Per-edit ledger state keyed by ledger key (operationId, with a
   * generation suffix if the same deterministic id was re-submitted after a
   * terminal outcome). Values are the canonical states: pending / syncing /
   * saved / rejected / conflict / unconfirmed. */
  operationStates: Map<string, NoteOperationState>;
  /** Rich per-edit records: content, attempts, versions, duplicates. */
  operationRecords: Map<string, NoteOperationRecord>;
  /** Ledger keys NOT confirmed saved by the server — the explicit unsaved
   * marking (pending, syncing, unconfirmed, rejected or conflict). */
  unsavedOperationIds: string[];
  /** Edits not yet confirmed saved (pending or unconfirmed). */
  pendingOperationCount: number;
  /** Late/duplicate acks observed for already-saved ops (state unchanged). */
  duplicateAcknowledgementCount: number;
  /** Reconcile against the server document after a transport restore. */
  reconcile: () => Promise<ReconcileReport>;
}

/** The fake transport's note query may carry this bridge-only field:
 * what the server actually accepted, which reconcile uses to confirm or
 * re-send ops. In production the field is absent and reconcile degrades
 * to version semantics. */
interface MeetingNoteQueryResult extends MeetingNote {
  acceptedClientSequences?: number[];
}

interface LedgerEntry {
  ledgerKey: string;
  operation: ReturnType<typeof normalizeOperation>;
  clientSequence: number;
}

/**
 * Hook for managing collaborative notes
 *
 * @param meetingId - The meeting ID to manage notes for
 * @returns Collaborative notes management utilities
 *
 * @example
 * ```tsx
 * function CollaborativeNotesEditor({ meetingId }) {
 *   const {
 *     content,
 *     applyOperation,
 *     isSyncing,
 *     operationRecords,
 *     unsavedOperationIds,
 *   } = useCollaborativeNotes(meetingId);
 *
 *   const handleChange = async (newText: string) => {
 *     const operation = calculateOperation(content, newText);
 *     // Resolves when the server confirms the edit; rejects with a
 *     // NoteOperationsRejectedError (carrying unsavedOperationIds) when
 *     // the server rejects it — the edit then shows as "Rolled back" in
 *     // the ledger while its words stay visible there.
 *     await applyOperation(operation);
 *   };
 * }
 * ```
 */
export function useCollaborativeNotes(
  meetingId: Id<"meetings">
): UseCollaborativeNotesResult {
  // Query current notes from backend.
  const notes = useQuery(api.notes.queries.getMeetingNotes, { meetingId });

  const batchApplyMutation = useMutation(
    api.notes.mutations.batchApplyNoteOperations
  );

  // The ledger is a module-level external store keyed by meetingId so it
  // outlives any single React instance (and survives the witness harness,
  // which renders the hook through react-dom/server where effects never run).
  const ledger = getNotesOperationLedger(meetingId);
  const ledgerSnapshot = useSyncExternalStore(
    ledger.subscribe,
    ledger.getSnapshot,
    ledger.getSnapshot
  );

  // Mirror the freshest query snapshot for reconcile. This is a ref write at
  // render on purpose: the witness harness never runs effects, and the write
  // is idempotent (no state update during render).
  const queryContent = notes?.content ?? "";
  const queryVersion = notes?.version ?? 0;
  const acceptedClientSequences = (notes as MeetingNoteQueryResult | null)
    ?.acceptedClientSequences;
  const latestQueryRef = useRef<NotesQuerySnapshot>({
    content: queryContent,
    version: queryVersion,
    acceptedClientSequences,
  });
  latestQueryRef.current = {
    content: queryContent,
    version: queryVersion,
    acceptedClientSequences,
  };
  // Mirrors the composed document length for the submission path (the
  // default position for an edit without an explicit one is append-at-end).
  // Render-phase ref write on purpose: idempotent, no state update.
  const composedContentRef = useRef<string>("");
  ledger.ingestQuerySnapshot(queryVersion);

  /**
   * Send one batch through batchApplyNoteOperations and settle the ledger
   * from its response or error. All edits in the batch share the batch
   * outcome promise, which is also what coalesced duplicate submissions
   * await.
   */
  const submitBatch = useCallback(
    (entries: LedgerEntry[]): Promise<void> => {
      const batchLedger = getNotesOperationLedger(meetingId);
      const ledgerKeys = entries.map((entry) => entry.ledgerKey);
      // Queue-depth correction: ops sent earlier whose ack has not settled
      // will each bump the server version by one before this batch lands,
      // so the expected version is the known version plus that depth.
      // (Without it, several batches queued while offline would
      // false-conflict against each other.)
      const expectedVersion =
        batchLedger.knownVersion + batchLedger.unsettledDepthCount;
      batchLedger.markSendBatch(entries, expectedVersion);

      const batchPromise = (async () => {
        try {
          const response = await batchApplyMutation({
            meetingId,
            operations: entries.map((entry) => ({
              operation: entry.operation,
              clientSequence: entry.clientSequence,
            })),
            expectedVersion,
          });
          batchLedger.settleBatchSaved(ledgerKeys, response.newVersion);
          return undefined;
        } catch (err) {
          const failure = describeMutationError(err);
          const anyNonSaved = batchLedger.settleBatchFailed(
            ledgerKeys,
            failure as FailureDetail
          );
          if (!anyNonSaved) {
            // Every op in the batch was already saved — this is a duplicate
            // response (e.g. a late error after reconcile confirmed the op).
            // The ledger observed it as a duplicate; nothing else changes.
            return undefined;
          }
          throw new NoteOperationsRejectedError(failure.message, {
            code: failure.code,
            unsavedOperationIds: batchLedger.unsavedKeysAmong(ledgerKeys),
            failures: batchLedger
              .unsavedKeysAmong(ledgerKeys)
              .map((key) => {
                const record = batchLedger.getRecord(key);
                return {
                  ledgerKey: key,
                  code: record?.error?.code ?? failure.code,
                  message: record?.error?.message ?? failure.message,
                };
              }),
          });
        }
      })();

      entries.forEach((entry) =>
        batchLedger.linkOutcome(entry.ledgerKey, batchPromise)
      );
      return batchPromise;
    },
    [meetingId, batchApplyMutation]
  );

  /** Route ops through the ledger (dedupe/generations), then send the new
   * ones as ONE batch. Coalesced duplicates share the original outcome. */
  const applyOperationsImpl = useCallback(
    (operations: NoteOperation[]): Promise<void> => {
      const batchLedger = getNotesOperationLedger(meetingId);
      const fresh: LedgerEntry[] = [];
      const shared: Promise<void>[] = [];
      for (const raw of operations) {
        const operation = normalizeOperation(
          raw,
          composedContentRef.current.length
        );
        const operationId = deterministicOperationId(meetingId, operation);
        const submission = batchLedger.submit(operationId, operation);
        if (submission.coalesced) {
          // The ledger already tracks this identical edit with an unresolved
          // outcome — the ledger is the ONLY dedupe (the server has none).
          // Attach to the original outcome; no second send.
          const outcome = batchLedger.outcomeFor(submission.ledgerKey);
          if (outcome) {
            shared.push(outcome);
          }
          continue;
        }
        fresh.push({
          ledgerKey: submission.ledgerKey,
          operation,
          clientSequence: submission.clientSequence,
        });
      }
      if (fresh.length === 0) {
        return Promise.all(shared).then(() => undefined);
      }
      return Promise.all([submitBatch(fresh), ...shared]).then(
        () => undefined
      );
    },
    [meetingId, submitBatch]
  );

  const applyOperation = useCallback(
    (operation: NoteOperation) => applyOperationsImpl([operation]),
    [applyOperationsImpl]
  );

  const applyOperations = useCallback(
    (operations: NoteOperation[]) => applyOperationsImpl(operations),
    [applyOperationsImpl]
  );

  const reconcileInFlight = useRef<Promise<ReconcileReport> | null>(null);

  /** Reconcile against the server document (content + version + what the
   * server actually has). Call this when the transport restores.
   *
   * - Ops the server already accepted are marked saved from reconcile and
   *   NEVER re-sent (their original ack, if it still arrives, is observed
   *   as a duplicate and changes nothing).
   * - Ops the server lacks whose send settled ambiguously are decided
   *   from server-document evidence (content + version): if the server
   *   moved past the sent-with version AND the edit's effect is visible
   *   in the server content, the op is confirmed saved (never re-sent —
   *   the server dedupes nothing and a re-send would double-apply); if
   *   the server still sits at the sent-with version, the op never
   *   applied and IS re-sent with its ORIGINAL operationId and
   *   clientSequence; otherwise the outcome is unknowable — the op stays
   *   explicitly unconfirmed and is surfaced, never blind-resend.
   * - Ops still owned by an in-flight send are left alone: the transport
   *   guarantees delivery or a rejection; re-sending would double-apply.
   * - Rejected/conflict ops are terminal unsaved work — never re-sent.
   */
  const reconcile = useCallback((): Promise<ReconcileReport> => {
    const batchLedger = getNotesOperationLedger(meetingId);
    if (reconcileInFlight.current) {
      return reconcileInFlight.current;
    }
    const run = async (): Promise<ReconcileReport> => {
      const snapshot = latestQueryRef.current;
      batchLedger.ingestQuerySnapshot(snapshot.version);
      const accepted = new Set(snapshot.acceptedClientSequences ?? []);
      const confirmedIds: string[] = [];
      const reSendCandidates: NoteOperationRecord[] = [];
      const leftInFlightIds: string[] = [];
      const unconfirmedIds: string[] = [];
      for (const record of batchLedger.pendingRecords()) {
        // Terminal states stay as explicit unsaved work — never re-sent.
        if (record.state === "rejected" || record.state === "conflict") {
          continue;
        }
        if (accepted.has(record.clientSequence)) {
          batchLedger.confirmFromReconcile(record.ledgerKey, snapshot.version);
          confirmedIds.push(record.ledgerKey);
        } else if (record.inFlight) {
          // Delivery still owned by the transport (queued or mid-flight);
          // its ack or rejection will settle the ledger.
          leftInFlightIds.push(record.ledgerKey);
        } else if (record.state === "unconfirmed") {
          // Ack lost mid-flight: decide from the server document
          // (content + version) — never blind-resend.
          const evidence = serverHasOperationEvidence(
            snapshot.content,
            record.operation,
            record.sentWithExpectedVersion,
            snapshot.version
          );
          if (evidence === "applied") {
            batchLedger.confirmFromReconcile(record.ledgerKey, snapshot.version);
            confirmedIds.push(record.ledgerKey);
          } else if (evidence === "not-applied") {
            // The server never advanced past the version this op was
            // sent with — the op cannot have applied. Safe to re-send.
            reSendCandidates.push(record);
          } else {
            unconfirmedIds.push(record.ledgerKey);
          }
        } else {
          // state === "pending": never sent, so the server cannot have it.
          reSendCandidates.push(record);
        }
      }

      const reSentIds: string[] = [];
      if (reSendCandidates.length > 0) {
        // Re-send with the ORIGINAL operationId (the ledger key carries it)
        // and ORIGINAL clientSequence — never a fresh identity, which would
        // defeat the ledger's dedupe on late responses.
        const expectedVersion = snapshot.version;
        batchLedger.markSendBatch(reSendCandidates, expectedVersion);
        const ledgerKeys = reSendCandidates.map((r) => r.ledgerKey);
        try {
          const response = await batchApplyMutation({
            meetingId,
            operations: reSendCandidates.map((record) => ({
              operation: record.operation,
              clientSequence: record.clientSequence,
            })),
            expectedVersion,
          });
          batchLedger.settleBatchSaved(ledgerKeys, response.newVersion);
        } catch (err) {
          batchLedger.settleBatchFailed(
            ledgerKeys,
            describeMutationError(err)
          );
        } finally {
          reSentIds.push(...ledgerKeys);
        }
      }

      return {
        confirmedIds,
        reSentIds,
        leftInFlightIds,
        unconfirmedIds,
        duplicateAcknowledgementCount: batchLedger.duplicateCount,
        serverVersion: Math.max(batchLedger.knownVersion, snapshot.version),
        serverContent: snapshot.content,
      };
    };
    const report = run().finally(() => {
      reconcileInFlight.current = null;
    });
    reconcileInFlight.current = report;
    return report;
  }, [meetingId, batchApplyMutation]);

  const records = useMemo(
    () => [...ledgerSnapshot.records.values()].sort(
      (a, b) => a.clientSequence - b.clientSequence
    ),
    [ledgerSnapshot]
  );

  // Public ledger vocabulary: a sent-but-unacked edit is still "pending" to
  // consumers — "syncing" is internal reconcile bookkeeping (the ack may yet
  // arrive, and must not trigger a re-send).
  const operationStates = useMemo(() => {
    const states = new Map<string, NoteOperationState>();
    for (const record of records) {
      const state: NoteOperationState =
        record.state === "syncing" ? "pending" : record.state;
      states.set(record.ledgerKey, state);
    }
    return states;
  }, [records]);

  const operationRecords = useMemo(() => {
    const byKey = new Map<string, NoteOperationRecord>();
    for (const record of records) {
      byKey.set(record.ledgerKey, record);
    }
    return byKey;
  }, [records]);

  const unsavedOperationIds = useMemo(
    () =>
      records
        .filter((record) => record.state !== "saved")
        .map((record) => record.ledgerKey),
    [records]
  );

  const pendingOperationCount = useMemo(
    () =>
      records.filter(
        (record) =>
          record.state === "pending" || record.state === "unconfirmed"
      ).length,
    [records]
  );

  const isSyncing = useMemo(
    () =>
      records.some(
        (record) =>
          record.state === "syncing" || record.state === "unconfirmed"
      ),
    [records]
  );

  const content = useMemo(
    () => composeContent(queryContent, records, queryVersion),
    [queryContent, records, queryVersion]
  );
  composedContentRef.current = content;

  const version = Math.max(queryVersion, ledgerSnapshot.knownServerVersion);

  return {
    notes,
    isLoading: notes === undefined,
    isSyncing,
    applyOperation,
    applyOperations,
    content,
    version,
    operationStates,
    operationRecords,
    unsavedOperationIds,
    pendingOperationCount,
    duplicateAcknowledgementCount: ledgerSnapshot.duplicateAcknowledgementCount,
    reconcile,
  };
}

/**
 * Helper function to calculate operation difference between two strings
 * This is a simplified implementation - you may want a more sophisticated diff algorithm
 */
export function calculateOperation(oldText: string, newText: string): NoteOperation {
  // Simple implementation: if text is longer, it's an insert; if shorter, it's a delete
  if (newText.length > oldText.length) {
    // Find position of difference
    let position = 0;
    while (position < oldText.length && oldText[position] === newText[position]) {
      position++;
    }

    return {
      type: "insert",
      position,
      content: newText.substring(position, position + (newText.length - oldText.length)),
    };
  } else if (newText.length < oldText.length) {
    // Find position of difference
    let position = 0;
    while (position < newText.length && oldText[position] === newText[position]) {
      position++;
    }

    return {
      type: "delete",
      position,
      length: oldText.length - newText.length,
    };
  } else {
    // Same length - treat as retain (no change)
    return {
      type: "retain",
      length: newText.length,
    };
  }
}
