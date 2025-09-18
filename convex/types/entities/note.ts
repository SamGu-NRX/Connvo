/**
 * Note and Operational Transform Entity Type Definitions
 *
 * This module defines note-related entity types and operational transform
 * types for collaborative editing functionality.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Complex domain modeling for collaborative editing
 */

import type { Id } from "@convex/_generated/dataModel";

// Operational Transform types (matches schema exactly)
export type OperationType = "insert" | "delete" | "retain";

// Operation status for offline support
export type OperationStatus = "pending" | "syncing" | "synced" | "failed";

// Basic operation interface
export interface Operation {
  type: OperationType;
  position: number;
  content?: string;
  length?: number;
}

// Operation with metadata for tracking
export interface OperationWithMetadata extends Operation {
  id: string;
  authorId: Id<"users">;
  timestamp: number;
  sequence: number;
  transformedFrom?: string[];
}

// Note operation entity (matches convex/schema/meetings.ts exactly)
export interface NoteOperation {
  _id: Id<"noteOps">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  sequence: number;
  authorId: Id<"users">;
  operation: Operation;
  timestamp: number;
  applied: boolean;
}

// Meeting note entity (matches schema exactly)
export interface MeetingNote {
  _id: Id<"meetingNotes">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  content: string;
  version: number;
  lastRebasedAt: number;
  updatedAt: number;
}

// Offline operation queue (matches convex/schema/offline.ts exactly)
export interface OfflineOperationQueue {
  _id: Id<"offlineOperationQueue">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  clientId: string;
  queueId: string;
  operation: Operation;
  operationId: string;
  authorId: Id<"users">;
  clientSequence: number;
  timestamp: number;
  queuedAt: number;
  attempts: number;
  lastAttempt?: number;
  error?: string;
  status: OperationStatus;
}

// Offline checkpoint (matches schema exactly)
export interface OfflineCheckpoint {
  _id: Id<"offlineCheckpoints">;
  _creationTime: number; // Convex system field
  checkpointId: string;
  meetingId: Id<"meetings">;
  clientId: string;
  sequence: number;
  version: number;
  contentHash: string;
  timestamp: number;
  createdAt: number;
}

// API response types

// Note operation result
export interface NoteOperationResult {
  success: boolean;
  serverSequence: number;
  transformedOperation: Operation;
  newVersion: number;
  conflicts: string[];
}

// Note synchronization status
export interface NoteSyncStatus {
  meetingId: Id<"meetings">;
  clientId: string;
  serverVersion: number;
  clientVersion: number;
  pendingOperations: number;
  lastSyncAt: number;
  syncInProgress: boolean;
  conflicts: Array<{
    operationId: string;
    description: string;
    resolution: "auto" | "manual" | "pending";
  }>;
}

// Note collaboration session
export interface NoteCollaborationSession {
  meetingId: Id<"meetings">;
  activeUsers: Array<{
    userId: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
    cursor?: {
      position: number;
      selection?: {
        start: number;
        end: number;
      };
    };
    lastActivity: number;
  }>;
  totalOperations: number;
  currentVersion: number;
  lastActivity: number;
}

// Note history and versioning
export interface NoteVersion {
  version: number;
  content: string;
  authorId: Id<"users">;
  timestamp: number;
  operationCount: number;
  changesSummary: {
    insertions: number;
    deletions: number;
    modifications: number;
  };
}

// Note export formats
export interface NoteExport {
  meetingId: Id<"meetings">;
  format: "markdown" | "html" | "txt" | "pdf";
  content: string;
  metadata: {
    version: number;
    totalOperations: number;
    contributors: Array<{
      userId: Id<"users">;
      displayName?: string;
      contributionCount: number;
    }>;
    exportedAt: number;
    exportedBy: Id<"users">;
  };
}

// Note analytics
export interface NoteAnalytics {
  meetingId: Id<"meetings">;
  totalOperations: number;
  operationsByType: Record<OperationType, number>;
  operationsByUser: Record<string, number>;
  averageOperationSize: number;
  collaborationMetrics: {
    totalCollaborators: number;
    averageSessionDuration: number;
    conflictRate: number;
    resolutionTime: number;
  };
  contentMetrics: {
    finalWordCount: number;
    finalCharacterCount: number;
    maxConcurrentEditors: number;
    editingTimespan: number;
  };
}

// Real-time note events
export interface NoteEvent {
  type:
    | "operation_applied"
    | "user_joined"
    | "user_left"
    | "cursor_moved"
    | "conflict_detected";
  meetingId: Id<"meetings">;
  userId?: Id<"users">;
  operationId?: string;
  data?: any;
  timestamp: number;
}
