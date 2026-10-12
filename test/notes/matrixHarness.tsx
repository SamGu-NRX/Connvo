/**
 * Mounted-matrix harness (docs/notes-ledger-f1/design.md §5).
 *
 * A fault-injecting transport in front of the REAL convex-test backend, plus
 * a renderHook mount of the ledger hook through the transport-provider
 * context. Every matrix case runs the real React binding (useSyncExternal-
 * Store) against the real merged notes mutation/query — only the transport
 * layer is scripted.
 *
 * SUBJECT SWITCH (failing-before receipts): the same matrix can run against
 * the defect-replica ledger implementing the #24-audited behaviors as
 * described in the audit:
 *
 *   NOTES_MATRIX_SUBJECT=replica pnpm vitest run --project notes \
 *     test/notes/mountedMatrix.test.tsx
 *
 * The default subject is the real ledger. See
 * test/notes/failingBefore.replica.test.tsx for the per-defect receipts.
 */

import { renderHook, waitFor, type RenderHookResult } from "@testing-library/react";
import { expect } from "vitest";
import type { ReactNode } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { NotesTransportProvider } from "@/hooks/notes/notesTransport";
import { useNotesLedger } from "@/hooks/notes/useNotesLedger";
import { useDefectReplicaNotesLedger } from "./replica/defectReplicaLedger";
import type {
  BatchApplyNoteOperationsResponse,
  NotesServerSnapshot,
  NotesTransport,
  UseNotesLedgerResult,
} from "@/hooks/notes/types";
import { NotesBackend, type BackendParticipant, type OutgoingBatch } from "./harness/backend";

/**
 * The mounted subject: the real ledger by default; the #24-audited defect
 * replica when NOTES_MATRIX_SUBJECT=replica. Read at mount time so test
 * files can pin the subject deterministically.
 */
export function matrixSubject(): "ledger" | "replica" {
  return process.env.NOTES_MATRIX_SUBJECT === "replica" ? "replica" : "ledger";
}

/** Scripted transport faults (design.md §5). */
export interface FaultConfig {
  /** Every send fails as unreachable; nothing reaches the server. */
  offline?: boolean;
  /** The send dies before the server sees it (connection reset). */
  dropBeforeApply?: boolean;
  /** The send is parked before the server sees it and never settles. */
  holdBeforeApply?: boolean;
  /** The server applies the batch, but the response is lost in transit. */
  dropAfterApply?: boolean;
  /** The server applies the batch without its natural push; the response is parked forever. */
  holdResponse?: boolean;
  /** Default true — set false to suppress the automatic fresh-read push after an apply. */
  pushAfterApply?: boolean;
  /** Artificial latency before the send resolves. */
  delayMs?: number;
  /** Reverse the per-op results array in the response. */
  reorderResults?: boolean;
  /** Echo every result twice in the response. */
  duplicateAcks?: boolean;
  /** Truncate the results array to the first N entries (partial ack). */
  keepResults?: number;
  /** The server refuses the batch (participant removed) — FORBIDDEN. */
  forbidden?: boolean;
}

function faultError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fault-injecting NotesTransport in front of the real backend. All sends go
 * through the REAL batchApplyNoteOperations mutation; faults intercept the
 * send, the response, or the push — never the server semantics.
 */
export class FaultTransport implements NotesTransport {
  /** What actually LEFT the client, in order — resend/identity assertions read this. */
  readonly sentBatches: OutgoingBatch[] = [];
  private readonly backend: NotesBackend;
  private readonly participant: BackendParticipant;
  private readonly clientId: string;
  private onSnapshot: ((snapshot: NotesServerSnapshot | undefined) => void) | null = null;
  private backendUnsubscribe: (() => void) | null = null;
  faults: FaultConfig = {};

  constructor(backend: NotesBackend, participant: BackendParticipant, clientId: string) {
    this.backend = backend;
    this.participant = participant;
    this.clientId = clientId;
  }

  subscribe(
    _meetingId: Id<"meetings">,
    _clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): () => void {
    this.onSnapshot = onSnapshot;
    const handle = this.backend.subscribe(
      this.participant.meetingId,
      this.participant.face,
      this.clientId,
      onSnapshot,
    );
    // First read delivery, async — mirroring a Convex query's first result.
    void this.backend.pushToSubscribers(this.participant.meetingId);
    this.backendUnsubscribe = handle.unsubscribe;
    return () => {
      this.onSnapshot = null;
      this.backendUnsubscribe?.();
      this.backendUnsubscribe = null;
    };
  }

