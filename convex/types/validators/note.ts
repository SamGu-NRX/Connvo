/**
 * Note and Operational Transform Validators
 *
 * This module provides Convex validators that correspond to the Note entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Complex domain validators for collaborative editing
 */

import { v } from "convex/values";
import type {
  Operation,
  OperationWithMetadata,
  NoteOperation,
  MeetingNote,
  OfflineOperationQueue,
  OfflineCheckpoint,
  NoteOperationResult,
  NoteSyncStatus,
  NoteCollaborationSession,
  NoteVersion,
  NoteExport,
  NoteAnalytics,
  NoteEvent,
} from "../entities/note";

// Operation type validator
const operationTypeV = v.union(
  v.literal("insert"),
  v.literal("delete"),
  v.literal("retain"),
);

// Operation status validator
const operationStatusV = v.union(
  v.literal("pending"),
  v.literal("syncing"),
  v.literal("synced"),
  v.literal("failed"),
);

// Basic operation validator
const operationV = v.object({
  type: operationTypeV,
  position: v.number(),
  content: v.optional(v.string()),
  length: v.optional(v.number()),
});

// Core Note validators
export const NoteV = {
  // Basic operation
  operation: operationV,

  // Operation with metadata
  operationWithMetadata: v.object({
    type: operationTypeV,
    position: v.number(),
    content: v.optional(v.string()),
    length: v.optional(v.number()),
    id: v.string(),
    authorId: v.id("users"),
    timestamp: v.number(),
    sequence: v.number(),
    transformedFrom: v.optional(v.array(v.string())),
  }),

  // Note operation entity (matches schema exactly)
  noteOperation: v.object({
    _id: v.id("noteOps"),
    meetingId: v.id("meetings"),
    sequence: v.number(),
    authorId: v.id("users"),
    operation: operationV,
    timestamp: v.number(),
    applied: v.boolean(),
  }),

  // Meeting note entity (matches schema exactly)
  meetingNote: v.object({
    _id: v.id("meetingNotes"),
    meetingId: v.id("meetings"),
    content: v.string(),
    version: v.number(),
    lastRebasedAt: v.number(),
    updatedAt: v.number(),
  }),

  // Operation result
  operationResult: v.object({
    success: v.boolean(),
    serverSequence: v.number(),
    transformedOperation: operationV,
    newVersion: v.number(),
    conflicts: v.array(v.string()),
  }),

  // Batch note operation (for batch processing)
  batchOperation: v.object({
    authorId: v.id("users"),
    operation: operationV,
    clientSequence: v.number(),
    serverSequence: v.number(),
    expectedVersion: v.number(),
    timestamp: v.number(),
  }),
} as const;

// Offline Operation Queue validators (matches schema exactly)
export const OfflineOperationQueueV = {
  full: v.object({
    _id: v.id("offlineOperationQueue"),
    meetingId: v.id("meetings"),
    clientId: v.string(),
    queueId: v.string(),
    operation: operationV,
    operationId: v.string(),
    authorId: v.id("users"),
    clientSequence: v.number(),
    timestamp: v.number(),
    queuedAt: v.number(),
    attempts: v.number(),
    lastAttempt: v.optional(v.number()),
    error: v.optional(v.string()),
    status: operationStatusV,
  }),
} as const;

// Offline Checkpoint validators (matches schema exactly)
export const OfflineCheckpointV = {
  full: v.object({
    _id: v.id("offlineCheckpoints"),
    checkpointId: v.string(),
    meetingId: v.id("meetings"),
    clientId: v.string(),
    sequence: v.number(),
    version: v.number(),
    contentHash: v.string(),
    timestamp: v.number(),
    createdAt: v.number(),
  }),
} as const;

// Note Sync Status validators
export const NoteSyncStatusV = {
  full: v.object({
    meetingId: v.id("meetings"),
    clientId: v.string(),
    serverVersion: v.number(),
    clientVersion: v.number(),
    pendingOperations: v.number(),
    lastSyncAt: v.number(),
    syncInProgress: v.boolean(),
    conflicts: v.array(
      v.object({
        operationId: v.string(),
        description: v.string(),
        resolution: v.union(
          v.literal("auto"),
          v.literal("manual"),
          v.literal("pending"),
        ),
      }),
    ),
  }),
} as const;

// Note Collaboration Session validators
export const NoteCollaborationSessionV = {
  full: v.object({
    meetingId: v.id("meetings"),
    activeUsers: v.array(
      v.object({
        userId: v.id("users"),
        displayName: v.optional(v.string()),
        avatarUrl: v.optional(v.string()),
        cursor: v.optional(
          v.object({
            position: v.number(),
            selection: v.optional(
              v.object({
                start: v.number(),
                end: v.number(),
              }),
            ),
          }),
        ),
        lastActivity: v.number(),
      }),
    ),
    totalOperations: v.number(),
    currentVersion: v.number(),
    lastActivity: v.number(),
  }),
} as const;

// Note Version validators
export const NoteVersionV = {
  full: v.object({
    version: v.number(),
    content: v.string(),
    authorId: v.id("users"),
    timestamp: v.number(),
    operationCount: v.number(),
    changesSummary: v.object({
      insertions: v.number(),
      deletions: v.number(),
      modifications: v.number(),
    }),
  }),
} as const;

// Note Export validators
export const NoteExportV = {
  full: v.object({
    meetingId: v.id("meetings"),
    format: v.union(
      v.literal("markdown"),
      v.literal("html"),
      v.literal("txt"),
      v.literal("pdf"),
    ),
    content: v.string(),
    metadata: v.object({
      version: v.number(),
      totalOperations: v.number(),
      contributors: v.array(
        v.object({
          userId: v.id("users"),
          displayName: v.optional(v.string()),
          contributionCount: v.number(),
        }),
      ),
      exportedAt: v.number(),
      exportedBy: v.id("users"),
    }),
  }),
} as const;

// Note Analytics validators
export const NoteAnalyticsV = {
  full: v.object({
    meetingId: v.id("meetings"),
    totalOperations: v.number(),
    operationsByType: v.record(v.string(), v.number()), // OperationType -> count
    operationsByUser: v.record(v.string(), v.number()),
    averageOperationSize: v.number(),
    collaborationMetrics: v.object({
      totalCollaborators: v.number(),
      averageSessionDuration: v.number(),
      conflictRate: v.number(),
      resolutionTime: v.number(),
    }),
    contentMetrics: v.object({
      finalWordCount: v.number(),
      finalCharacterCount: v.number(),
      maxConcurrentEditors: v.number(),
      editingTimespan: v.number(),
    }),
  }),
} as const;

// Note Event validators
export const NoteEventV = {
  full: v.object({
    type: v.union(
      v.literal("operation_applied"),
      v.literal("user_joined"),
      v.literal("user_left"),
      v.literal("cursor_moved"),
      v.literal("conflict_detected"),
    ),
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    operationId: v.optional(v.string()),
    data: v.optional(v.any()),
    timestamp: v.number(),
  }),
} as const;
