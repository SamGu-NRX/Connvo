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

/**
 * Maps the hook's NoteOperation to the NoteV.operation shape that the
 * server-side note mutations validate (convex/types/validators/note.ts):
 * insert carries `content`, delete/retain carry `length`, and `position`
 * is required (calculateOperation omits it for retain, so it defaults to 0).
 * The fields the server does not know (the hook's raw text field and the
 * wall-clock timestamp field) must not leak through — they cause validator
 * rejection.
 */
export function toServerOperation(operation: NoteOperation): {
  type: "insert" | "delete" | "retain";
  position: number;
  content?: string;
  length?: number;
} {
  const position = operation.position ?? 0;
  switch (operation.type) {
    case "insert":
      return {
        type: operation.type,
        position,
        content: operation.text ?? "",
      };
    case "delete":
    case "retain":
      return {
        type: operation.type,
        position,
        length: operation.length ?? 0,
      };
  }
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
  meetingId: Id<"meetings">
): UseCollaborativeNotesResult {
  const [isSyncing, setIsSyncing] = useState(false);

  // Watermark of the last server sequence this client's local state
  // incorporates. The notes query carries no sequence info, so it starts at
  // 0 (no server history incorporated) and advances from mutation
  // responses — the first observed server state.
  const clientSequenceRef = useRef(0);

  // Query current notes from backend
  const notes = useQuery(
    api.notes.queries.getMeetingNotes,
    { meetingId }
  );

  // Mutations for applying operations
  const applyOperationMutation = useMutation(api.notes.mutations.applyNoteOperation);
  const batchApplyMutation = useMutation(api.notes.mutations.batchApplyNoteOperations);

  // Apply single operation
  const applyOperation = useCallback(async (operation: NoteOperation) => {
    setIsSyncing(true);
    
    try {
      const result = await applyOperationMutation({
        meetingId,
        operation: toServerOperation(operation),
        // Watermark: sequence of the last server op the local state
        // incorporates (see clientSequenceRef below).
        clientSequence: clientSequenceRef.current,
        // Optimistic concurrency: the version this hook last observed.
        expectedVersion: notes?.version,
      });
      // Advance the watermark: the local state now incorporates the
      // operation the server just sequenced.
      if (result && typeof result.serverSequence === "number") {
        clientSequenceRef.current = result.serverSequence;
      }
    } catch (err) {
      console.error("Failed to apply note operation:", err);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [meetingId, applyOperationMutation, notes?.version]);

  // Apply multiple operations in batch
  const applyOperations = useCallback(async (operations: NoteOperation[]) => {
    setIsSyncing(true);
    
    try {
      const result = await batchApplyMutation({
        meetingId,
        operations: operations.map((op, index) => ({
          operation: toServerOperation(op),
          // After sibling op i is applied server-side, the local state
          // incorporates it, so each op's clientSequence advances by one to
          // keep siblings out of each other's concurrent-transform sets.
          clientSequence: clientSequenceRef.current + index,
        })),
        expectedVersion: notes?.version,
      });
      const lastResult = result?.results?.[result.results.length - 1];
      if (lastResult && typeof lastResult.serverSequence === "number") {
        clientSequenceRef.current = lastResult.serverSequence;
      }
    } catch (err) {
      console.error("Failed to apply note operations batch:", err);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [meetingId, batchApplyMutation, notes?.version]);

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
export function calculateOperation(oldText: string, newText: string): NoteOperation {
  // Simple implementation: if text is longer, it's an insert; if shorter, it's a delete
  if (newText.length > oldText.length) {
    // Find position of difference
    let position = 0;
    while (position < oldText.length && oldText[position] === newText[position]) {
      position++;
    }
    
    return {
      type: "insert",
      position,
      text: newText.substring(position, position + (newText.length - oldText.length)),
    };
  } else if (newText.length < oldText.length) {
    // Find position of difference
    let position = 0;
    while (position < newText.length && oldText[position] === newText[position]) {
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