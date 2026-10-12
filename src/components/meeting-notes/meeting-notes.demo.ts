/**
 * In-memory demo backend for the /dev/notes-preview route (M3 of
 * connvo-notes-ledger-f1, docs/notes-ledger-f1/design.md §4).
 *
 * Implements the pinned NotesTransport seam (src/hooks/notes/types.ts) against
 * a plain string document, with fault toggles that drive REAL states through
 * the real hook contract:
 *
 *   - offline:      subscribe stops delivering, batches reject — panel shows Offline
 *   - dropAck:      a batch APPLIES server-side but its response is lost — the
 *                   hook must hold the edits as unconfirmed (never re-send blind)
 *                   and resolve them from clientAcks on the next fresh read
 *   - slowNetwork:  responses are delayed — the panel shows Saving while in flight
 *   - simulateRemoteEdit: a foreign "participant" changes the doc while local
 *                   ops are unacked — drives the Updating state
 *
 * NOT production code: single-writer demo, no real OT transform (operations
 * apply at their stated positions via the server's own pure applicator), no
 * persistence. Never wire this into a product surface.
 */

import type { Id } from "@convex/_generated/dataModel";
import { applyToDoc, validateOperation } from "@convex/notes/operations";
import type {
  BatchApplyNoteOperationsResponse,
  NotesBatchOp,
  NotesServerSnapshot,
  NotesTransport,
} from "@/hooks/notes";

export const DEMO_SEED_CONTENT = "Agenda:\n- ship the notes ledger\n- celebrate\n";

const MAX_DEMO_ACKS = 100;

interface DemoDocument {
  content: string;
  version: number;
  headSequence: number;
  /** Applied ops by client — the identity acks a fresh read would return. */
  acksByClient: Map<string, NotesServerSnapshot["clientAcks"]>;
}

export interface DemoNotesControls {
  /** Simulate the network dying (batches reject, snapshots stop). */
  setOffline(offline: boolean): void;
  /** Simulate a lost response AFTER the server applied a batch (drop-ack). */
  setDropAck(dropAck: boolean): void;
  /** Delay every batch response by this many ms (null = no artificial delay). */
  setSlowNetwork(delayMs: number | null): void;
  /** A foreign participant edits the document, bumping the server version. */
  simulateRemoteEdit(content: string): void;
  /** Restore the seed document, clear faults and acks. */
  reset(): void;
}

export interface DemoNotesBackend {
  transport: NotesTransport;
  controls: DemoNotesControls;
}

