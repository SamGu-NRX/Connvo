/**
 * Vector Embedding Entity Type Definitions
 *
 * This module defines all vector embedding-related entity types for AI-powered
 * similarity search and matching functionality.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2, 7.6
 * Compliance: steering/convex_rules.mdc - Use ArrayBuffer (v.bytes) for performance
 */

import type { Id } from "../../_generated/dataModel";

// Embedding source types (matches schema exactly)
export type EmbeddingSourceType =
  | "user"
  | "profile"
  | "meeting"
  | "note"
  | "transcriptSegment";

// Vector index status (matches schema exactly)
export type VectorIndexStatus = "active" | "inactive" | "migrating";

// Core Embedding entity (optimized for performance with ArrayBuffer)
export interface Embedding {
  _id: Id<"embeddings">;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  // Use ArrayBuffer (v.bytes) with Float32Array for performance & size optimization
  vector: ArrayBuffer;
  model: string;
  dimensions: number;
  version: string;
  metadata: Record<string, string | number | boolean>;
  createdAt: number;
}

// Helper type for working with vectors in TypeScript
export interface EmbeddingWithFloatVector extends Omit<Embedding, "vector"> {
  vector: Float32Array;
}

// Vector index metadata (matches schema exactly)
export interface VectorIndexMeta {
  _id: Id<"vectorIndexMeta">;
  provider: string;
  indexName: string;
  config: Record<string, string | number | boolean>;
  status: VectorIndexStatus;
  createdAt: number;
  updatedAt: number;
}

// Derived types for API responses

// Similarity search result
export interface SimilaritySearchResult {
  embedding: Embedding;
  score: number;
  sourceData?: any;
}

// Enhanced embedding with source details
export interface EmbeddingWithSource extends Embedding {
  sourceDetails?: {
    title?: string;
    description?: string;
    author?: {
      _id: Id<"users">;
      displayName?: string;
      avatarUrl?: string;
    };
    createdAt?: number;
  };
}

// Embedding generation request
export interface EmbeddingGenerationRequest {
  sourceType: EmbeddingSourceType;
  sourceId: string;
  content: string;
  model?: string;
  metadata?: Record<string, any>;
}

// Embedding generation result
export interface EmbeddingGenerationResult {
  embeddingId: Id<"embeddings">;
  vector: number[];
  dimensions: number;
  model: string;
  processingTime: number;
  success: boolean;
  error?: string;
}

// Vector search query
export interface VectorSearchQuery {
  vector: number[];
  sourceTypes?: EmbeddingSourceType[];
  limit?: number;
  threshold?: number;
  filters?: {
    model?: string;
    sourceIds?: string[];
    createdAfter?: number;
    createdBefore?: number;
  };
}

// Vector search result with pagination
export interface VectorSearchResult {
  results: SimilaritySearchResult[];
  totalCount: number;
  searchTime: number;
  query: {
    dimensions: number;
    threshold: number;
    filters: any;
  };
}

// Embedding batch operations
export interface EmbeddingBatchRequest {
  operations: Array<{
    type: "create" | "update" | "delete";
    sourceType: EmbeddingSourceType;
    sourceId: string;
    content?: string;
    metadata?: Record<string, any>;
  }>;
  model?: string;
  batchId: string;
}

export interface EmbeddingBatchResult {
  batchId: string;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  results: Array<{
    sourceId: string;
    success: boolean;
    embeddingId?: Id<"embeddings">;
    error?: string;
  }>;
  processingTime: number;
}

// Embedding analytics and metrics
export interface EmbeddingAnalytics {
  totalEmbeddings: number;
  embeddingsBySource: Record<EmbeddingSourceType, number>;
  embeddingsByModel: Record<string, number>;
  averageProcessingTime: number;
  storageUsage: {
    totalVectors: number;
    totalDimensions: number;
    estimatedSizeBytes: number;
  };
  searchMetrics: {
    totalSearches: number;
    averageSearchTime: number;
    averageResultCount: number;
  };
  qualityMetrics: {
    averageSimilarityScore: number;
    lowQualityEmbeddings: number;
    duplicateDetections: number;
  };
}

