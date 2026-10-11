"use client";

/**
 * Self-containment seam for MeetingNotesPanel (docs/notes-ledger-f1/design.md §4).
 *
 * When no NotesTransportProvider sits above the panel, the panel supplies this
 * default provider. The production Convex wiring (useQuery/useMutation against
 * api.notes.queries.getMeetingNotes / api.notes.mutations.batchApplyNoteOperations)
 * is the ledger milestone's deliverable (design.md §3) and is built in parallel —
 * until that join lands, this placeholder fails loudly on first use instead of
 * pretending to save.
 *
 * TODO-M2(join): swap the placeholder transport for the ledger milestone's
 * exported Convex default wiring. One-line change, nothing else in this file.
 */

import { useMemo, type ReactNode } from "react";
import { NotesTransportProvider } from "@/hooks/notes";
import type { NotesTransport } from "@/hooks/notes";

const UNWIRED_MESSAGE =
  "MeetingNotesPanel: the production Convex notes transport is not wired yet — " +
  "it lands with the notes ledger milestone (docs/notes-ledger-f1/design.md §3). " +
  "Until then, provide a NotesTransportProvider explicitly (the /dev/notes-preview " +
  "route does this with the in-memory demo backend).";

function createUnwiredTransport(): NotesTransport {
  return {
    subscribe: () => {
      throw new Error(UNWIRED_MESSAGE);
    },
    applyBatch: () => Promise.reject(new Error(UNWIRED_MESSAGE)),
    close: () => {},
  };
}

export function DefaultNotesTransportProvider({
  children,
}: {
  children: ReactNode;
}) {
  const placeholderTransport = useMemo(() => createUnwiredTransport(), []);
  return (
    <NotesTransportProvider transport={placeholderTransport}>
      {children}
    </NotesTransportProvider>
  );
}
