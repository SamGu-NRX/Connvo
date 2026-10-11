/**
 * Notes ledger module — loss-proof in-call collaborative notes (S1).
 * Contract and protocol: docs/notes-ledger-f1/design.md.
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
