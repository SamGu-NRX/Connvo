/**
 * Vector Embedding Validators
 *
 * This module provides Convex validators that correspond to the Embedding entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2, 7.6
 * Compliance: steering/convex_rules.mdc - Proper validator patterns for ML systems
 */

import { v } from "convex/values";
import type {
  Embedding,
  VectorIndexMeta,
  SimilaritySearchResult,
  EmbeddingWithSource,
  EmbeddingGenerationRequest,
  EmbeddingGenerationResult,
  VectorSearchQuery,
  VectorSearchResult,
  EmbeddingBatchRequest,
  EmbeddingBatchResult,
  EmbeddingAnalytics,
  EmbeddingModelConfig,
  EmbeddingQualityAssessment,
} from "../entities/embedding";

// Embedding source type validator
const embeddingSourceTypeV = v.union(
  v.literal("user"),
  v.literal("profile"),
  v.literal("meeting"),
  v.literal("note"),
  v.literal("transcriptSegment"),
);

// Vector index status validator
const vectorIndexStatusV = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("migrating"),
);

// Metadata validator (matches lib/validators.ts)
const metadataRecordV = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

// Core Embedding validators (optimized with ArrayBuffer for performance)
export const EmbeddingV = {
  // Full embedding entity (using v.bytes for better performance)
  full: v.object({
    _id: v.id("embeddings"),
    sourceType: embeddingSourceTypeV,
    sourceId: v.string(),
    vector: v.bytes(), // Use ArrayBuffer (v.bytes) for performance & cost optimization
    model: v.string(),
    dimensions: v.number(),
    version: v.string(),
    metadata: metadataRecordV,
    createdAt: v.number(),
  }),

  // Embedding with source details
  withSource: v.object({
    _id: v.id("embeddings"),
    sourceType: embeddingSourceTypeV,
    sourceId: v.string(),
    vector: v.bytes(), // Use ArrayBuffer for performance
    model: v.string(),
    dimensions: v.number(),
    version: v.string(),
    metadata: metadataRecordV,
    createdAt: v.number(),
    sourceDetails: v.optional(
      v.object({
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        author: v.optional(
          v.object({
            _id: v.id("users"),
            displayName: v.optional(v.string()),
            avatarUrl: v.optional(v.string()),
          }),
        ),
        createdAt: v.optional(v.number()),
      }),
    ),
  }),
} as const;

