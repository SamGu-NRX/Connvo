"use client";

/**
 * Self-containment seam for MeetingNotesPanel (docs/notes-ledger-f1/design.md §4).
 *
 * When no NotesTransportProvider sits above the panel, the panel supplies this
 * default provider: the production Convex wiring (M2's
 * NotesConvexTransportProvider) bound to the meeting and the panel's stable
 * per-tab client identity. The identity is decided ABOVE both the ledger and
 * the transport — the panel computes it once via useStableNotesClientId and
 * hands the same value to useNotesLedger and here, so identity
 * acknowledgements and server-side dedupe join (design.md §3).
 *
 * Joined at the M2/M3 join: this replaces M3's loud-failure placeholder; the
 * panel selects this provider when no transport is supplied.
 */

import { NotesConvexTransportProvider } from "@/hooks/notes";
import type { Id } from "@convex/_generated/dataModel";
import type { ReactNode } from "react";

export function DefaultNotesTransportProvider({
  meetingId,
  clientId,
  children,
}: {
  meetingId: Id<"meetings">;
  clientId: string;
  children: ReactNode;
}) {
  return (
    <NotesConvexTransportProvider meetingId={meetingId} clientId={clientId}>
      {children}
    </NotesConvexTransportProvider>
  );
}
