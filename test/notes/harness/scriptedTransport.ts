/**
 * Scripted ledger transport for ledger-level review-sequence tests.
 *
 * Fronts no real backend: batches PARK until the test resolves or rejects
 * them, snapshots are delivered by hand, and the helpers simulate the
 * server side (apply ops to the server text, echo identity acks). This
 * keeps every reproduced sequence at the ledger boundary - exactly the
 * surface the server contract speaks (identity + watermark).
 */

import { applyOperations } from "../../../src/hooks/notes/notesDiff";
import type {
  BatchApplyNoteOperationsResponse,
  NotesBatchOp,
  NotesOperation,
  NotesServerSnapshot,
  NotesTransport,
} from "../../../src/hooks/notes/types";

/** One parked applyBatch call the test can resolve or reject. */
export interface ScriptedCall {
  meetingId: string;
  clientId: string;
  operations: NotesBatchOp[];
  expectedVersion?: number;
  /** Resolve with a real (echoing) response. */
  resolve(): void;
  /** Reject with an error (classified by the ledger). */
  reject(error: unknown): void;
  readonly settled: boolean;
}

interface AckOverride {
  clientOpId: string;
  serverSequence: number;
  clientSequence: number;
  appliedAt: number;
}

export class ScriptedTransport implements NotesTransport {
  readonly calls: ScriptedCall[] = [];
  /** Simulated server truth the echo helpers read. */
  serverText = "";
  serverVersion = 0;
  headSequence = 0;
  /** Applied ops the next echoed snapshot will ack (identity -> seq). */
  readonly appliedOps = new Map<string, { serverSequence: number; clientSequence: number }>();
  refreshCount = 0;

  private listener:
    | ((snapshot: NotesServerSnapshot | undefined) => void)
    | undefined;
  private nextServerSequence = 1;

  subscribe(
    _meetingId: Parameters<NotesTransport["subscribe"]>[0],
    _clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): () => void {
    this.listener = onSnapshot;
    return () => {
      if (this.listener === onSnapshot) this.listener = undefined;
    };
  }

  applyBatch(
    meetingId: Parameters<NotesTransport["subscribe"]>[0],
    clientId: string,
    batch: { operations: NotesBatchOp[]; expectedVersion?: number },
  ): Promise<BatchApplyNoteOperationsResponse> {
    const call: ScriptedCall = {
      meetingId,
      clientId,
      operations: batch.operations,
      expectedVersion: batch.expectedVersion,
      settled: false,
      // Assigned right below; declared readonly otherwise.
      resolve: () => undefined,
      reject: () => undefined,
    } as ScriptedCall;
    let res: (r: BatchApplyNoteOperationsResponse) => void;
    let rej: (e: unknown) => void;
    const promise = new Promise<BatchApplyNoteOperationsResponse>(
      (resolve, reject) => {
        res = resolve;
        rej = reject;
      },
    );
    Object.assign(call, {
      resolve: () => {
        if (call.settled) throw new Error("call already settled");
        (call as { settled: boolean }).settled = true;
        res(this.echoResponse(call));
      },
      reject: (error: unknown) => {
        if (call.settled) throw new Error("call already settled");
        (call as { settled: boolean }).settled = true;
        rej(error);
      },
    });
    this.calls.push(call);
    return promise;
  }

  close(): void {
    this.listener = undefined;
  }

  /** Manual snapshot delivery (undefined simulates a loading result). */
  deliver(snapshot: NotesServerSnapshot | undefined): void {
    this.listener?.(snapshot);
  }

  /** Transport-level refresh probe (the ledger's unknown-failure nudge). */
  refresh(): void {
    this.refreshCount += 1;
    this.deliver(this.echoSnapshot());
  }

  // ----- server-side simulation helpers ---------------------------------

  /** Mark every op of a parked call as applied: advance the watermark and
   * server text, remember the identity acks, and advance the version. */
  applyCall(call: ScriptedCall): void {
    const ops: NotesOperation[] = call.operations.map((entry) => entry.operation);
    this.serverText = applyOperations(this.serverText, ops);
    this.headSequence = this.nextServerSequence;
    for (const entry of call.operations) {
      this.appliedOps.set(entry.clientOpId, {
        serverSequence: this.nextServerSequence,
        clientSequence: entry.clientSequence,
      });
      this.nextServerSequence += 1;
    }
    this.serverVersion += 1;
  }

  /** Current snapshot echoing applied identity acks, with overrides. */
  echoSnapshot(overrides?: {
    content?: string;
    version?: number;
    headSequence?: number;
    clientAcks?: AckOverride[];
  }): NotesServerSnapshot {
    const clientAcks = overrides?.clientAcks
      ? overrides.clientAcks
      : [...this.appliedOps.entries()].map(
          ([clientOpId, seq]) => ({
            clientOpId,
            serverSequence: seq.serverSequence,
            clientSequence: seq.clientSequence,
            appliedAt: seq.serverSequence,
          }),
        );
    return {
      content: overrides?.content ?? this.serverText,
      version: overrides?.version ?? this.serverVersion,
      headSequence: overrides?.headSequence ?? this.headSequence,
      clientAcks,
    };
  }

  /** The response the server would send for this call: per-op identity
   * echo for every applied op. Unapplied ops are simply absent (the ledger
   * treats a missing echo as unconfirmed). */
  echoResponse(call: ScriptedCall): BatchApplyNoteOperationsResponse {
    return {
      success: true,
      processed: call.operations.length,
      failed: 0,
      newVersion: this.serverVersion,
      results: call.operations
        .filter((entry) => this.appliedOps.has(entry.clientOpId))
        .map((entry) => ({
          serverSequence: this.appliedOps.get(entry.clientOpId)!.serverSequence,
          transformedOperation: entry.operation,
          conflicts: [],
          clientOpId: entry.clientOpId,
          clientSequence: entry.clientSequence,
        })),
    };
  }
}

/** Deterministic ledger id sources (now + generateId). */
export function deterministicLedgerClock(): {
  now: () => number;
  generateId: () => number;
} {
  let t = 1_700_000_000_000;
  let n = 0;
  return {
    now: () => (t += 1),
    generateId: () => (n += 1) / 1e9,
  };
}

/** Microtask drain (promise callbacks the ledger schedules on settle). */
export async function tick(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}
