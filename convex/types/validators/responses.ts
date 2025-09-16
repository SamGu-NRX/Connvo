/**
 * API Response Validators
 *
 * This module provides Convex validators for standardized API response types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Consistent API response validation
 */

import { v } from "convex/values";
import type {
  Result,
  PaginationResult,
  PaginationResultWithMetadata,
  ListResponse,
  ValidationError,
  APIError,
  ResponseMetadata,
  EnhancedResult,
  OperationResult,
  BatchOperationResult,
  HealthCheckResponse,
  SearchResponse,
  EventResponse,
  FileUploadResponse,
  AnalyticsResponse,
  ExportResponse,
  WebhookResponse,
} from "../api/responses";

// Standard Result validators
export const ResultV = {
  // Basic result
  basic: <T>(dataValidator: any) =>
    v.object({
      success: v.boolean(),
      data: v.optional(dataValidator),
      error: v.optional(v.string()),
      timestamp: v.number(),
    }),

  // Result with API error
  withAPIError: <T>(dataValidator: any) =>
    v.object({
      success: v.boolean(),
      data: v.optional(dataValidator),
      error: v.optional(
        v.object({
          code: v.string(),
          message: v.string(),
          details: v.optional(v.record(v.string(), v.any())),
          timestamp: v.number(),
          requestId: v.optional(v.string()),
          path: v.optional(v.string()),
        }),
      ),
      timestamp: v.number(),
    }),
} as const;

// Pagination Result validators
export const PaginationResultV = <T>(itemValidator: any) =>
  v.object({
    page: v.array(itemValidator),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  });

// Pagination Result with Metadata validator
export const PaginationResultWithMetadataV = <T>(itemValidator: any) =>
  v.object({
    page: v.array(itemValidator),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    metadata: v.object({
      totalCount: v.optional(v.number()),
      pageSize: v.number(),
      hasNextPage: v.boolean(),
      hasPreviousPage: v.boolean(),
      currentPage: v.optional(v.number()),
      totalPages: v.optional(v.number()),
    }),
  });

// List Response validator
export const ListResponseV = <T>(itemValidator: any) =>
  v.object({
    items: v.array(itemValidator),
    pagination: v.optional(
      v.object({
        cursor: v.optional(v.union(v.string(), v.null())),
        hasMore: v.boolean(),
        totalCount: v.optional(v.number()),
        pageSize: v.number(),
      }),
    ),
  });

// Validation Error validator
export const ValidationErrorV = {
  full: v.object({
    field: v.string(),
    message: v.string(),
    code: v.string(),
    value: v.optional(v.any()),
  }),
} as const;

// API Error validator
export const APIErrorV = {
  full: v.object({
    code: v.string(),
    message: v.string(),
    details: v.optional(v.record(v.string(), v.any())),
    timestamp: v.number(),
    requestId: v.optional(v.string()),
    path: v.optional(v.string()),
  }),
} as const;

// Response Metadata validator
export const ResponseMetadataV = {
  full: v.object({
    requestId: v.optional(v.string()),
    version: v.optional(v.string()),
    cached: v.optional(v.boolean()),
    executionTime: v.optional(v.number()),
    serverTimestamp: v.number(),
    deprecationWarning: v.optional(v.string()),
    rateLimit: v.optional(
      v.object({
        remaining: v.number(),
        resetAt: v.number(),
        limit: v.number(),
      }),
    ),
  }),
} as const;

// Enhanced Result validator
export const EnhancedResultV = {
  basic: <T>(dataValidator: any) =>
    v.object({
      success: v.boolean(),
      data: v.optional(dataValidator),
      error: v.optional(APIErrorV.full),
      timestamp: v.number(),
      metadata: v.optional(ResponseMetadataV.full),
    }),
} as const;

// Operation Result validator
export const OperationResultV = {
  basic: <T>(dataValidator: any) =>
    v.object({
      success: v.boolean(),
      data: v.optional(dataValidator),
      error: v.optional(APIErrorV.full),
      warnings: v.optional(v.array(v.string())),
      metadata: v.object({
        operationId: v.string(),
        timestamp: v.number(),
        executionTime: v.number(),
        affectedResources: v.optional(v.array(v.string())),
      }),
    }),
} as const;

