/**
 * Collaborative Notes Editor Component
 *
 * Real-time collaborative note-taking with operational transforms.
 *
 * Features:
 * - Rich text editing with Markdown support
 * - Real-time synchronization across participants
 * - Offline operation queueing (typing never blocks on the network)
 * - Explicit per-edit state: Saving… / Saved / Syncing / Unsaved (N pending)
 *   / Conflict / Rolled back — driven by the operation ledger, so a lost
 *   ack or a rejected edit is visible instead of silent
 * - The user's words are never silently discarded: rejected edits stay
 *   readable in the unsaved-edits list while the document rolls back to
 *   the last server-confirmed content
 * - Keyboard accessible: the textarea keeps native keyboard behavior, and
 *   the status region is a polite live region
 * - Transitions are subtle and disabled under reduced motion
 */

"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  useCollaborativeNotes,
  calculateOperation,
} from "@/hooks/useCollaborativeNotes";
import type { NoteOperationRecord } from "@/hooks/collaborativeNotesLedger";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Cloud,
  CloudOff,
  Save,
  Users,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";

interface CollaborativeNotesEditorProps {
  meetingId: Id<"meetings">;
  className?: string;
  readonly?: boolean;
}

/** Status precedence: the most severe, most specific state wins. */
type EditorStatus =
  | "conflict"
  | "rolled-back"
  | "unsaved"
  | "syncing"
  | "saving"
  | "saved";

const STATUS_LABELS: Record<EditorStatus, string> = {
  conflict: "Conflict",
  "rolled-back": "Rolled back",
  unsaved: "Unsaved",
  syncing: "Syncing",
  saving: "Saving…",
  saved: "Saved",
};

const UNSAVED_STATE_LABELS: Record<string, string> = {
  pending: "Unsaved",
  syncing: "Syncing",
  unconfirmed: "Unconfirmed",
  rejected: "Rolled back",
  conflict: "Conflict",
};

/** Pure derivation of the aggregate editor status from the ledger state. */
export function deriveEditorStatus(
  records: NoteOperationRecord[],
  isSyncing: boolean,
  isSaving: boolean
): EditorStatus {
  const states = records.map((record) => record.state);
  if (states.includes("conflict")) return "conflict";
  if (states.includes("rejected")) return "rolled-back";
  const pendingCount = records.filter(
    (record) => record.state === "pending" || record.state === "unconfirmed"
  ).length;
  if (pendingCount > 0) return "unsaved";
  if (isSyncing) return "syncing";
  if (isSaving) return "saving";
  return "saved";
}

