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

import { useEffect, useRef, useState } from "react";
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
  return [{ type: "delete", position: next.length, length: base.length - next.length }];
}

function isDefiniteRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /conflict|forbidden|unauthorized/i.test(message);
}

export function useDefectReplicaNotesLedger(
  meetingId: Id<"meetings">,
): UseNotesLedgerResult {
  const transport = useNotesTransport();
  // Emission pump: every state change re-renders, and the result object is
  // rebuilt fresh each render — D3 (unstable snapshots) at the hook surface.
  const [emission, setEmission] = useState(0);
  void emission;
  const state = useRef({
    serverContent: "",
    serverVersion: -1,
    buffer: "",
    bufferHoldsWords: false,
    inflight: null as Inflight | null,
    counter: 0,
    online: true,
    destroyed: false,
  });

  const flushBuffer = (): void => {
    const s = state.current;
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
    void transport
      .applyBatch(meetingId, "replica-client", {
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
        const after = state.current;
        after.inflight = null;
        after.bufferHoldsWords = false;
        setEmission((n) => n + 1);
      })
      .catch((error: unknown) => {
        const after = state.current;
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
        setEmission((n) => n + 1);
      });
    setEmission((n) => n + 1);
  };

  useEffect(() => {
    const unsubscribe = transport.subscribe(
      meetingId,
      "replica-client",
      (snapshot) => {
        const s = state.current;
        if (snapshot === undefined) {
          // D4: a loading result drops edits — the view resets and any
          // unsent/in-flight words vanish.
          s.serverContent = "";
          s.serverVersion = -1;
          s.inflight = null;
          s.buffer = "";
          s.bufferHoldsWords = false;
          setEmission((n) => n + 1);
          return;
        }
        if (snapshot.version < s.serverVersion) {
          // D4: a stale result drops edits and rewinds the view.
          s.inflight = null;
          s.buffer = "";
          s.bufferHoldsWords = false;
          s.serverContent = snapshot.content;
          s.serverVersion = snapshot.version;
          setEmission((n) => n + 1);
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
        if (s.bufferHoldsWords && !s.inflight) flushBuffer();
        setEmission((n) => n + 1);
      },
    );
    return () => {
      state.current.destroyed = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, meetingId]);

  const composed = (): string => {
    const s = state.current;
    if (s.inflight) return applyOperations(s.serverContent, s.inflight.ops);
    return s.serverContent;
  };

  return {
    content: composed(),
    version: state.current.serverVersion,
    isLoading: state.current.serverVersion < 0,
    status: (() => {
      const s = state.current;
      if (s.serverVersion < 0) return "loading" as const;
      if (!s.online) return "offline" as const;
      if (s.inflight) return "saving" as const;
      if (s.bufferHoldsWords) return "saving" as const;
      return "synced" as const;
    })(),
    unconfirmedCount: 0,
    unsavedRecords: (() => {
      const s = state.current;
      if (!s.inflight) return [];
      return s.inflight.ops.map((op, index) => ({
        clientOpId: s.inflight?.ids[index] as string,
        state: "sending" as const,
        content: op.content ?? "",
        attempts: 1,
      }));
    })(),
    isEditing: state.current.inflight !== null || state.current.bufferHoldsWords,
    // The defect replica predates the buffer semantics: it reports no
    // buffered words (its D7 defect drops them entirely).
    bufferedContent: "",
    onEdit: (text: string) => {
      const s = state.current;
      s.buffer = text;
      s.bufferHoldsWords = true;
      // A minimal debounce: the flush rides a microtask. D7: an unmount
      // inside this window drops the buffer — nothing is committed or
      // persisted, and the words are gone.
      queueMicrotask(() => {
        if (state.current.bufferHoldsWords) flushBuffer();
      });
      setEmission((n) => n + 1);
    },
    flushNow: () => {
      if (state.current.bufferHoldsWords) flushBuffer();
    },
    retryConflicts: () => {
      // The replica drops rejected batches entirely; there is nothing to retry.
    },
    transportOnline: state.current.online,
  };
}