// Embedding model configuration
export interface EmbeddingModelConfig {
  modelName: string;
  provider: "openai" | "huggingface" | "cohere" | "custom";
  dimensions: number;
  maxTokens: number;
  costPerToken: number;
  processingSpeed: number; // tokens per second
  qualityScore: number; // 0-100
  supportedLanguages: string[];
  configuration: {
    apiKey?: string;
    endpoint?: string;
    parameters?: Record<string, any>;
  };
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// Embedding quality assessment
export interface EmbeddingQualityAssessment {
  embeddingId: Id<"embeddings">;
  qualityScore: number; // 0-100
  issues: Array<{
    type: "low_variance" | "outlier" | "duplicate" | "corrupted";
    severity: "low" | "medium" | "high";
    description: string;
  }>;
  recommendations: string[];
  assessedAt: number;
}

// Advanced AI and ML types for embeddings

// Semantic clustering and topic modeling
export interface SemanticCluster {
  clusterId: string;
  centroid: ArrayBuffer; // Float32Array as ArrayBuffer
  radius: number;
  embeddingIds: Id<"embeddings">[];
  topicLabels: string[];
  coherenceScore: number;
  size: number;
  createdAt: number;
  lastUpdated: number;
}

// Embedding drift detection
export interface EmbeddingDriftAnalysis {
  analysisId: string;
  timeWindow: {
    start: number;
    end: number;
  };
  baselineEmbeddings: Id<"embeddings">[];
  currentEmbeddings: Id<"embeddings">[];
  driftMetrics: {
    meanShift: number;
    covarianceShift: number;
    distributionDistance: number;
    significanceLevel: number;
  };
  driftDetected: boolean;
  affectedClusters: string[];
  recommendations: Array<{
    action: "retrain" | "recalibrate" | "investigate" | "monitor";
    priority: "low" | "medium" | "high" | "critical";
    description: string;
  }>;
  analyzedAt: number;
}

// Multi-modal embedding support
export interface MultiModalEmbedding {
  _id: Id<"multiModalEmbeddings">;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  modalities: {
    text?: {
      vector: ArrayBuffer;
      model: string;
      confidence: number;
    };
    image?: {
      vector: ArrayBuffer;
      model: string;
      confidence: number;
    };
    audio?: {
      vector: ArrayBuffer;
      model: string;
      confidence: number;
    };
  };
  fusedVector?: ArrayBuffer; // Combined multi-modal representation
  fusionStrategy:
    | "concatenation"
    | "attention"
    | "weighted_average"
    | "learned";
  dimensions: number;
  version: string;
  metadata: Record<string, any>;
  createdAt: number;
}

// Embedding fine-tuning and adaptation
export interface EmbeddingFineTuning {
  fineTuningId: string;
  baseModel: string;
  targetDomain: string;
  trainingData: {
    positiveExamples: Array<{
      sourceId: string;
      content: string;
      label?: string;
    }>;
    negativeExamples: Array<{
      sourceId: string;
      content: string;
      label?: string;
    }>;
  };
  hyperparameters: {
    learningRate: number;
    batchSize: number;
    epochs: number;
    regularization: number;
  };
  progress: {
    currentEpoch: number;
    loss: number;
    accuracy: number;
    validationLoss: number;
    validationAccuracy: number;
  };
  status: "pending" | "training" | "completed" | "failed" | "cancelled";
  resultModel?: {
    modelId: string;
    performanceMetrics: Record<string, number>;
    deploymentReady: boolean;
  };
  startedAt: number;
  completedAt?: number;
}

// Embedding explainability and interpretability
export interface EmbeddingExplanation {
  embeddingId: Id<"embeddings">;
  explanationMethod:
    | "attention"
    | "gradient"
    | "lime"
    | "shap"
    | "integrated_gradients";
  tokenImportance: Array<{
    token: string;
    importance: number;
    position: number;
  }>;
  dimensionAnalysis: Array<{
    dimension: number;
    activation: number;
    semanticMeaning?: string;
    relatedConcepts: string[];
  }>;
  similarityFactors: Array<{
    factor: string;
    contribution: number;
    examples: string[];
  }>;
  confidence: number;
  generatedAt: number;
}

// Embedding versioning and migration
export interface EmbeddingMigration {
  migrationId: string;
  fromVersion: string;
  toVersion: string;
  affectedEmbeddings: number;
  migrationStrategy: "recompute" | "transform" | "interpolate" | "hybrid";
  transformationMatrix?: ArrayBuffer; // For linear transformations
  progress: {
    processed: number;
    total: number;
    failed: number;
    estimatedTimeRemaining: number;
  };
  status: "pending" | "running" | "completed" | "failed" | "paused";
  validationResults?: {
    sampleSize: number;
    accuracyRetention: number;
    similarityPreservation: number;
    performanceImpact: number;
  };
  startedAt: number;
  completedAt?: number;
  rollbackPlan?: {
    backupLocation: string;
    rollbackStrategy: string;
    estimatedRollbackTime: number;
  };
}

// Real-time embedding updates and streaming
export interface EmbeddingStream {
  streamId: string;
  sourceType: EmbeddingSourceType;
  updateStrategy: "incremental" | "batch" | "sliding_window";
  bufferSize: number;
  processingLatency: number;
  throughput: number; // embeddings per second
  qualityThreshold: number;
  status: "active" | "paused" | "error" | "stopped";
  metrics: {
    totalProcessed: number;
    averageLatency: number;
    errorRate: number;
    lastProcessedAt: number;
  };
  configuration: {
    batchSize: number;
    flushInterval: number;
    retryPolicy: {
      maxRetries: number;
      backoffMultiplier: number;
      maxBackoffTime: number;
    };
  };
}

// Embedding privacy and security
export interface EmbeddingPrivacy {
  embeddingId: Id<"embeddings">;
  privacyLevel: "public" | "internal" | "restricted" | "confidential";
  encryptionStatus: "none" | "at_rest" | "in_transit" | "end_to_end";
  accessControls: {
    allowedUsers: Id<"users">[];
    allowedRoles: string[];
    allowedOrganizations: string[];
  };
  dataRetention: {
    retentionPeriod: number; // days
    autoDelete: boolean;
    archiveAfter?: number; // days
  };
  auditLog: Array<{
    action: "created" | "accessed" | "modified" | "deleted";
    userId: Id<"users">;
    timestamp: number;
    metadata?: Record<string, any>;
  }>;
  complianceFlags: {
    gdprCompliant: boolean;
    ccpaCompliant: boolean;
    hipaaCompliant: boolean;
    customCompliance?: string[];
  };
}

// Embedding performance optimization
export interface EmbeddingOptimization {
  optimizationId: string;
  targetMetric: "search_speed" | "storage_size" | "accuracy" | "cost";
  techniques: Array<{
    name: "quantization" | "pruning" | "distillation" | "compression";
    parameters: Record<string, any>;
    enabled: boolean;
  }>;
  results: {
    originalSize: number;
    optimizedSize: number;
    compressionRatio: number;
    accuracyRetention: number;
    speedImprovement: number;
    costReduction: number;
  };
  status: "pending" | "running" | "completed" | "failed";
  appliedAt?: number;
  rollbackAvailable: boolean;
}

// Vector database utilities and helpers
export const VectorUtils = {
  // Convert Float32Array to ArrayBuffer for storage
  floatArrayToBuffer: (array: Float32Array): ArrayBuffer =>
    array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength),

  // Convert ArrayBuffer back to Float32Array for computation
  bufferToFloatArray: (buffer: ArrayBuffer): Float32Array =>
    new Float32Array(buffer),

  // Calculate cosine similarity between two vectors
  cosineSimilarity: (a: Float32Array, b: Float32Array): number => {
    if (a.length !== b.length) throw new Error("Vector dimensions must match");

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  },

  // Calculate Euclidean distance between two vectors
  euclideanDistance: (a: Float32Array, b: Float32Array): number => {
    if (a.length !== b.length) throw new Error("Vector dimensions must match");

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  },

  // Normalize vector to unit length
  normalize: (vector: Float32Array): Float32Array => {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / norm;
    }

    return normalized;
  },
} as const;
