"use client";

/**
 * Production Convex wiring for the notes transport (docs/notes-ledger-f1/design.md §3).
 *
 * Bridges the registered notes API (convex/notes/*) into the pinned
 * `NotesTransport` seam:
 *  - `getMeetingNotes` with a clientId supplies the additive watermark fields
 *    (headSequence, clientAcks) the ledger ingests;
 *  - a completed read with no notes row is normalized to the version-0 empty
 *    snapshot — the ledger can then diff from a defined empty base instead of
 *    deadlocking on "loading";
 *  - `batchApplyNoteOperations` carries per-op identity (clientOpId /
 *    clientSequence) and the batch-level clientId; no `expectedVersion` is
 *    sent — concurrency resolves through server-side transforms.
 *
 * Convex's React client owns the subscription lifecycle, so this transport
 * exposes no manual `refresh`; unconfirmed operations resolve on the next
 * natural query update (see NotesLedger.nudgeFreshRead).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { NotesTransportProvider } from "./notesTransport";
import type {
  BatchApplyNoteOperationsResponse,
  NotesServerSnapshot,
  NotesTransport,
} from "./types";

/** A completed read for a meeting with no notes row yet. */
const ROWLESS_SNAPSHOT: NotesServerSnapshot = {
  content: "",
  version: 0,
  headSequence: 0,
  clientAcks: [],
};

type QueryResult = {
  content: string;
  version: number;
  headSequence?: number;
  clientAcks?: NotesServerSnapshot["clientAcks"];
} | null;

function normalizeSnapshot(raw: QueryResult | undefined): NotesServerSnapshot | undefined {
  if (raw === undefined) return undefined; // loading — the ledger waits
  if (raw === null) return ROWLESS_SNAPSHOT; // completed read, no row yet
  return {
    content: raw.content,
    version: raw.version,
    headSequence: raw.headSequence ?? 0,
    clientAcks: raw.clientAcks ?? [],
  };
}

export function NotesConvexTransportProvider({
  meetingId,
  clientId,
  children,
}: {
  meetingId: Id<"meetings">;
  clientId: string;
  children: ReactNode;
}) {
  const raw = useQuery(api.notes.queries.getMeetingNotes, { meetingId, clientId });
  const applyMutation = useMutation(api.notes.mutations.batchApplyNoteOperations);

  const listenerRef = useRef<((snapshot: NotesServerSnapshot | undefined) => void) | null>(null);
  const snapshotRef = useRef<NotesServerSnapshot | undefined>(undefined);
  const snapshot = useMemo(() => normalizeSnapshot(raw), [raw]);
  snapshotRef.current = snapshot;

  useEffect(() => {
    listenerRef.current?.(snapshot);
  }, [snapshot]);

  const applyBatch = useCallback<NotesTransport["applyBatch"]>(
    (id, cid, batch) =>
      applyMutation({
        meetingId: id,
        clientId: cid,
        operations: batch.operations,
        ...(batch.expectedVersion !== undefined
          ? { expectedVersion: batch.expectedVersion }
          : {}),
      }) as Promise<BatchApplyNoteOperationsResponse>,
    [applyMutation],
  );

  const transport = useMemo<NotesTransport>(
    () => ({
      subscribe: (id, cid, onSnapshot) => {
        // One live subscriber (the ledger) per provider instance.
        listenerRef.current = onSnapshot;
        const current = snapshotRef.current;
        if (current !== undefined) onSnapshot(current);
        return () => {
          if (listenerRef.current === onSnapshot) listenerRef.current = null;
        };
      },
      applyBatch,
      close: () => {},
    }),
    [applyBatch],
  );

  return (
    <NotesTransportProvider transport={transport}>{children}</NotesTransportProvider>
  );
}