export function CollaborativeNotesEditor({
  meetingId,
  className,
  readonly = false,
}: CollaborativeNotesEditorProps) {
  const {
    notes,
    isLoading,
    isSyncing,
    applyOperation,
    content: composedContent,
    operationRecords,
    pendingOperationCount,
    version,
  } = useCollaborativeNotes(meetingId);

  // While the user is typing, the textarea shows the edit buffer; otherwise
  // it follows the hook's composed content (server truth + optimistic ops).
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const value = editBuffer ?? composedContent;

  // Content the next diff is computed against: what the composed document
  // was at the last flush (server truth + previously queued ops).
  const lastFlushedRef = useRef(composedContent);
  useEffect(() => {
    // Follow the composed document whenever the user is not mid-edit.
    if (editBuffer === null) {
      lastFlushedRef.current = composedContent;
    }
  }, [composedContent, editBuffer]);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleChange = useCallback(
    (newText: string) => {
      setEditBuffer(newText);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Debounce saves for 500ms so bursts of keystrokes become one op.
      debounceRef.current = setTimeout(() => {
        setIsSaving(true);
        const operation = calculateOperation(lastFlushedRef.current, newText);
        const isNoop = operation.type === "retain";
        const flush = async () => {
          try {
            if (!isNoop) {
              await applyOperation(operation);
            }
            lastFlushedRef.current = newText;
            setEditBuffer(null);
          } catch (error) {
            // The ledger keeps the rejected edit's words; the document
            // rolled back. Surface it inline (status + list) and once via
            // toast — the error is state now, not only a console line.
            console.error("Failed to save notes:", error);
            toast.error(
              "Some edits could not be saved. Your text is kept below as unsaved work."
            );
          } finally {
            setIsSaving(false);
          }
        };
        void flush();
      }, 500);
    },
    [applyOperation]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const records = [...operationRecords.values()];
  const status = deriveEditorStatus(records, isSyncing, isSaving);
  const unsavedRecords = records.filter(
    (record) => record.state !== "saved"
  );
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  const charCount = value.length;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-500" />
            <CardTitle>Shared Notes</CardTitle>
            <Badge variant="secondary" className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              Collaborative
            </Badge>
          </div>

          {/* Explicit per-edit status; polite live region so keyboard and
           * screen-reader users get the same state transition feedback. */}
          <div
            role="status"
            aria-live="polite"
            aria-label={`Notes sync status: ${STATUS_LABELS[status]}${
              status === "unsaved" ? ` (${pendingOperationCount} pending)` : ""
            }`}
            className="flex items-center gap-1 text-xs"
          >
            {(status === "saving" || status === "syncing") && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Cloud className="h-3 w-3 motion-safe:animate-pulse" />
                <span>{STATUS_LABELS[status]}</span>
              </div>
            )}
            {status === "unsaved" && (
              <div className="flex items-center gap-1 text-yellow-600">
                <CloudOff className="h-3 w-3" />
                <span>
                  Unsaved ({pendingOperationCount} pending)
                </span>
              </div>
            )}
            {status === "conflict" && (
              <div className="flex items-center gap-1 text-orange-600">
                <AlertTriangle className="h-3 w-3" />
                <span>Conflict</span>
              </div>
            )}
            {status === "rolled-back" && (
              <div className="flex items-center gap-1 text-red-600">
                <RotateCcw className="h-3 w-3" />
                <span>Rolled back</span>
              </div>
            )}
            {status === "saved" && (
              <div className="flex items-center gap-1 text-green-600">
                <Save className="h-3 w-3" />
                <span>Saved</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          <Textarea
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={
              readonly
                ? "No notes taken during this meeting"
                : "Start taking notes... (Supports Markdown)"
            }
            className="min-h-[300px] resize-y font-mono text-sm"
            disabled={readonly}
            aria-label="Shared meeting notes"
          />

          {/* Explicit unsaved-work list: the user's words stay visible even
           * when an edit was rejected or is waiting to sync. Read-only list
           * content — no keyboard traps, nothing focusable. */}
          {unsavedRecords.length > 0 && (
            <section
              aria-label="Unsaved edits"
              className="rounded-lg border bg-muted/50 p-3"
            >
              <ul className="space-y-1 text-xs text-muted-foreground">
                {unsavedRecords.map((record) => (
                  <li
                    key={record.ledgerKey}
                    className="flex items-center gap-2"
                  >
                    <span className="font-medium">
                      {UNSAVED_STATE_LABELS[record.state] ?? record.state}:
                    </span>
                    <span className="font-mono">
                      {record.content.length > 0
                        ? record.content
                        : `(delete of ${record.operation.length ?? 0} chars)`}
                    </span>
                    {record.attempts > 1 && (
                      <span>
                        (attempt {record.attempts})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>{wordCount} words</span>
              <span>{charCount} characters</span>
            </div>

            {notes && (
              <div className="flex items-center gap-1">
                <span>Version {version}</span>
              </div>
            )}
          </div>

          {!readonly && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                <strong>Tips:</strong> These notes are shared with all participants in real-time.
                Use Markdown for formatting: **bold**, *italic*, `code`, - bullets.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default CollaborativeNotesEditor;
