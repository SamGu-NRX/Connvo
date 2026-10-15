"use client";

/**
 * TEST-ONLY defect replica — the failing-before subject for the mounted
 * matrix (docs/notes-ledger-f1/design.md §5 "Failing-before evidence").
 *
 * It reimplements the #24-audited behaviors AS DESCRIBED in the audit table
 * (design.md's D1–D7) — written from those descriptions only; no old code
 * was read or copied. Each defect is marked with its audit id at the line
 * that exhibits it. The matrix cases assert the CORRECT behavior, so each
 * mapped case fails when run against this replica:
 *
 *   NOTES_MATRIX_SUBJECT=replica pnpm vitest run --project notes \
 *     test/notes/mountedMatrix.test.tsx
 *
 * test/notes/failingBefore.replica.test.tsx pins per-defect discriminator
 * scenarios (asserting the defect occurs) as always-green receipts.
 */

import { useEffect, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { applyOperations } from "@/hooks/notes/notesDiff";
import { useNotesTransport } from "@/hooks/notes/notesTransport";
import type { NotesOperation, UseNotesLedgerResult } from "@/hooks/notes/types";

interface Inflight {
  ops: NotesOperation[];
  ids: string[];
}

/**
 * D2 (length-only diff): an equal-length replacement produces NO ops at all,
 * and every other edit is expressed as a tail-only op — interior changes are
 * mangled into append/truncate shapes.
 */
function replicaDiff(base: string, next: string): NotesOperation[] {
  if (base.length === next.length) return [];
  if (next.length > base.length) {
    return [
      {
        type: "insert",
        position: base.length,
        content: next.slice(base.length),
      },
    ];
  }
  return [
    {
      type: "delete",
      position: next.length,
      length: base.length - next.length,
    },
  ];
}

function isDefiniteRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /conflict|forbidden|unauthorized/i.test(message);
}

class DefectReplicaEngine {
  serverContent = "";
  serverVersion = -1;
  buffer = "";
  bufferHoldsWords = false;
  inflight: Inflight | null = null;
  counter = 0;
  online = true;
  destroyed = false;
  private transport!: ReturnType<typeof useNotesTransport>;
  private meetingId!: Id<"meetings">;
  private emit: () => void = () => {};

  flushBuffer = (): void => {
    const s = this;
    if (s.inflight) return;
    // D7: a teardown inside the debounce window drops the buffer — the
    // words are never committed, sent, or persisted.
    if (s.destroyed) {
      s.buffer = "";
      s.bufferHoldsWords = false;
      return;
    }
    const ops = replicaDiff(s.serverContent, s.buffer);
    if (ops.length === 0) {
      s.bufferHoldsWords = false;
      return;
    }
    s.inflight = { ops, ids: ops.map(() => `replica-op-${++s.counter}`) };
    void this.transport
      .applyBatch(this.meetingId, "replica-client", {
        // D5: clientSequence is a LOCAL per-op counter, not the incorporated
        // server-history watermark — the server transforms against the wrong
        // basis whenever real history exists.
        operations: ops.map((op, index) => ({
          operation: op,
          clientSequence: ++s.counter,
          clientOpId: s.inflight?.ids[index] as string,
        })),
      })
      .then(() => {
        // D1 (blanket retirement): any successful response retires the whole
        // batch — the per-op echo is never inspected.
        const after = this;
        after.inflight = null;
        after.bufferHoldsWords = false;
        this.emit();
      })
      .catch((error: unknown) => {
        const after = this;
        if (isDefiniteRejection(error)) {
          // Definite server refusal: the batch is dropped — the user's words
          // vanish (no visible unsaved list, no retry surface).
          after.inflight = null;
          after.bufferHoldsWords = false;
        } else {
          // Unreachable: words stay in the buffer and are re-diffed — under
          // NEW clientOpIds (D5: no stable operation identity) — at the next
          // snapshot-triggered flush.
          after.inflight = null;
          after.online = false;
        }
        this.emit();
      });
    this.emit();
  };

