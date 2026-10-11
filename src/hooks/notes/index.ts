/**
 * Notes ledger module — loss-proof in-call collaborative notes (S1).
 * Contract and protocol: docs/notes-ledger-f1/design.md.
 */

import type { UseNotesLedgerResult } from "./types";

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

/**
 * M0 placeholder — replaced by the real ledger hook in the ledger milestone
 * (docs/notes-ledger-f1/design.md §3). Callers never hit this throw in
 * production: MeetingNotesPanel mounts the real implementation once M2 lands.
 * TODO-M2: implement in useNotesLedger.ts and re-export from here.
 */
export function useNotesLedger(): UseNotesLedgerResult {
  throw new Error(
    "useNotesLedger is not implemented yet — lands with the notes ledger milestone (docs/notes-ledger-f1/design.md §3).",
  );
}
