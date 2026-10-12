"use client";

/**
 * React binding for the notes ledger (docs/notes-ledger-f1/design.md §3).
 *
 * All sync logic lives in the framework-free `NotesLedger` store; this hook
 * binds it into `useSyncExternalStore` (stable snapshots between real
 * changes), wires the transport from context, and tears down synchronously
 * on unmount. The exported signature stays cast-compatible with the pinned
 * contract `useNotesLedger(meetingId)` used by MeetingNotesPanel (M3) — the
 * options argument is additive and optional.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useSyncExternalStore } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { NotesLedger } from "./notesLedger";
import { useNotesTransport } from "./notesTransport";
import type { UseNotesLedgerResult } from "./types";

export interface UseNotesLedgerOptions {
  /** Stable per-client identity (dedupe + ack join key). Generated per mount when omitted. */
  clientId?: string;
  /** Debounce for keystroke flushes (ms). Default 800. */
  debounceMs?: number;
  /** Recovery store; defaults to sessionStorage where available, null disables. */
  storage?: Storage | null;
}

export function useNotesLedger(
  meetingId: Id<"meetings">,
  options: UseNotesLedgerOptions = {},
): UseNotesLedgerResult {
  const transport = useNotesTransport();
  const { clientId, debounceMs, storage } = options;
  const ledger = useMemo(
    () =>
      new NotesLedger({
        meetingId,
        clientId:
          clientId ??
          `c-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        debounceMs,
        storage,
      }),
    [meetingId, clientId, debounceMs, storage],
  );

  useEffect(() => {
    ledger.start(transport);
    return () => {
      ledger.destroy();
    };
  }, [ledger, transport]);

  const subscribe = useCallback(
    (listener: () => void) => ledger.subscribe(listener),
    [ledger],
  );
  const getSnapshot = useCallback(() => ledger.getSnapshot(), [ledger]);
  // Recovery-free server snapshot: restored pending work must never leak
  // into the hydration render (a mismatch when recovery data exists).
  const getServerSnapshot = useCallback(
    () => ledger.getServerSnapshot(),
    [ledger],
  );

  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return useMemo(
    () => ({
      ...state,
      onEdit: ledger.onEdit,
      flushNow: ledger.flushNow,
      retryConflicts: ledger.retryConflicts,
    }),
    [state, ledger],
  );
}
