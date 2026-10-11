/**
 * Collaborative Notes Hook
 *
 * Hook for real-time collaborative note-taking with operational transforms.
 *
 * Features:
 * - Real-time note synchronization across participants
 * - Offline operation queueing
 * - Conflict resolution via operational transforms
 * - Optimistic updates for better UX
 *
 * Backend APIs:
 * - api.notes.queries.getMeetingNotes
 * - api.notes.mutations.applyNoteOperation
 * - api.notes.mutations.batchApplyNoteOperations
 */

"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useCallback, useRef, useState } from "react";

export interface MeetingNote {
  _id: Id<"meetingNotes">;
  meetingId: Id<"meetings">;
  content: string;
  version: number;
  lastEditedBy?: Id<"users">;
  lastEditedAt: number;
  createdAt: number;
}

export interface NoteOperation {
  type: "insert" | "delete" | "retain";
  position?: number;
  text?: string;
  length?: number;
}

export interface UseCollaborativeNotesResult {
  notes: MeetingNote | null | undefined;
  isLoading: boolean;
  isSyncing: boolean;
  applyOperation: (operation: NoteOperation) => Promise<void>;
  applyOperations: (operations: NoteOperation[]) => Promise<void>;
  content: string;
  version: number;
}

/**
 * Wire-format operation for the server contract of record
 * (convex/notes/mutations.ts, NoteV.operation): inserts carry `content`
 * (not this hook's `text`), every operation carries a numeric `position`,
 * and delete/retain carry `length`.
 */
export function toWireOperation(operation: NoteOperation) {
  const position = operation.position ?? 0;
  switch (operation.type) {
    case "insert":
      return { type: operation.type, position, content: operation.text ?? "" };
    case "delete":
      return { type: operation.type, position, length: operation.length ?? 0 };
    case "retain":
      return { type: operation.type, position, length: operation.length ?? 0 };
  }
}

/**
 * Builds the exact request shape for api.notes.mutations.applyNoteOperation:
 * `{ meetingId, operation, clientSequence }`.
 *
 * `clientSequence` is the client's last incorporated SERVER SEQUENCE — never
 * a timestamp. The server transforms the operation against every logged op
 * with a higher sequence, so under-reporting double-transforms (corrupts
 * positions) and over-reporting silently skips transforms.
 */
export function buildNoteOperationRequest(
  meetingId: Id<"meetings">,
  operation: NoteOperation,
  lastKnownSequence: number,
) {
  return {
    meetingId,
    operation: toWireOperation(operation),
    clientSequence: lastKnownSequence,
  };
}

/**
 * Builds the exact request shape for
 * api.notes.mutations.batchApplyNoteOperations: each element is wrapped as
 * `{ operation, clientSequence }` (a flat operation array is rejected by the
 * server validator). All elements share the batch's base sequence; the server
 * composes them in order within the transaction.
 */
export function buildBatchNoteOperationsRequest(
  meetingId: Id<"meetings">,
  operations: NoteOperation[],
  lastKnownSequence: number,
) {
  return {
    meetingId,
    operations: operations.map((op) => ({
      operation: toWireOperation(op),
      clientSequence: lastKnownSequence,
    })),
  };
}

/**
 * Hook for managing collaborative notes
 *
 * @param meetingId - The meeting ID to manage notes for
 * @returns Collaborative notes management utilities
 *
 * @example
 * ```tsx
 * function CollaborativeNotesEditor({ meetingId }) {
 *   const { content, applyOperation, isSyncing } = useCollaborativeNotes(meetingId);
 *   const [localContent, setLocalContent] = useState(content);
 *
 *   const handleChange = async (newText: string) => {
 *     // Update local state immediately for responsiveness
 *     setLocalContent(newText);
 *
 *     // Calculate operation (insert/delete)
 *     const operation = calculateOperation(content, newText);
 *
 *     // Sync to backend
 *     await applyOperation(operation);
 *   };
 *
 *   return (
 *     <div>
 *       <Textarea
 *         value={localContent}
 *         onChange={(e) => handleChange(e.target.value)}
 *         disabled={isSyncing}
 *       />
 *       {isSyncing && <SyncIndicator />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCollaborativeNotes(
  meetingId: Id<"meetings">,
): UseCollaborativeNotesResult {
  const [isSyncing, setIsSyncing] = useState(false);

  // Last server sequence this client has incorporated into its local state:
  // updated from every acked mutation response. Seeded from the fetched
  // note's version (single-op applies keep version and sequence in lockstep).
  const lastKnownSequenceRef = useRef(0);

  // Query current notes from backend
  const notes = useQuery(api.notes.queries.getMeetingNotes, { meetingId });

  // Mutations for applying operations
  const applyOperationMutation = useMutation(
    api.notes.mutations.applyNoteOperation,
  );
  const batchApplyMutation = useMutation(
    api.notes.mutations.batchApplyNoteOperations,
  );

  // Apply single operation
  const applyOperation = useCallback(
    async (operation: NoteOperation) => {
      setIsSyncing(true);

      try {
        const knownSequence = Math.max(
          lastKnownSequenceRef.current,
          notes?.version ?? 0,
        );
        const result = await applyOperationMutation(
          buildNoteOperationRequest(meetingId, operation, knownSequence),
        );
        if (result.success) {
          lastKnownSequenceRef.current = Math.max(
            lastKnownSequenceRef.current,
            result.serverSequence,
          );
        }
      } catch (err) {
        console.error("Failed to apply note operation:", err);
        throw err;
      } finally {
        setIsSyncing(false);
      }
    },
    [meetingId, applyOperationMutation, notes],
  );

  // Apply multiple operations in batch
  const applyOperations = useCallback(
    async (operations: NoteOperation[]) => {
      setIsSyncing(true);

      try {
        const knownSequence = Math.max(
          lastKnownSequenceRef.current,
          notes?.version ?? 0,
        );
        const result = await batchApplyMutation(
          buildBatchNoteOperationsRequest(meetingId, operations, knownSequence),
        );
        const maxServerSequence = result.results.reduce(
          (max, r) => Math.max(max, r.serverSequence),
          0,
        );
        lastKnownSequenceRef.current = Math.max(
          lastKnownSequenceRef.current,
          maxServerSequence,
        );
      } catch (err) {
        console.error("Failed to apply note operations batch:", err);
        throw err;
      } finally {
        setIsSyncing(false);
      }
    },
    [meetingId, batchApplyMutation, notes],
  );

  return {
    notes,
    isLoading: notes === undefined,
    isSyncing,
    applyOperation,
    applyOperations,
    content: notes?.content || "",
    version: notes?.version || 0,
  };
}

/**
 * Helper function to calculate operation difference between two strings
 * This is a simplified implementation - you may want a more sophisticated diff algorithm
 */
export function calculateOperation(
  oldText: string,
  newText: string,
): NoteOperation {
  // Simple implementation: if text is longer, it's an insert; if shorter, it's a delete
  if (newText.length > oldText.length) {
    // Find position of difference
    let position = 0;
    while (
      position < oldText.length &&
      oldText[position] === newText[position]
    ) {
      position++;
    }

    return {
      type: "insert",
      position,
      text: newText.substring(
        position,
        position + (newText.length - oldText.length),
      ),
    };
  } else if (newText.length < oldText.length) {
    // Find position of difference
    let position = 0;
    while (
      position < newText.length &&
      oldText[position] === newText[position]
    ) {
      position++;
    }

    return {
      type: "delete",
      position,
      length: oldText.length - newText.length,
    };
  } else {
    // Same length - treat as retain (no change)
    return {
      type: "retain",
      length: newText.length,
    };
  }
}