// Batch Operation Result validator
export const BatchOperationResultV = {
  basic: <T>(dataValidator: any) =>
    v.object({
      success: v.boolean(),
      results: v.array(
        v.object({
          success: v.boolean(),
          data: v.optional(dataValidator),
          error: v.optional(APIErrorV.full),
          index: v.number(),
        }),
      ),
      summary: v.object({
        total: v.number(),
        successful: v.number(),
        failed: v.number(),
        skipped: v.number(),
      }),
      metadata: v.object({
        batchId: v.string(),
        timestamp: v.number(),
        executionTime: v.number(),
      }),
    }),
} as const;

// Health Check Response validator
export const HealthCheckResponseV = {
  full: v.object({
    status: v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("unhealthy"),
    ),
    timestamp: v.number(),
    version: v.string(),
    services: v.record(
      v.string(),
      v.object({
        status: v.union(
          v.literal("up"),
          v.literal("down"),
          v.literal("degraded"),
        ),
        responseTime: v.optional(v.number()),
        lastCheck: v.number(),
        error: v.optional(v.string()),
      }),
    ),
    uptime: v.number(),
  }),
} as const;

// Search Response validator
export const SearchResponseV = {
  basic: <T>(resultValidator: any) =>
    v.object({
      results: v.array(resultValidator),
      facets: v.optional(
        v.record(
          v.string(),
          v.array(
            v.object({
              value: v.string(),
              count: v.number(),
            }),
          ),
        ),
      ),
      filters: v.optional(v.record(v.string(), v.any())),
      query: v.object({
        text: v.optional(v.string()),
        filters: v.optional(v.record(v.string(), v.any())),
        sort: v.optional(v.string()),
        page: v.number(),
        pageSize: v.number(),
      }),
      pagination: v.object({
        totalResults: v.number(),
        totalPages: v.number(),
        currentPage: v.number(),
        hasNextPage: v.boolean(),
        hasPreviousPage: v.boolean(),
      }),
      metadata: v.object({
        searchTime: v.number(),
        timestamp: v.number(),
      }),
    }),
} as const;

// Event Response validator
export const EventResponseV = {
  basic: <T>(dataValidator: any) =>
    v.object({
      eventType: v.string(),
      eventId: v.string(),
      timestamp: v.number(),
      data: dataValidator,
      metadata: v.optional(
        v.object({
          source: v.string(),
          version: v.string(),
          correlationId: v.optional(v.string()),
        }),
      ),
    }),
} as const;

// File Upload Response validator
export const FileUploadResponseV = {
  full: v.object({
    success: v.boolean(),
    fileId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    url: v.optional(v.string()),
    metadata: v.optional(
      v.object({
        uploadTime: v.number(),
        checksum: v.optional(v.string()),
        dimensions: v.optional(
          v.object({
            width: v.number(),
            height: v.number(),
          }),
        ),
      }),
    ),
    error: v.optional(APIErrorV.full),
  }),
} as const;

// Analytics Response validator
export const AnalyticsResponseV = {
  basic: <T>(dataValidator: any) =>
    v.object({
      data: dataValidator,
      timeRange: v.object({
        start: v.number(),
        end: v.number(),
        granularity: v.union(
          v.literal("minute"),
          v.literal("hour"),
          v.literal("day"),
          v.literal("week"),
          v.literal("month"),
        ),
      }),
      metrics: v.record(v.string(), v.number()),
      dimensions: v.optional(v.record(v.string(), v.array(v.string()))),
      metadata: v.object({
        dataPoints: v.number(),
        lastUpdated: v.number(),
        cached: v.boolean(),
        computeTime: v.number(),
      }),
    }),
} as const;

// Export Response validator
export const ExportResponseV = {
  full: v.object({
    exportId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    format: v.union(
      v.literal("csv"),
      v.literal("json"),
      v.literal("xlsx"),
      v.literal("pdf"),
    ),
    downloadUrl: v.optional(v.string()),
    progress: v.optional(
      v.object({
        current: v.number(),
        total: v.number(),
        percentage: v.number(),
      }),
    ),
    metadata: v.object({
      requestedAt: v.number(),
      completedAt: v.optional(v.number()),
      fileSize: v.optional(v.number()),
      recordCount: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
    }),
    error: v.optional(APIErrorV.full),
  }),
} as const;

// Webhook Response validator
export const WebhookResponseV = {
  full: v.object({
    success: v.boolean(),
    webhookId: v.string(),
    eventType: v.string(),
    deliveryId: v.string(),
    timestamp: v.number(),
    response: v.optional(
      v.object({
        statusCode: v.number(),
        headers: v.record(v.string(), v.string()),
        body: v.optional(v.string()),
      }),
    ),
    error: v.optional(APIErrorV.full),
    retryCount: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),
  }),
} as const;
