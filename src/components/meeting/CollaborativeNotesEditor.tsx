/**
 * Collaborative Notes Editor Component
 * 
 * Real-time collaborative note-taking with operational transforms.
 * 
 * Features:
 * - Rich text editing with Markdown support
 * - Real-time synchronization across participants
 * - Offline operation queueing
 * - Sync status indicator
 * - Auto-save
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useCollaborativeNotes, calculateOperation } from "@/hooks/useCollaborativeNotes";
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
} from "lucide-react";
import { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";

interface CollaborativeNotesEditorProps {
  meetingId: Id<"meetings">;
  className?: string;
  readonly?: boolean;
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
    content: remoteContent,
  } = useCollaborativeNotes(meetingId);

  const [localContent, setLocalContent] = useState("");
  const [lastSyncedContent, setLastSyncedContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  // Initialize local content from remote
  useEffect(() => {
    if (remoteContent && localContent === "") {
      setLocalContent(remoteContent);
      setLastSyncedContent(remoteContent);
    }
  }, [remoteContent, localContent]);

  // Sync remote changes to local if not currently editing
  useEffect(() => {
    if (remoteContent !== lastSyncedContent && !isSaving) {
      setLocalContent(remoteContent);
      setLastSyncedContent(remoteContent);
    }
  }, [remoteContent, lastSyncedContent, isSaving]);

  const handleChange = useCallback(
    (newText: string) => {
      setLocalContent(newText);

      // Clear existing timeout
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      // Debounce save for 500ms
      const timeout = setTimeout(async () => {
        setIsSaving(true);
        
        try {
          // Calculate operation difference
          const operation = calculateOperation(lastSyncedContent, newText);
          
          // Apply operation to backend
          await applyOperation(operation);
          
          // Update last synced content
          setLastSyncedContent(newText);
        } catch (error) {
          console.error("Failed to save notes:", error);
          toast.error("Failed to save notes. Changes are queued for retry.");
        } finally {
          setIsSaving(false);
        }
      }, 500);

      setSaveTimeout(timeout);
    },
    [lastSyncedContent, applyOperation, saveTimeout]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  }, [saveTimeout]);

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

  const wordCount = localContent.trim().split(/\s+/).filter(Boolean).length;
  const charCount = localContent.length;

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

          <div className="flex items-center gap-2">
            {isSyncing || isSaving ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Cloud className="h-3 w-3 animate-pulse" />
                <span>Syncing...</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-green-600">
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
            value={localContent}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={
              readonly
                ? "No notes taken during this meeting"
                : "Start taking notes... (Supports Markdown)"
            }
            className="min-h-[300px] resize-y font-mono text-sm"
            disabled={readonly || isSyncing}
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>{wordCount} words</span>
              <span>{charCount} characters</span>
            </div>

            {notes && (
              <div className="flex items-center gap-1">
                <span>Version {notes.version}</span>
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