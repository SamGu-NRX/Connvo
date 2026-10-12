"use client";

/**
 * Transport context for the notes ledger (docs/notes-ledger-f1/design.md §3).
 *
 * The ledger hook reads its NotesTransport from this context so tests can
 * inject a fault-injecting transport in front of a convex-test backend, and
 * MeetingNotesPanel can supply the production (Convex) wiring by default.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { NotesTransport } from "./types";

const NotesTransportContext = createContext<NotesTransport | null>(null);

export function NotesTransportProvider({
  transport,
  children,
}: {
  transport: NotesTransport;
  /** Optional so createElement(type, props, children) resolves its
   * overloads — the property-test harness builds the provider that way. */
  children?: ReactNode;
}) {
  return (
    <NotesTransportContext.Provider value={transport}>
      {children}
    </NotesTransportContext.Provider>
  );
}

export function useNotesTransport(): NotesTransport {
  const transport = useContext(NotesTransportContext);
  if (!transport) {
    throw new Error(
      "Notes ledger used without a NotesTransportProvider. Wrap the tree in " +
        "NotesTransportProvider (MeetingNotesPanel does this for you with the " +
        "production Convex wiring — see docs/notes-ledger-f1/design.md §3).",
    );
  }
  return transport;
}