export function createDemoNotesBackend(
  seedContent: string = DEMO_SEED_CONTENT,
): DemoNotesBackend {
  let doc: DemoDocument = createSeed(seedContent);
  const listeners = new Map<
    number,
    { meetingId: Id<"meetings">; clientId: string; onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void }
  >();
  let nextListenerId = 1;

  let offline = false;
  let dropAck = false;
  let slowNetworkMs: number | null = null;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  function createSeed(content: string): DemoDocument {
    return {
      content,
      version: 1,
      headSequence: 0,
      acksByClient: new Map(),
    };
  }

  function snapshotFor(clientId: string): NotesServerSnapshot {
    return {
      content: doc.content,
      version: doc.version,
      headSequence: doc.headSequence,
      clientAcks: [...(doc.acksByClient.get(clientId) ?? [])],
    };
  }

  function emitSnapshots(): void {
    for (const listener of listeners.values()) {
      listener.onSnapshot(snapshotFor(listener.clientId));
    }
  }

  function settleLater<T>(work: () => Promise<T>): Promise<T> {
    const delayMs = slowNetworkMs ?? 0;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        work().then(resolve, reject);
      }, delayMs);
      pendingTimers.add(timer);
    });
  }

  const transport: NotesTransport = {
    subscribe(meetingId, clientId, onSnapshot) {
      if (offline) {
        // Network is down: no snapshot ever arrives. Returning a no-op
        // unsubscribe keeps the hook's contract; nothing is emitted until
        // faults clear.
        return () => {};
      }
      const listenerId = nextListenerId++;
      listeners.set(listenerId, { meetingId, clientId, onSnapshot });
      // Emit the current truth immediately, like a fresh Convex query result.
      onSnapshot(snapshotFor(clientId));
      return () => {
        listeners.delete(listenerId);
      };
    },

    applyBatch(meetingId, clientId, batch) {
      return settleLater(async () => {
        if (offline) {
          throw new Error("demo transport offline: network unavailable");
        }

        if (
          batch.expectedVersion !== undefined &&
          batch.expectedVersion !== doc.version
        ) {
          // Mirrors the registered server: CONFLICT applies nothing.
          throw new Error(
            `CONFLICT: expected version ${batch.expectedVersion}, current version ${doc.version}`,
          );
        }

        const results: BatchApplyNoteOperationsResponse["results"] = [];
        const failedOps: BatchApplyNoteOperationsResponse["failedOps"] = [];
        let content = doc.content;
        let failed = 0;

        for (const [index, entry] of batch.operations.entries()) {
          const applied = applyDemoOp(content, entry);
          if (applied.ok) {
            content = applied.content;
            results.push({
              serverSequence: ++doc.headSequence,
              transformedOperation: entry.operation,
              conflicts: [],
              clientOpId: entry.clientOpId,
              clientSequence: entry.clientSequence,
              deduped: false,
            });
          } else {
            failed += 1;
            failedOps.push({
              index,
              clientOpId: entry.clientOpId,
              clientSequence: entry.clientSequence,
              reason: applied.reason,
            });
          }
        }

        if (results.length > 0) {
          doc.content = content;
          // One version bump per batch (the registered server's semantics).
          doc.version += 1;
          const acks = doc.acksByClient.get(clientId) ?? [];
          for (const result of results) {
            // Only ops that carried an identity are ack-able; identity is
            // clientOpId, and ops without a clientSequence ack as 0.
            if (result.clientOpId === undefined) continue;
            acks.push({
              clientOpId: result.clientOpId,
              clientSequence: result.clientSequence ?? 0,
              serverSequence: result.serverSequence,
              appliedAt: Date.now(),
            });
          }
          doc.acksByClient.set(clientId, acks.slice(-MAX_DEMO_ACKS));
          // Persist-before-ack: the doc changed server-side BEFORE the
          // response (or its loss) reaches the client.
          emitSnapshots();
        }

        const response: BatchApplyNoteOperationsResponse = {
          success: failed === 0,
          processed: results.length,
          failed,
          results,
          newVersion: doc.version,
          ...(failedOps.length > 0 ? { failedOps } : {}),
        };

        if (dropAck) {
          // The server applied everything (above) but the response is lost.
          throw new Error(
            "demo transport: response lost in transit after apply (dropped ack)",
          );
        }

        return response;
      });
    },

    close() {
      listeners.clear();
      for (const timer of pendingTimers) {
        clearTimeout(timer);
      }
      pendingTimers.clear();
    },
  };

  const controls: DemoNotesControls = {
    setOffline(next) {
      offline = next;
    },
    setDropAck(next) {
      dropAck = next;
    },
    setSlowNetwork(delayMs) {
      slowNetworkMs = delayMs;
    },
    simulateRemoteEdit(content) {
      doc.content = content;
      doc.version += 1;
      doc.headSequence += 1;
      emitSnapshots();
    },
    reset() {
      doc = createSeed(seedContent);
      offline = false;
      dropAck = false;
      slowNetworkMs = null;
      emitSnapshots();
    },
  };

  return { transport, controls };
}

type ApplyDemoResult =
  | { ok: true; content: string }
  | { ok: false; reason: string };

/**
 * Applies one op with the server's own pure applicator (same bounds checks),
 * mirroring the registered per-op failure behavior: a bad op is skipped into
 * failedOps, the batch continues.
 */
function applyDemoOp(content: string, entry: NotesBatchOp): ApplyDemoResult {
  if (!validateOperation(entry.operation)) {
    return { ok: false, reason: "invalid operation" };
  }
  try {
    return { ok: true, content: applyToDoc(content, entry.operation) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "operation failed",
    };
  }
}
