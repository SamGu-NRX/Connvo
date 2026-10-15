/**
 * Notes ledger module — loss-proof in-call collaborative notes (S1).
 * Contract and protocol: docs/notes-ledger-f1/design.md.
 *
 * The real ledger (M2) replaces the M0 placeholder: useNotesLedger binds the
 * framework-free NotesLedger store into useSyncExternalStore, and
 * NotesConvexTransportProvider is the production Convex wiring for the
 * transport seam (MeetingNotesPanel's defaultNotesTransport joins to it).
 */

export type {
  BatchApplyNoteOperationsResponse,
  NotesBatchOp,
  NotesLedgerStatus,
  NotesOperation,
  NotesServerSnapshot,
  NotesTransport,
  UseNotesLedgerResult,
} from "./types";
export {
  NotesTransportProvider,
  useNotesTransport,
} from "./notesTransport";
export { useNotesLedger } from "./useNotesLedger";
export type { UseNotesLedgerOptions } from "./useNotesLedger";
export { NotesConvexTransportProvider } from "./notesConvexTransport";
export {
  stableNotesClientId,
  useStableNotesClientId,
} from "./stableClientId";
export {
  NotesLedger,
  classifyTransportError,
} from "./notesLedger";
export type {
  NotesLedgerOptions,
  NotesLedgerRecord,
  NotesLedgerRecordState,
} from "./notesLedger";
export {
  applyToDoc,
  applyOperations,
  diffToSiblingOps,
} from "./notesDiff";
