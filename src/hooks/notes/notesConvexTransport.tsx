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
 *  - the client's connection state is reported to the ledger (after a short
 *    grace), because Convex queues mutations while disconnected instead of
 *    failing them: without it an outage would read as "saving";
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
  useState,
  type ReactNode,
} from "react";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { NotesTransportProvider } from "./notesTransport";
import type {
  BatchApplyNoteOperationsResponse,
  NotesServerSnapshot,
  NotesTransport,
} from "./types";

/**
 * How long the socket must stay down before the notes say "Offline". The
 * Convex client reconnects from short blips by itself (its first retry is
 * within a second); flashing "Offline" for those would be noise. Chosen by
 * judgment, not measured.
 */
const OFFLINE_AFTER_MS = 1500;

/**
 * Whether the Convex client is connected, reported offline only after the
 * socket has been down for OFFLINE_AFTER_MS. Before the first connection the
 * page is still loading, which is not offline.
 */
function useConnectedAfterGrace(): boolean {
  const { isWebSocketConnected, hasEverConnected } = useConvexConnectionState();
  const down = hasEverConnected && !isWebSocketConnected;
  const [offline, setOffline] = useState(false);
  const [previousDown, setPreviousDown] = useState(down);
  if (down !== previousDown) {
    setPreviousDown(down);
    setOffline(false);
  }
  useEffect(() => {
    if (!down) return;
    const timer = setTimeout(() => setOffline(true), OFFLINE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [down]);
  return !down || !offline;
}

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

function normalizeSnapshot(
  raw: QueryResult | undefined,
): NotesServerSnapshot | undefined {
  if (raw === undefined) return undefined; // loading — the ledger waits
  if (raw === null) return ROWLESS_SNAPSHOT; // completed read, no row yet
  return {
    content: raw.content,
    version: raw.version,
    headSequence: raw.headSequence ?? 0,
    clientAcks: raw.clientAcks ?? [],
  };
}

type NotesConvexTransportProviderProps = {
  meetingId: Id<"meetings">;
  clientId: string;
  children: ReactNode;
};

export function NotesConvexTransportProvider(props: NotesConvexTransportProviderProps) {
  // A new identity must reset snapshots and ledger subscribers together; otherwise
  // a child can ingest the previous meeting's snapshot before this provider's effect runs.
  return <NotesConvexTransportSession key={JSON.stringify([props.meetingId, props.clientId])} {...props} />;
}

function NotesConvexTransportSession({
  meetingId,
  clientId,
  children,
}: NotesConvexTransportProviderProps) {
  const raw = useQuery(api.notes.queries.getMeetingNotes, {
    meetingId,
    clientId,
  });
  const applyMutation = useMutation(
    api.notes.mutations.batchApplyNoteOperations,
  );

  const online = useConnectedAfterGrace();
  const onlineRef = useRef(online);
  const connectionListenerRef = useRef<((online: boolean) => void) | null>(
    null,
  );
  useEffect(() => {
    onlineRef.current = online;
    connectionListenerRef.current?.(online);
  }, [online]);

  const listenerRef = useRef<
    ((snapshot: NotesServerSnapshot | undefined) => void) | null
  >(null);
  const snapshot = useMemo(() => normalizeSnapshot(raw), [raw]);
  const snapshotRef = useRef<NotesServerSnapshot | undefined>(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
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
      subscribeConnection: (onChange) => {
        connectionListenerRef.current = onChange;
        onChange(onlineRef.current);
        return () => {
          if (connectionListenerRef.current === onChange)
            connectionListenerRef.current = null;
        };
      },
      close: () => {},
    }),
    [applyBatch],
  );

  return (
    <NotesTransportProvider transport={transport}>
      {children}
    </NotesTransportProvider>
  );
}
