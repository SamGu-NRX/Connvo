/**
 * Standardized API Response Types
 *
 * This module provides consistent response patterns for all API endpoints,
 * including success/error handling, pagination, and metadata.
 *
 * Requirements: 2.3, 2.4, 2.5, 8.1, 8.2
 * Compliance: steering/convex_rules.mdc - Consistent API patterns with proper pagination
 */

// Standard result envelope for public APIs (optional for internal)
export interface Result<T, E = string> {
  success: boolean;
  data?: T;
  error?: E;
  timestamp: number;
}

// Success result helper
export const success = <T>(data: T): Result<T> => ({
  success: true,
  data,
  timestamp: Date.now(),
});

// Error result helper
export const error = <E = string>(error: E): Result<never, E> => ({
  success: false,
  error,
  timestamp: Date.now(),
});

// Standardized pagination result (matches Convex guidelines)
export interface PaginationResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
}

// Enhanced pagination result with metadata
export interface PaginationResultWithMetadata<T> extends PaginationResult<T> {
  metadata: {
    totalCount?: number;
    pageSize: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    currentPage?: number;
    totalPages?: number;
  };
}

// List response with optional pagination
export interface ListResponse<T> {
  items: T[];
  pagination?: {
    cursor?: string | null;
    hasMore: boolean;
    totalCount?: number;
    pageSize: number;
  };
}

// Common error types
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: any;
}

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: number;
  requestId?: string;
  path?: string;
}

// Standard error codes
export const ErrorCodes = {
  // Client errors (4xx)
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  BAD_REQUEST: "BAD_REQUEST",

  // Server errors (5xx)
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  DATABASE_ERROR: "DATABASE_ERROR",

  // Business logic errors
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  RESOURCE_LOCKED: "RESOURCE_LOCKED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  FEATURE_DISABLED: "FEATURE_DISABLED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Metadata for responses
export interface ResponseMetadata {
  requestId?: string;
  version?: string;
  cached?: boolean;
  executionTime?: number;
  serverTimestamp: number;
  deprecationWarning?: string;
  rateLimit?: {
    remaining: number;
    resetAt: number;
    limit: number;
  };
}

// Enhanced result with metadata
export interface EnhancedResult<T, E = APIError> extends Result<T, E> {
  metadata?: ResponseMetadata;
}

// Operation result for mutations
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: APIError;
  warnings?: string[];
  metadata: {
    operationId: string;
    timestamp: number;
    executionTime: number;
    affectedResources?: string[];
  };
}

// Batch operation result
export interface BatchOperationResult<T = any> {
  success: boolean;
  results: Array<{
    success: boolean;
    data?: T;
    error?: APIError;
    index: number;
  }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  };
  metadata: {
    batchId: string;
    timestamp: number;
    executionTime: number;
  };
}

// Health check response
export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  version: string;
  services: Record<
    string,
    {
      status: "up" | "down" | "degraded";
      responseTime?: number;
      lastCheck: number;
      error?: string;
    }
  >;
  uptime: number;
}

// Search response with facets and filters
export interface SearchResponse<T> {
  results: T[];
  facets?: Record<
    string,
    Array<{
      value: string;
      count: number;
    }>
  >;
  filters?: Record<string, any>;
  query: {
    text?: string;
    filters?: Record<string, any>;
    sort?: string;
    page: number;
    pageSize: number;
  };
  pagination: {
    totalResults: number;
    totalPages: number;
    currentPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  metadata: {
    searchTime: number;
    timestamp: number;
  };
}

// Real-time event response
export interface EventResponse<T = any> {
  eventType: string;
  eventId: string;
  timestamp: number;
  data: T;
  metadata?: {
    source: string;
    version: string;
    correlationId?: string;
  };
}

// File upload response
export interface FileUploadResponse {
  success: boolean;
  fileId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  url?: string;
  metadata?: {
    uploadTime: number;
    checksum?: string;
    dimensions?: {
      width: number;
      height: number;
    };
  };
  error?: APIError;
}

// Analytics response
export interface AnalyticsResponse<T = any> {
  data: T;
  timeRange: {
    start: number;
    end: number;
    granularity: "minute" | "hour" | "day" | "week" | "month";
  };
  metrics: Record<string, number>;
  dimensions?: Record<string, string[]>;
  metadata: {
    dataPoints: number;
    lastUpdated: number;
    cached: boolean;
    computeTime: number;
  };
}

// Export response (for data exports)
export interface ExportResponse {
  exportId: string;
  status: "pending" | "processing" | "completed" | "failed";
  format: "csv" | "json" | "xlsx" | "pdf";
  downloadUrl?: string;
  progress?: {
    current: number;
    total: number;
    percentage: number;
  };
  metadata: {
    requestedAt: number;
    completedAt?: number;
    fileSize?: number;
    recordCount?: number;
    expiresAt?: number;
  };
  error?: APIError;
}

// Webhook response
export interface WebhookResponse {
  success: boolean;
  webhookId: string;
  eventType: string;
  deliveryId: string;
  timestamp: number;
  response?: {
    statusCode: number;
    headers: Record<string, string>;
    body?: string;
  };
  error?: APIError;
  retryCount?: number;
  nextRetryAt?: number;
}
