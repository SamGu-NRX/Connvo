/**
 * Operational Transform Domain Validators
 *
 * Convex validators for complex operational transform domain types.
 * These validators ensure runtime type safety for advanced OT operations.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Complex domain validators for OT
 */

import { v } from "convex/values";
import type {
  DocumentState,
  DocumentCheckpoint,
  TransformContext,
  ConflictInfo,
  ConflictResolution,
  CompositionResult,
  TransformationResult,
  TransformationStep,
  SyncState,
  OTAlgorithmConfig,
  DocumentMergeResult,
  CollaborativeCursor,
  CollaborativeAwareness,
  OperationPriority,
  DocumentHistory,
  DocumentVersion,
  DocumentBranch,
  DocumentMergePoint,
  OperationValidationResult,
  OTValidationError,
  OTValidationWarning,
  OperationAnalytics,
} from "@convex/types/domain/operationalTransform";

// Re-export basic validators from note validators
export { NoteV, OfflineOperationQueueV, OfflineCheckpointV } from "./note";

// Operation type validator
const operationTypeV = v.union(
  v.literal("insert"),
  v.literal("delete"),
  v.literal("retain"),
);

// Basic operation validator
const operationV = v.object({
  type: operationTypeV,
  position: v.number(),
  content: v.optional(v.string()),
  length: v.optional(v.number()),
});

// Operation with metadata validator
const operationWithMetadataV = v.object({
  type: operationTypeV,
  position: v.number(),
  content: v.optional(v.string()),
  length: v.optional(v.number()),
  id: v.string(),
  authorId: v.id("users"),
  timestamp: v.number(),
  sequence: v.number(),
  transformedFrom: v.optional(v.array(v.string())),
});

// Document State validators
export const DocumentStateV = {
  full: v.object({
    content: v.string(),
    version: v.number(),
    lastRebasedAt: v.number(),
    operations: v.array(operationWithMetadataV),
    checkpoints: v.array(
      v.object({
        version: v.number(),
        content: v.string(),
        contentHash: v.string(),
        operationCount: v.number(),
        timestamp: v.number(),
        authorId: v.id("users"),
      }),
    ),
  }),

  checkpoint: v.object({
    version: v.number(),
    content: v.string(),
    contentHash: v.string(),
    operationCount: v.number(),
    timestamp: v.number(),
    authorId: v.id("users"),
  }),
} as const;

// Transform Context validators
export const TransformContextV = {
  full: v.object({
    baseVersion: v.number(),
    targetVersion: v.number(),
    concurrentOperations: v.array(operationV),
    transformationPath: v.array(v.string()),
    conflicts: v.array(
      v.object({
        operationId: v.string(),
        conflictType: v.union(
          v.literal("position"),
          v.literal("content"),
          v.literal("ordering"),
          v.literal("causality"),
        ),
        description: v.string(),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical"),
        ),
        resolution: v.object({
          strategy: v.union(
            v.literal("auto"),
            v.literal("manual"),
            v.literal("priority"),
            v.literal("merge"),
            v.literal("reject"),
          ),
          resolvedBy: v.optional(v.id("users")),
          resolvedAt: v.optional(v.number()),
          resultingOperation: v.optional(operationV),
          notes: v.optional(v.string()),
        }),
        metadata: v.record(v.string(), v.any()),
      }),
    ),
  }),
} as const;

// Conflict Info validators
export const ConflictInfoV = {
  full: v.object({
    operationId: v.string(),
    conflictType: v.union(
      v.literal("position"),
      v.literal("content"),
      v.literal("ordering"),
      v.literal("causality"),
    ),
    description: v.string(),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    resolution: v.object({
      strategy: v.union(
        v.literal("auto"),
        v.literal("manual"),
        v.literal("priority"),
        v.literal("merge"),
        v.literal("reject"),
      ),
      resolvedBy: v.optional(v.id("users")),
      resolvedAt: v.optional(v.number()),
      resultingOperation: v.optional(operationV),
      notes: v.optional(v.string()),
    }),
    metadata: v.record(v.string(), v.any()),
  }),

  resolution: v.object({
    strategy: v.union(
      v.literal("auto"),
      v.literal("manual"),
      v.literal("priority"),
      v.literal("merge"),
      v.literal("reject"),
    ),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    resultingOperation: v.optional(operationV),
    notes: v.optional(v.string()),
  }),
} as const;

// Composition Result validators
export const CompositionResultV = {
  full: v.object({
    success: v.boolean(),
    composedOperation: v.optional(operationV),
    reason: v.optional(v.string()),
    metadata: v.object({
      originalOperations: v.number(),
      compressionRatio: v.number(),
      preservedSemantics: v.boolean(),
    }),
  }),
} as const;