  async applyBatch(
    _meetingId: Id<"meetings">,
    _clientId: string,
    batch: {
      operations: OutgoingBatch["operations"];
      expectedVersion?: number;
    },
  ): Promise<BatchApplyNoteOperationsResponse> {
    this.sentBatches.push(batch);
    if (this.faults.offline) {
      throw faultError("ENOTFOUND", "getaddrinfo ENOTFOUND — the transport is offline");
    }
    if (this.faults.holdBeforeApply) {
      // The request is parked mid-flight: the server never sees the batch
      // and the caller never hears back.
      return new Promise<BatchApplyNoteOperationsResponse>(() => {});
    }
    if (this.faults.dropBeforeApply) {
      throw faultError(
        "ECONNRESET",
        "connection reset before the batch reached the server (ECONNRESET)",
      );
    }
    if (this.faults.forbidden) {
      throw faultError(
        "FORBIDDEN",
        "FORBIDDEN: you are no longer a participant of this meeting",
      );
    }
    if (this.faults.delayMs !== undefined && this.faults.delayMs > 0) {
      await sleep(this.faults.delayMs);
    }
    const push = this.faults.pushAfterApply !== false;
    if (this.faults.dropAfterApply || this.faults.holdResponse) {
      // The server sees the batch (fire-and-forget the real mutation); the
      // response is lost in transit and never settles.
      void this.backend
        .applyBatch(this.participant.face, this.participant.meetingId, this.clientId, batch, {
          push: this.faults.holdResponse ? false : push,
        })
        .catch(() => {}); // the mutation itself is not expected to fail here
      return new Promise<BatchApplyNoteOperationsResponse>(() => {});
    }
    let response = await this.backend.applyBatch(
      this.participant.face,
      this.participant.meetingId,
      this.clientId,
      batch,
      { push },
    );
    if (this.faults.keepResults !== undefined) {
      response = { ...response, results: response.results.slice(0, this.faults.keepResults) };
    }
    if (this.faults.reorderResults) {
      response = { ...response, results: [...response.results].reverse() };
    }
    if (this.faults.duplicateAcks) {
      response = { ...response, results: [...response.results, ...response.results] };
    }
    return response;
  }

  close(): void {}

  /** Reconnect: the fault clears and a fresh read is pushed to every subscriber. */
  async reconnect(): Promise<void> {
    this.faults.offline = false;
    await this.backend.pushToSubscribers(this.participant.meetingId);
  }

  /** Manual fresh-read push (tests control exactly when reads arrive). */
  async pushFreshRead(): Promise<void> {
    await this.backend.pushToSubscribers(this.participant.meetingId);
  }

  /** A canned snapshot delivery: fresh, stale, or undefined (loading). */
  pushSnapshot(snapshot: NotesServerSnapshot | undefined): void {
    this.onSnapshot?.(snapshot);
  }
}

export interface MountProps {
  meetingId: Id<"meetings">;
  clientId: string;
  debounceMs: number;
}

export interface MountedLedger {
  hook: RenderHookResult<UseNotesLedgerResult, MountProps>;
  transport: FaultTransport;
}

/**
 * Mounts the SUBJECT hook (real ledger, or the defect replica when
 * NOTES_MATRIX_SUBJECT=replica) through the transport-provider context.
 */
export function mountNotesLedger(
  backend: NotesBackend,
  participant: BackendParticipant,
  clientId: string,
  debounceMs = 0,
): MountedLedger {
  const transport = new FaultTransport(backend, participant, clientId);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NotesTransportProvider transport={transport}>{children}</NotesTransportProvider>
    );
  }
  const hook = renderHook(
    (props: MountProps) =>
      matrixSubject() === "replica"
        ? useDefectReplicaNotesLedger(props.meetingId)
        : useNotesLedger(props.meetingId, {
            clientId: props.clientId,
            debounceMs: props.debounceMs,
          }),
    {
      wrapper: Wrapper,
      initialProps: { meetingId: participant.meetingId, clientId, debounceMs },
    },
  );
  return { hook, transport };
}

let participantCounter = 0;

/** Creates a fresh participant on the given backend with a unique tag. */
export async function setupParticipant(
  backend: NotesBackend,
  tag: string,
): Promise<BackendParticipant> {
  return backend.addParticipant(`mx-${tag}-${++participantCounter}`);
}

/** Waits until the REAL server row reads exactly `expected`. */
export async function waitForServerText(
  backend: NotesBackend,
  meetingId: Id<"meetings">,
  expected: string,
): Promise<void> {
  await waitFor(async () => {
    const server = await backend.readServerText(meetingId);
    expect(server.content).toBe(expected);
  });
}

export async function waitForContent(
  hook: RenderHookResult<UseNotesLedgerResult, MountProps>,
  expected: string,
): Promise<void> {
  await waitFor(() => {
    expect(hook.result.current.content).toBe(expected);
  });
}

export async function waitForStatus(
  hook: RenderHookResult<UseNotesLedgerResult, MountProps>,
  expected: UseNotesLedgerResult["status"],
): Promise<void> {
  await waitFor(() => {
    expect(hook.result.current.status).toBe(expected);
  });
}

/** Waits until the hook's first read has landed (no loading state). */
export async function waitForLoaded(
  hook: RenderHookResult<UseNotesLedgerResult, MountProps>,
): Promise<void> {
  await waitFor(() => {
    expect(hook.result.current.isLoading).toBe(false);
  });
}

/** Seeds server text through the REAL mutation before any hook is mounted. */
export async function seedServerText(
  backend: NotesBackend,
  participant: BackendParticipant,
  text: string,
): Promise<void> {
  await backend.applyBatch(participant.face, participant.meetingId, "seed-client", {
    operations: [
      {
        operation: { type: "insert", position: 0, content: text },
        clientSequence: 0,
        clientOpId: `seed-${Math.random().toString(36).slice(2)}`,
      },
    ],
  });
}