  subscribe(
    transport: ReturnType<typeof useNotesTransport>,
    meetingId: Id<"meetings">,
    emit: () => void,
  ) {
    this.transport = transport;
    this.meetingId = meetingId;
    this.emit = emit;
    const unsubscribe = transport.subscribe(
      meetingId,
      "replica-client",
      (snapshot) => {
        const s = this;
        if (snapshot === undefined) {
          // D4: a loading result drops edits — the view resets and any
          // unsent/in-flight words vanish.
          s.serverContent = "";
          s.serverVersion = -1;
          s.inflight = null;
          s.buffer = "";
          s.bufferHoldsWords = false;
          this.emit();
          return;
        }
        if (snapshot.version < s.serverVersion) {
          // D4: a stale result drops edits and rewinds the view.
          s.inflight = null;
          s.buffer = "";
          s.bufferHoldsWords = false;
          s.serverContent = snapshot.content;
          s.serverVersion = snapshot.version;
          this.emit();
          return;
        }
        // D4 (no monotonic ingest): ANY fresh snapshot is adopted wholesale.
        s.serverContent = snapshot.content;
        s.serverVersion = snapshot.version;
        s.online = true;
        // D6: matching text is taken as confirmation (invented acceptance
        // history via includes() evidence).
        if (s.inflight) {
          const allLookApplied = s.inflight.ops.every(
            (op) =>
              op.type !== "insert" ||
              snapshot.content.includes(op.content ?? ""),
          );
          if (allLookApplied) s.inflight = null;
        }
        // Reconnect behavior: a buffered flush rides the fresh read.
        if (s.bufferHoldsWords && !s.inflight) this.flushBuffer();
        this.emit();
      },
    );
    return () => {
      this.destroyed = true;
      unsubscribe();
    };
  }

  getSnapshot(): UseNotesLedgerResult {
    const composed = (): string => {
      const s = this;
      if (s.inflight) return applyOperations(s.serverContent, s.inflight.ops);
      return s.serverContent;
    };

    return {
      content: composed(),
      version: this.serverVersion,
      isLoading: this.serverVersion < 0,
      status: (() => {
        const s = this;
        if (s.serverVersion < 0) return "loading" as const;
        if (!s.online) return "offline" as const;
        if (s.inflight) return "saving" as const;
        if (s.bufferHoldsWords) return "saving" as const;
        return "synced" as const;
      })(),
      unconfirmedCount: 0,
      unsavedRecords: (() => {
        const s = this;
        if (!s.inflight) return [];
        return s.inflight.ops.map((op, index) => ({
          clientOpId: s.inflight?.ids[index] as string,
          state: "sending" as const,
          content: op.content ?? "",
          attempts: 1,
        }));
      })(),
      isEditing: this.inflight !== null || this.bufferHoldsWords,
      // The defect replica predates the buffer semantics: it reports no
      // buffered words (its D7 defect drops them entirely).
      bufferedContent: "",
      onEdit: (text: string) => {
        const s = this;
        s.buffer = text;
        s.bufferHoldsWords = true;
        // A minimal debounce: the flush rides a microtask. D7: an unmount
        // inside this window drops the buffer — nothing is committed or
        // persisted, and the words are gone.
        queueMicrotask(() => {
          if (this.bufferHoldsWords) this.flushBuffer();
        });
        this.emit();
      },
      flushNow: () => {
        if (this.bufferHoldsWords) this.flushBuffer();
      },
      retryConflicts: () => {
        // The replica drops rejected batches entirely; there is nothing to retry.
      },
      transportOnline: this.online,
    };
  }
}

export function useDefectReplicaNotesLedger(
  meetingId: Id<"meetings">,
): UseNotesLedgerResult {
  const transport = useNotesTransport();
  const [engine] = useState(() => new DefectReplicaEngine());
  // D3: emissions still rebuild the result object, including idempotent reads.
  const [, setEmission] = useState(0);
  useEffect(
    () =>
      engine.subscribe(transport, meetingId, () => setEmission((n) => n + 1)),
    [engine, transport, meetingId],
  );
  return engine.getSnapshot();
}