// Vector Index Meta validators (matches schema exactly)
export const VectorIndexMetaV = {
  full: v.object({
    _id: v.id("vectorIndexMeta"),
    provider: v.string(),
    indexName: v.string(),
    config: metadataRecordV,
    status: vectorIndexStatusV,
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// Similarity Search Result validators
export const SimilaritySearchResultV = {
  full: v.object({
    embedding: EmbeddingV.full,
    score: v.number(),
    sourceData: v.optional(v.any()),
  }),
} as const;

// Embedding Generation validators
export const EmbeddingGenerationV = {
  request: v.object({
    sourceType: embeddingSourceTypeV,
    sourceId: v.string(),
    content: v.string(),
    model: v.optional(v.string()),
    metadata: v.optional(metadataRecordV),
  }),

  result: v.object({
    embeddingId: v.id("embeddings"),
    vector: v.bytes(), // Use ArrayBuffer for performance
    dimensions: v.number(),
    model: v.string(),
    processingTime: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
} as const;

// Vector Search validators
export const VectorSearchV = {
  query: v.object({
    vector: v.bytes(), // Use ArrayBuffer for performance
    sourceTypes: v.optional(v.array(embeddingSourceTypeV)),
    limit: v.optional(v.number()),
    threshold: v.optional(v.number()),
    filters: v.optional(
      v.object({
        model: v.optional(v.string()),
        sourceIds: v.optional(v.array(v.string())),
        createdAfter: v.optional(v.number()),
        createdBefore: v.optional(v.number()),
      }),
    ),
  }),

  result: v.object({
    results: v.array(SimilaritySearchResultV.full),
    totalCount: v.number(),
    searchTime: v.number(),
    query: v.object({
      dimensions: v.number(),
      threshold: v.number(),
      filters: v.any(),
    }),
  }),
} as const;

// Embedding Batch Operation validators
export const EmbeddingBatchV = {
  request: v.object({
    operations: v.array(
      v.object({
        type: v.union(
          v.literal("create"),
          v.literal("update"),
          v.literal("delete"),
        ),
        sourceType: embeddingSourceTypeV,
        sourceId: v.string(),
        content: v.optional(v.string()),
        metadata: v.optional(metadataRecordV),
      }),
    ),
    model: v.optional(v.string()),
    batchId: v.string(),
  }),

  result: v.object({
    batchId: v.string(),
    totalOperations: v.number(),
    successfulOperations: v.number(),
    failedOperations: v.number(),
    results: v.array(
      v.object({
        sourceId: v.string(),
        success: v.boolean(),
        embeddingId: v.optional(v.id("embeddings")),
        error: v.optional(v.string()),
      }),
    ),
    processingTime: v.number(),
  }),
} as const;

// Embedding Analytics validators
export const EmbeddingAnalyticsV = {
  full: v.object({
    totalEmbeddings: v.number(),
    embeddingsBySource: v.record(v.string(), v.number()), // EmbeddingSourceType -> count
    embeddingsByModel: v.record(v.string(), v.number()),
    averageProcessingTime: v.number(),
    storageUsage: v.object({
      totalVectors: v.number(),
      totalDimensions: v.number(),
      estimatedSizeBytes: v.number(),
    }),
    searchMetrics: v.object({
      totalSearches: v.number(),
      averageSearchTime: v.number(),
      averageResultCount: v.number(),
    }),
    qualityMetrics: v.object({
      averageSimilarityScore: v.number(),
      lowQualityEmbeddings: v.number(),
      duplicateDetections: v.number(),
    }),
  }),
} as const;

// Embedding Model Config validators
export const EmbeddingModelConfigV = {
  full: v.object({
    modelName: v.string(),
    provider: v.union(
      v.literal("openai"),
      v.literal("huggingface"),
      v.literal("cohere"),
      v.literal("custom"),
    ),
    dimensions: v.number(),
    maxTokens: v.number(),
    costPerToken: v.number(),
    processingSpeed: v.number(), // tokens per second
    qualityScore: v.number(), // 0-100
    supportedLanguages: v.array(v.string()),
    configuration: v.object({
      apiKey: v.optional(v.string()),
      endpoint: v.optional(v.string()),
      parameters: v.optional(v.record(v.string(), v.any())),
    }),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// Embedding Quality Assessment validators
export const EmbeddingQualityAssessmentV = {
  full: v.object({
    embeddingId: v.id("embeddings"),
    qualityScore: v.number(), // 0-100
    issues: v.array(
      v.object({
        type: v.union(
          v.literal("low_variance"),
          v.literal("outlier"),
          v.literal("duplicate"),
          v.literal("corrupted"),
        ),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
        ),
        description: v.string(),
      }),
    ),
    recommendations: v.array(v.string()),
    assessedAt: v.number(),
  }),
} as const;

// Advanced AI and ML validators

// Semantic Cluster validators
export const SemanticClusterV = {
  full: v.object({
    clusterId: v.string(),
    centroid: v.bytes(), // Float32Array as ArrayBuffer
    radius: v.number(),
    embeddingIds: v.array(v.id("embeddings")),
    topicLabels: v.array(v.string()),
    coherenceScore: v.number(),
    size: v.number(),
    createdAt: v.number(),
    lastUpdated: v.number(),
  }),
} as const;

// Embedding Drift Analysis validators
export const EmbeddingDriftAnalysisV = {
  full: v.object({
    analysisId: v.string(),
    timeWindow: v.object({
      start: v.number(),
      end: v.number(),
    }),
    baselineEmbeddings: v.array(v.id("embeddings")),
    currentEmbeddings: v.array(v.id("embeddings")),
    driftMetrics: v.object({
      meanShift: v.number(),
      covarianceShift: v.number(),
      distributionDistance: v.number(),
      significanceLevel: v.number(),
    }),
    driftDetected: v.boolean(),
    affectedClusters: v.array(v.string()),
    recommendations: v.array(
      v.object({
        action: v.union(
          v.literal("retrain"),
          v.literal("recalibrate"),
          v.literal("investigate"),
          v.literal("monitor"),
        ),
        priority: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical"),
        ),
        description: v.string(),
      }),
    ),
    analyzedAt: v.number(),
  }),
} as const;

// Multi-Modal Embedding validators
export const MultiModalEmbeddingV = {
  full: v.object({
    _id: v.id("multiModalEmbeddings"),
    sourceType: embeddingSourceTypeV,
    sourceId: v.string(),
    modalities: v.object({
      text: v.optional(
        v.object({
          vector: v.bytes(),
          model: v.string(),
          confidence: v.number(),
        }),
      ),
      image: v.optional(
        v.object({
          vector: v.bytes(),
          model: v.string(),
          confidence: v.number(),
        }),
      ),
      audio: v.optional(
        v.object({
          vector: v.bytes(),
          model: v.string(),
          confidence: v.number(),
        }),
      ),
    }),
    fusedVector: v.optional(v.bytes()),
    fusionStrategy: v.union(
      v.literal("concatenation"),
      v.literal("attention"),
      v.literal("weighted_average"),
      v.literal("learned"),
    ),
    dimensions: v.number(),
    version: v.string(),
    metadata: v.record(v.string(), v.any()),
    createdAt: v.number(),
  }),
} as const;

// Embedding Fine-Tuning validators
export const EmbeddingFineTuningV = {
  full: v.object({
    fineTuningId: v.string(),
    baseModel: v.string(),
    targetDomain: v.string(),
    trainingData: v.object({
      positiveExamples: v.array(
        v.object({
          sourceId: v.string(),
          content: v.string(),
          label: v.optional(v.string()),
        }),
      ),
      negativeExamples: v.array(
        v.object({
          sourceId: v.string(),
          content: v.string(),
          label: v.optional(v.string()),
        }),
      ),
    }),
    hyperparameters: v.object({
      learningRate: v.number(),
      batchSize: v.number(),
      epochs: v.number(),
      regularization: v.number(),
    }),
    progress: v.object({
      currentEpoch: v.number(),
      loss: v.number(),
      accuracy: v.number(),
      validationLoss: v.number(),
      validationAccuracy: v.number(),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("training"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    resultModel: v.optional(
      v.object({
        modelId: v.string(),
        performanceMetrics: v.record(v.string(), v.number()),
        deploymentReady: v.boolean(),
      }),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }),
} as const;

// Embedding Explanation validators
export const EmbeddingExplanationV = {
  full: v.object({
    embeddingId: v.id("embeddings"),
    explanationMethod: v.union(
      v.literal("attention"),
      v.literal("gradient"),
      v.literal("lime"),
      v.literal("shap"),
      v.literal("integrated_gradients"),
    ),
    tokenImportance: v.array(
      v.object({
        token: v.string(),
        importance: v.number(),
        position: v.number(),
      }),
    ),
    dimensionAnalysis: v.array(
      v.object({
        dimension: v.number(),
        activation: v.number(),
        semanticMeaning: v.optional(v.string()),
        relatedConcepts: v.array(v.string()),
      }),
    ),
    similarityFactors: v.array(
      v.object({
        factor: v.string(),
        contribution: v.number(),
        examples: v.array(v.string()),
      }),
    ),
    confidence: v.number(),
    generatedAt: v.number(),
  }),
} as const;

// Embedding Migration validators
export const EmbeddingMigrationV = {
  full: v.object({
    migrationId: v.string(),
    fromVersion: v.string(),
    toVersion: v.string(),
    affectedEmbeddings: v.number(),
    migrationStrategy: v.union(
      v.literal("recompute"),
      v.literal("transform"),
      v.literal("interpolate"),
      v.literal("hybrid"),
    ),
    transformationMatrix: v.optional(v.bytes()),
    progress: v.object({
      processed: v.number(),
      total: v.number(),
      failed: v.number(),
      estimatedTimeRemaining: v.number(),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("paused"),
    ),
    validationResults: v.optional(
      v.object({
        sampleSize: v.number(),
        accuracyRetention: v.number(),
        similarityPreservation: v.number(),
        performanceImpact: v.number(),
      }),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    rollbackPlan: v.optional(
      v.object({
        backupLocation: v.string(),
        rollbackStrategy: v.string(),
        estimatedRollbackTime: v.number(),
      }),
    ),
  }),
} as const;

// Embedding Stream validators
export const EmbeddingStreamV = {
  full: v.object({
    streamId: v.string(),
    sourceType: embeddingSourceTypeV,
    updateStrategy: v.union(
      v.literal("incremental"),
      v.literal("batch"),
      v.literal("sliding_window"),
    ),
    bufferSize: v.number(),
    processingLatency: v.number(),
    throughput: v.number(),
    qualityThreshold: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("error"),
      v.literal("stopped"),
    ),
    metrics: v.object({
      totalProcessed: v.number(),
      averageLatency: v.number(),
      errorRate: v.number(),
      lastProcessedAt: v.number(),
    }),
    configuration: v.object({
      batchSize: v.number(),
      flushInterval: v.number(),
      retryPolicy: v.object({
        maxRetries: v.number(),
        backoffMultiplier: v.number(),
        maxBackoffTime: v.number(),
      }),
    }),
  }),
} as const;

// Embedding Privacy validators
export const EmbeddingPrivacyV = {
  full: v.object({
    embeddingId: v.id("embeddings"),
    privacyLevel: v.union(
      v.literal("public"),
      v.literal("internal"),
      v.literal("restricted"),
      v.literal("confidential"),
    ),
    encryptionStatus: v.union(
      v.literal("none"),
      v.literal("at_rest"),
      v.literal("in_transit"),
      v.literal("end_to_end"),
    ),
    accessControls: v.object({
      allowedUsers: v.array(v.id("users")),
      allowedRoles: v.array(v.string()),
      allowedOrganizations: v.array(v.string()),
    }),
    dataRetention: v.object({
      retentionPeriod: v.number(),
      autoDelete: v.boolean(),
      archiveAfter: v.optional(v.number()),
    }),
    auditLog: v.array(
      v.object({
        action: v.union(
          v.literal("created"),
          v.literal("accessed"),
          v.literal("modified"),
          v.literal("deleted"),
        ),
        userId: v.id("users"),
        timestamp: v.number(),
        metadata: v.optional(v.record(v.string(), v.any())),
      }),
    ),
    complianceFlags: v.object({
      gdprCompliant: v.boolean(),
      ccpaCompliant: v.boolean(),
      hipaaCompliant: v.boolean(),
      customCompliance: v.optional(v.array(v.string())),
    }),
  }),
} as const;

// Embedding Optimization validators
export const EmbeddingOptimizationV = {
  full: v.object({
    optimizationId: v.string(),
    targetMetric: v.union(
      v.literal("search_speed"),
      v.literal("storage_size"),
      v.literal("accuracy"),
      v.literal("cost"),
    ),
    techniques: v.array(
      v.object({
        name: v.union(
          v.literal("quantization"),
          v.literal("pruning"),
          v.literal("distillation"),
          v.literal("compression"),
        ),
        parameters: v.record(v.string(), v.any()),
        enabled: v.boolean(),
      }),
    ),
    results: v.object({
      originalSize: v.number(),
      optimizedSize: v.number(),
      compressionRatio: v.number(),
      accuracyRetention: v.number(),
      speedImprovement: v.number(),
      costReduction: v.number(),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    appliedAt: v.optional(v.number()),
    rollbackAvailable: v.boolean(),
  }),
} as const;