// Transformation Result validators
export const TransformationResultV = {
  full: v.object({
    transformedOperation: operationV,
    conflicts: v.array(ConflictInfoV.full),
    transformationSteps: v.array(
      v.object({
        stepNumber: v.number(),
        againstOperation: operationV,
        beforeTransform: operationV,
        afterTransform: operationV,
        transformationType: v.union(
          v.literal("position_shift"),
          v.literal("content_merge"),
          v.literal("length_adjust"),
          v.literal("no_change"),
        ),
        explanation: v.string(),
      }),
    ),
    metadata: v.object({
      originalPosition: v.number(),
      finalPosition: v.number(),
      positionShift: v.number(),
      contentModified: v.boolean(),
    }),
  }),

  step: v.object({
    stepNumber: v.number(),
    againstOperation: operationV,
    beforeTransform: operationV,
    afterTransform: operationV,
    transformationType: v.union(
      v.literal("position_shift"),
      v.literal("content_merge"),
      v.literal("length_adjust"),
      v.literal("no_change"),
    ),
    explanation: v.string(),
  }),
} as const;

// Sync State validators
export const SyncStateV = {
  full: v.object({
    meetingId: v.id("meetings"),
    clientId: v.string(),
    serverVersion: v.number(),
    clientVersion: v.number(),
    acknowledgedSequence: v.number(),
    pendingOperations: v.array(operationWithMetadataV),
    inflightOperations: v.array(operationWithMetadataV),
    lastSyncTimestamp: v.number(),
    syncStatus: v.union(
      v.literal("synchronized"),
      v.literal("syncing"),
      v.literal("conflict"),
      v.literal("offline"),
      v.literal("error"),
    ),
  }),
} as const;

// OT Algorithm Config validators
export const OTAlgorithmConfigV = {
  full: v.object({
    conflictResolution: v.union(
      v.literal("timestamp"),
      v.literal("author_priority"),
      v.literal("operation_type"),
      v.literal("custom"),
    ),
    compositionEnabled: v.boolean(),
    maxCompositionWindow: v.number(),
    transformationOptimization: v.boolean(),
    preserveIntentions: v.boolean(),
    debugMode: v.boolean(),
  }),
} as const;

// Document Merge Result validators
export const DocumentMergeResultV = {
  full: v.object({
    success: v.boolean(),
    mergedContent: v.string(),
    mergedVersion: v.number(),
    conflictsResolved: v.number(),
    conflictsRemaining: v.array(ConflictInfoV.full),
    operationsApplied: v.number(),
    mergeStrategy: v.union(
      v.literal("three_way"),
      v.literal("operational_transform"),
      v.literal("last_writer_wins"),
    ),
    metadata: v.object({
      mergeTimestamp: v.number(),
      mergedBy: v.id("users"),
      branchesCount: v.number(),
      totalOperations: v.number(),
    }),
  }),
} as const;

// Collaborative Cursor validators
export const CollaborativeCursorV = {
  full: v.object({
    userId: v.id("users"),
    position: v.number(),
    selection: v.optional(
      v.object({
        start: v.number(),
        end: v.number(),
        direction: v.union(v.literal("forward"), v.literal("backward")),
      }),
    ),
    timestamp: v.number(),
    visible: v.boolean(),
    color: v.optional(v.string()),
    label: v.optional(v.string()),
  }),
} as const;

// Collaborative Awareness validators (Note: Map types need to be converted to records for Convex)
export const CollaborativeAwarenessV = {
  full: v.object({
    meetingId: v.id("meetings"),
    activeUsers: v.record(v.string(), CollaborativeCursorV.full), // Map<string, CollaborativeCursor> -> Record
    documentVersion: v.number(),
    lastActivity: v.number(),
    collaborationMetrics: v.object({
      totalEditors: v.number(),
      averageEditingTime: v.number(),
      conflictRate: v.number(),
      operationsPerMinute: v.number(),
    }),
  }),
} as const;

// Operation Priority validators
export const OperationPriorityV = {
  full: v.object({
    timestamp: v.number(),
    authorPriority: v.number(),
    operationType: operationTypeV,
    contextualPriority: v.number(),
    finalPriority: v.number(),
    tieBreaker: v.string(),
  }),
} as const;

