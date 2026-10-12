/**
 * The convex/react hook shim the default-provider tests mount through: the
 * real NotesConvexTransportProvider calls `useQuery`/`useMutation`, and this
 * answers them from the REAL convex-test notes server. It mirrors
 * ConvexReactClient's observable contract: `useQuery` returns `undefined`
 * until its first read completes, then the latest result; a resolved
 * mutation is followed by a query resync.
 */
import { useEffect, useReducer } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BatchApplyNoteOperationsResponse } from "@/hooks/notes/types";
import type {
  BackendParticipant,
  NotesBackend,
  OutgoingBatch,
} from "../../notes/harness/backend";

type SimFace = BackendParticipant["face"];

/** Raw getMeetingNotes result shape (what Convex's useQuery would return). */
type RawQueryResult = {
  content: string;
  version: number;
  headSequence?: number;
  clientAcks?: Array<{ clientOpId: string; clientSequence: number }>;
} | null;

export interface QueryArgs {
  meetingId: Id<"meetings">;
  clientId: string;
}

/** Every applyBatch attempt the shim observed, including rejected ones. */
interface AttemptedBatch {
  clientId: string;
  clientOpIds: string[];
  operations: OutgoingBatch["operations"];
}

/**
 * The convex/react hook shim. One instance per test = one fake deployment.
 * `failNextBatches` rejects sends before the server sees them (a network
 * loss), like the matrix harness's ECONNRESET fault.
 */
export class ConvexReactSim {
  private readonly entries = new Map<
    string,
    {
      args: QueryArgs;
      value: RawQueryResult | undefined;
      listeners: Set<() => void>;
    }
  >();
  failNextBatches = 0;
  attemptedBatches: AttemptedBatch[] = [];

  constructor(
    private readonly backend: NotesBackend,
    private readonly face: SimFace,
  ) {}

  useQuery(_query: unknown, args: QueryArgs): RawQueryResult | undefined {
    const key = `${String(args.meetingId)}|${args.clientId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { args, value: undefined, listeners: new Set() };
      this.entries.set(key, entry);
    }
    const captured = entry;
    const [, bump] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
      captured.listeners.add(bump);
      void this.refreshEntry(key);
      return () => {
        captured.listeners.delete(bump);
      };
    }, [key]);
    return captured.value;
  }

  /**
   * convex/react's useMutation returns the same function on every render;
   * a new one per render would make the provider's transport change on every
   * query update, and the ledger hook would tear down and restart each time.
   */
  useMutation(): (
    batch: OutgoingBatch,
  ) => Promise<BatchApplyNoteOperationsResponse> {
    // churn: a new function per render, so the provider's transport changes
    // on every query update and the ledger hook stops and restarts each time.
    return this.churn ? (batch) => this.mutate(batch) : this.mutate;
  }

  /** Make the transport identity change on every render (see useMutation). */
  churn = false;

  private readonly mutate = async (
    batch: OutgoingBatch,
  ): Promise<BatchApplyNoteOperationsResponse> => {
    this.attemptedBatches.push({
      clientId: (batch as unknown as { clientId: string }).clientId,
      clientOpIds: batch.operations.map((op) => op.clientOpId),
      operations: batch.operations,
    });
    if (this.failNextBatches > 0) {
      this.failNextBatches--;
      throw new Error("simulated network failure (ECONNRESET)");
    }
    const args = batch as unknown as {
      meetingId: Id<"meetings">;
      clientId: string;
    };
    const response = (await this.backend.applyBatch(
      this.face,
      args.meetingId,
      args.clientId,
      batch,
      { push: false },
    )) as BatchApplyNoteOperationsResponse;
    await this.refreshAll();
    return response;
  };

  /** Re-runs the real query for one registered entry and notifies. */
  private async refreshEntry(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    const raw = (await this.face.query(api.notes.queries.getMeetingNotes, {
      meetingId: entry.args.meetingId,
      clientId: entry.args.clientId,
    })) as RawQueryResult;
    entry.value = raw;
    entry.listeners.forEach((listener) => listener());
  }

  /** Mutation completed → resync every live query (Convex invalidation). */
  async refreshAll(): Promise<void> {
    for (const key of [...this.entries.keys()]) {
      await this.refreshEntry(key);
    }
  }
}
