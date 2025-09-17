/**
 * Operational Transform Domain Types
 *
 * Complex domain types for collaborative editing with operational transforms.
 * This module provides advanced OT algorithms, conflict resolution, and
 * document state management for real-time collaborative editing.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Complex domain modeling for OT
 */

import type { Id } from "@convex/_generated/dataModel";
import type {
  MeetingNote,
  Operation,
  OperationType,
  OperationWithMetadata,
  NoteOperation,
  NoteOperationResult,
  NoteSyncStatus,
  NoteCollaborationSession,
  NoteVersion,
  NoteExport,
  NoteAnalytics,
  NoteEvent,
  OperationStatus,
  OfflineOperationQueue,
  OfflineCheckpoint,
} from "../entities/note";

// Advanced OT domain types

// Document state with operational transform context
export interface DocumentState {
  content: string;
  version: number;
  lastRebasedAt: number;
  operations: OperationWithMetadata[];
  checkpoints: DocumentCheckpoint[];
}

// Document checkpoint for efficient state recovery
export interface DocumentCheckpoint {
  version: number;
  content: string;
  contentHash: string;
  operationCount: number;
  timestamp: number;
  authorId: Id<"users">;
}

// Operation transformation context
export interface TransformContext {
  baseVersion: number;
  targetVersion: number;
  concurrentOperations: Operation[];
  transformationPath: string[];
  conflicts: ConflictInfo[];
}

// Conflict information for resolution
export interface ConflictInfo {
  operationId: string;
  conflictType: "position" | "content" | "ordering" | "causality";
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  resolution: ConflictResolution;
  metadata: Record<string, any>;
}

// Conflict resolution strategies
export interface ConflictResolution {
  strategy: "auto" | "manual" | "priority" | "merge" | "reject";
  resolvedBy?: Id<"users">;
  resolvedAt?: number;
  resultingOperation?: Operation;
  notes?: string;
}

// Operation composition result
export interface CompositionResult {
  success: boolean;
  composedOperation?: Operation;
  reason?: string;
  metadata: {
    originalOperations: number;
    compressionRatio: number;
    preservedSemantics: boolean;
  };
}

// Transformation result with detailed information
export interface TransformationResult {
  transformedOperation: Operation;
  conflicts: ConflictInfo[];
  transformationSteps: TransformationStep[];
  metadata: {
    originalPosition: number;
    finalPosition: number;
    positionShift: number;
    contentModified: boolean;
  };
}

// Individual transformation step
export interface TransformationStep {
  stepNumber: number;
  againstOperation: Operation;
  beforeTransform: Operation;
  afterTransform: Operation;
  transformationType:
    | "position_shift"
    | "content_merge"
    | "length_adjust"
    | "no_change";
  explanation: string;
}

// Document synchronization state
export interface SyncState {
  meetingId: Id<"meetings">;
  clientId: string;
  serverVersion: number;
  clientVersion: number;
  acknowledgedSequence: number;
  pendingOperations: OperationWithMetadata[];
  inflightOperations: OperationWithMetadata[];
  lastSyncTimestamp: number;
  syncStatus: "synchronized" | "syncing" | "conflict" | "offline" | "error";
}

// Operational transform algorithm configuration
export interface OTAlgorithmConfig {
  conflictResolution:
    | "timestamp"
    | "author_priority"
    | "operation_type"
    | "custom";
  compositionEnabled: boolean;
  maxCompositionWindow: number;
  transformationOptimization: boolean;
  preserveIntentions: boolean;
  debugMode: boolean;
}

// Document merge result for complex scenarios
export interface DocumentMergeResult {
  success: boolean;
  mergedContent: string;
  mergedVersion: number;
  conflictsResolved: number;
  conflictsRemaining: ConflictInfo[];
  operationsApplied: number;
  mergeStrategy: "three_way" | "operational_transform" | "last_writer_wins";
  metadata: {
    mergeTimestamp: number;
    mergedBy: Id<"users">;
    branchesCount: number;
    totalOperations: number;
  };
}

// Real-time collaboration cursor and selection
export interface CollaborativeCursor {
  userId: Id<"users">;
  position: number;
  selection?: {
    start: number;
    end: number;
    direction: "forward" | "backward";
  };
  timestamp: number;
  visible: boolean;
  color?: string;
  label?: string;
}

// Collaborative awareness information
export interface CollaborativeAwareness {
  meetingId: Id<"meetings">;
  activeUsers: Map<string, CollaborativeCursor>;
  documentVersion: number;
  lastActivity: number;
  collaborationMetrics: {
    totalEditors: number;
    averageEditingTime: number;
    conflictRate: number;
    operationsPerMinute: number;
  };
}

// Operation priority calculation
export interface OperationPriority {
  timestamp: number;
  authorPriority: number;
  operationType: OperationType;
  contextualPriority: number;
  finalPriority: number;
  tieBreaker: string;
}

// Document history and versioning
export interface DocumentHistory {
  meetingId: Id<"meetings">;
  versions: DocumentVersion[];
  branches: DocumentBranch[];
  mergePoints: DocumentMergePoint[];
  totalOperations: number;
  createdAt: number;
  lastModified: number;
}

// Document version with full context
export interface DocumentVersion {
  version: number;
  content: string;
  contentHash: string;
  parentVersion?: number;
  operations: OperationWithMetadata[];
  timestamp: number;
  authorId: Id<"users">;
  changesSummary: {
    insertions: number;
    deletions: number;
    modifications: number;
    netChange: number;
  };
}

// Document branch for complex merge scenarios
export interface DocumentBranch {
  branchId: string;
  baseVersion: number;
  headVersion: number;
  operations: OperationWithMetadata[];
  authorId: Id<"users">;
  createdAt: number;
  mergedAt?: number;
  mergedInto?: string;
}

// Document merge point tracking
export interface DocumentMergePoint {
  mergeId: string;
  sourceVersions: number[];
  targetVersion: number;
  strategy: string;
  conflicts: ConflictInfo[];
  timestamp: number;
  mergedBy: Id<"users">;
}

// Operation validation result
export interface OperationValidationResult {
  valid: boolean;
  errors: OTValidationError[];
  warnings: OTValidationWarning[];
  metadata: {
    operationType: OperationType;
    positionValid: boolean;
    contentValid: boolean;
    lengthValid: boolean;
    semanticallyValid: boolean;
  };
}

// Validation error details
export interface OTValidationError {
  code: string;
  message: string;
  field: string;
  severity: "error" | "warning" | "info";
  suggestion?: string;
}

// Validation warning details
export interface OTValidationWarning {
  code: string;
  message: string;
  field: string;
  impact: "performance" | "usability" | "compatibility";
  recommendation?: string;
}

// Operation analytics and metrics
export interface OperationAnalytics {
  meetingId: Id<"meetings">;
  timeWindow: {
    start: number;
    end: number;
  };
  operationMetrics: {
    total: number;
    byType: Record<OperationType, number>;
    byAuthor: Record<string, number>;
    averageSize: number;
    conflictRate: number;
  };
  performanceMetrics: {
    averageTransformTime: number;
    averageApplyTime: number;
    peakOperationsPerSecond: number;
    memoryUsage: number;
  };
  collaborationMetrics: {
    concurrentEditors: number;
    sessionDuration: number;
    editingEfficiency: number;
    userSatisfaction?: number;
  };
}