// Document History validators
export const DocumentHistoryV = {
  full: v.object({
    meetingId: v.id("meetings"),
    versions: v.array(
      v.object({
        version: v.number(),
        content: v.string(),
        contentHash: v.string(),
        parentVersion: v.optional(v.number()),
        operations: v.array(operationWithMetadataV),
        timestamp: v.number(),
        authorId: v.id("users"),
        changesSummary: v.object({
          insertions: v.number(),
          deletions: v.number(),
          modifications: v.number(),
          netChange: v.number(),
        }),
      }),
    ),
    branches: v.array(
      v.object({
        branchId: v.string(),
        baseVersion: v.number(),
        headVersion: v.number(),
        operations: v.array(operationWithMetadataV),
        authorId: v.id("users"),
        createdAt: v.number(),
        mergedAt: v.optional(v.number()),
        mergedInto: v.optional(v.string()),
      }),
    ),
    mergePoints: v.array(
      v.object({
        mergeId: v.string(),
        sourceVersions: v.array(v.number()),
        targetVersion: v.number(),
        strategy: v.string(),
        conflicts: v.array(ConflictInfoV.full),
        timestamp: v.number(),
        mergedBy: v.id("users"),
      }),
    ),
    totalOperations: v.number(),
    createdAt: v.number(),
    lastModified: v.number(),
  }),

  version: v.object({
    version: v.number(),
    content: v.string(),
    contentHash: v.string(),
    parentVersion: v.optional(v.number()),
    operations: v.array(operationWithMetadataV),
    timestamp: v.number(),
    authorId: v.id("users"),
    changesSummary: v.object({
      insertions: v.number(),
      deletions: v.number(),
      modifications: v.number(),
      netChange: v.number(),
    }),
  }),

  branch: v.object({
    branchId: v.string(),
    baseVersion: v.number(),
    headVersion: v.number(),
    operations: v.array(operationWithMetadataV),
    authorId: v.id("users"),
    createdAt: v.number(),
    mergedAt: v.optional(v.number()),
    mergedInto: v.optional(v.string()),
  }),

  mergePoint: v.object({
    mergeId: v.string(),
    sourceVersions: v.array(v.number()),
    targetVersion: v.number(),
    strategy: v.string(),
    conflicts: v.array(ConflictInfoV.full),
    timestamp: v.number(),
    mergedBy: v.id("users"),
  }),
} as const;

// Operation Validation Result validators
export const OperationValidationResultV = {
  full: v.object({
    valid: v.boolean(),
    errors: v.array(
      v.object({
        code: v.string(),
        message: v.string(),
        field: v.string(),
        severity: v.union(
          v.literal("error"),
          v.literal("warning"),
          v.literal("info"),
        ),
        suggestion: v.optional(v.string()),
      }),
    ),
    warnings: v.array(
      v.object({
        code: v.string(),
        message: v.string(),
        field: v.string(),
        impact: v.union(
          v.literal("performance"),
          v.literal("usability"),
          v.literal("compatibility"),
        ),
        recommendation: v.optional(v.string()),
      }),
    ),
    metadata: v.object({
      operationType: operationTypeV,
      positionValid: v.boolean(),
      contentValid: v.boolean(),
      lengthValid: v.boolean(),
      semanticallyValid: v.boolean(),
    }),
  }),

  error: v.object({
    code: v.string(),
    message: v.string(),
    field: v.string(),
    severity: v.union(
      v.literal("error"),
      v.literal("warning"),
      v.literal("info"),
    ),
    suggestion: v.optional(v.string()),
  }),

  warning: v.object({
    code: v.string(),
    message: v.string(),
    field: v.string(),
    impact: v.union(
      v.literal("performance"),
      v.literal("usability"),
      v.literal("compatibility"),
    ),
    recommendation: v.optional(v.string()),
  }),
} as const;

// Operation Analytics validators
export const OperationAnalyticsV = {
  full: v.object({
    meetingId: v.id("meetings"),
    timeWindow: v.object({
      start: v.number(),
      end: v.number(),
    }),
    operationMetrics: v.object({
      total: v.number(),
      byType: v.record(v.string(), v.number()), // Record<OperationType, number>
      byAuthor: v.record(v.string(), v.number()),
      averageSize: v.number(),
      conflictRate: v.number(),
    }),
    performanceMetrics: v.object({
      averageTransformTime: v.number(),
      averageApplyTime: v.number(),
      peakOperationsPerSecond: v.number(),
      memoryUsage: v.number(),
    }),
    collaborationMetrics: v.object({
      concurrentEditors: v.number(),
      sessionDuration: v.number(),
      editingEfficiency: v.number(),
      userSatisfaction: v.optional(v.number()),
    }),
  }),
} as const;

// Comprehensive OT validators export
export const OTV = {
  // Basic types
  operation: operationV,
  operationWithMetadata: operationWithMetadataV,

  // Document state
  documentState: DocumentStateV.full,
  documentCheckpoint: DocumentStateV.checkpoint,

  // Transformation
  transformContext: TransformContextV.full,
  transformationResult: TransformationResultV.full,
  transformationStep: TransformationResultV.step,

  // Conflicts
  conflictInfo: ConflictInfoV.full,
  conflictResolution: ConflictInfoV.resolution,

  // Composition
  compositionResult: CompositionResultV.full,

  // Synchronization
  syncState: SyncStateV.full,

  // Configuration
  algorithmConfig: OTAlgorithmConfigV.full,

  // Merging
  documentMergeResult: DocumentMergeResultV.full,

  // Collaboration
  collaborativeCursor: CollaborativeCursorV.full,
  collaborativeAwareness: CollaborativeAwarenessV.full,

  // Priority
  operationPriority: OperationPriorityV.full,

  // History
  documentHistory: DocumentHistoryV.full,
  documentVersion: DocumentHistoryV.version,
  documentBranch: DocumentHistoryV.branch,
  documentMergePoint: DocumentHistoryV.mergePoint,

  // Validation
  operationValidationResult: OperationValidationResultV.full,
  validationError: OperationValidationResultV.error,
  validationWarning: OperationValidationResultV.warning,

  // Analytics
  operationAnalytics: OperationAnalyticsV.full,
} as const;
