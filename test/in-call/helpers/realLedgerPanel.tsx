/**
 * Real-ledger mounting harness for the in-call panel suites.
 *
 * The panel a11y matrix must exercise the REAL `useNotesLedger` hook (the
 * M2/M3 join): every state is produced by driving the ledger through the M2
 * matrix harness — a fault-injecting transport in front of the REAL
 * convex-test notes mutations/queries — instead of seeding mock hook state.
 *
 * This wrapper adds the one thing the shared FaultTransport cannot express on
 * its own: withholding the automatic first read (`subscribe` pushes a snapshot
 * immediately) so a test can observe the honest `loading` window before any
 * server evidence lands. The gate is a transport-level flag; the ledger, the
 * hook and the panel are untouched.
 */

import { render, waitFor } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { MeetingNotesPanel } from "@/components/meeting-notes/MeetingNotesPanel";
import { NotesTransportProvider } from "@/hooks/notes/notesTransport";
import { expect } from "vitest";
import type {
  BatchApplyNoteOperationsResponse,
  NotesBatchOp,
  NotesServerSnapshot,
  NotesTransport,
} from "@/hooks/notes/types";
import { NotesBackend, type BackendParticipant } from "../../notes/harness/backend";
import {
  FaultTransport,
  seedServerText,
  setupParticipant,
  type FaultConfig,
} from "../../notes/matrixHarness";

/** Stable transport identity — the transport joins its own acks by this id. */
export const PANEL_TRANSPORT_CLIENT_ID = "a11y-panel-client";

/**
 * Wraps the FaultTransport with a read gate: while `holdReads` is true every
 * server snapshot (the automatic first read, a push, a manual fresh read) is
 * withheld, which is exactly the client-side situation "no evidence yet" the
 * ledger's `loading` state is honest about. `releaseReads` delivers the
 * newest held snapshot (latest-wins — stale holds are dropped, mirroring the
 * ledger's monotonic ingest).
 */
export class ReadGateTransport implements NotesTransport {
  private readonly inner: FaultTransport;
  private deliver: ((snapshot: NotesServerSnapshot | undefined) => void) | null = null;
  private held: Array<NotesServerSnapshot | undefined> = [];
  /** When true, server reads are withheld — the loading-state window. */
  holdReads = false;

  constructor(inner: FaultTransport) {
    this.inner = inner;
  }

  /** Fault passthrough: tests set `gate.faults = {...}` like a matrix case. */
  get faults(): FaultConfig {
    return this.inner.faults;
  }

  set faults(faults: FaultConfig) {
    this.inner.faults = faults;
  }

  subscribe(
    meetingId: Id<"meetings">,
    clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): () => void {
    this.deliver = onSnapshot;
    return this.inner.subscribe(meetingId, clientId, (snapshot) => {
      if (this.holdReads) {
        this.held.push(snapshot);
        return;
      }
      onSnapshot(snapshot);
    });
  }

  /** Reopens the read path and delivers the newest held snapshot. */
  releaseReads(): void {
    this.holdReads = false;
    const latest = this.held.at(-1);
    this.held = [];
    if (latest !== undefined) {
      this.deliver?.(latest);
    }
  }

  applyBatch(
    meetingId: Id<"meetings">,
    clientId: string,
    batch: { operations: NotesBatchOp[]; expectedVersion?: number },
  ): Promise<BatchApplyNoteOperationsResponse> {
    return this.inner.applyBatch(meetingId, clientId, batch);
  }

  close(): void {
    this.inner.close();
  }

  async reconnect(): Promise<void> {
    await this.inner.reconnect();
  }

  async pushFreshRead(): Promise<void> {
    await this.inner.pushFreshRead();
  }
}

export interface MountedRealLedgerPanel {
  backend: NotesBackend;
  participant: BackendParticipant;
  meetingId: Id<"meetings">;
  gate: ReadGateTransport;
  container: HTMLElement;
  unmount: () => void;
}

/**
 * Boots a fresh convex-test meeting, optionally seeds server text through the
 * REAL mutation, then mounts MeetingNotesPanel over the REAL ledger hook
 * through the gated fault transport. No mock anywhere in the chain.
 */
export async function mountRealLedgerPanel(options?: {
  /** Server content seeded before mount (omit for a meeting with no notes row). */
  seedText?: string;
  /** Start with reads withheld (the loading-state window). */
  holdReads?: boolean;
  tag?: string;
}): Promise<MountedRealLedgerPanel> {
  const tag = options?.tag ?? "a11y";
  const backend = new NotesBackend();
  const participant = await setupParticipant(backend, tag);
  if (options?.seedText !== undefined) {
    await seedServerText(backend, participant, options.seedText);
  }
  const transport = new FaultTransport(
    backend,
    participant,
    `${PANEL_TRANSPORT_CLIENT_ID}-${tag}`,
  );
  const gate = new ReadGateTransport(transport);
  if (options?.holdReads) {
    gate.holdReads = true;
  }

  // Each mount models a FRESH browser session: the recovery store must not
  // leak between tests. convex-test environment ids repeat per environment,
  // so identical meetingId+clientId keys across tests would let one test's
  // persisted ledger (buffer, records, server version) restore into the
  // next test's ledger and poison its state.
  window.sessionStorage.clear();

  // `main` supplies the landmark a page shell provides in the app, so the
  // component-scoped axe run reflects the panel itself.
  const view = render(
    <main>
      <NotesTransportProvider transport={gate}>
        <MeetingNotesPanel meetingId={participant.meetingId} />
      </NotesTransportProvider>
    </main>,
  );

  return {
    backend,
    participant,
    meetingId: participant.meetingId,
    gate,
    container: view.container,
    unmount: view.unmount,
  };
}

/** Waits until the REAL server row reads exactly `expected` (server truth). */
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
