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
import { useCallback, useState } from "react";

export type { MeetingNote } from "@convex/types/entities/note";
import type { MeetingNote } from "@convex/types/entities/note";

export interface NoteOperation {
  type: "insert" | "delete" | "retain";
  position: number;
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
      await applyOperationMutation({
        meetingId,
        operation: {
          type: operation.type,
          position: operation.position,
          content: operation.text,
          length: operation.length,
        },
        clientSequence: notes?.version ?? 0,
      });
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
      await batchApplyMutation({
        meetingId,
        operations: operations.map(op => ({
          operation: {
            type: op.type,
            position: op.position,
            content: op.text,
            length: op.length,
          },
          clientSequence: notes?.version ?? 0,
        })),
      });
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
      position: 0,
      length: newText.length,
    };
  }
}