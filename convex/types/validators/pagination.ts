/**
 * Pagination Validators
 *
 * This module provides Convex validators for pagination types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper pagination validation with paginationOptsValidator
 */

import { v } from "convex/values";
import type {
  PaginationResult,
  PaginationMetadata,
  EnhancedPaginationResult,
  PaginationOptions,
  ExtendedPaginationOptions,
  PaginationConfig,
  CursorInfo,
  OffsetPaginationOptions,
  OffsetPaginationResult,
  TimePaginationOptions,
  TimePaginationResult,
  PaginationError,
  PaginationMetrics,
} from "../api/pagination";

// Standard Pagination Result validator (matches Convex .paginate() return exactly)
export const PaginationResultV = <T>(itemValidator: any) =>
  v.object({
    page: v.array(itemValidator),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  });

// Pagination Metadata validator
export const PaginationMetadataV = {
  full: v.object({
    totalCount: v.optional(v.number()),
    pageSize: v.number(),
    requestedSize: v.number(),
    hasNextPage: v.boolean(),
    hasPreviousPage: v.optional(v.boolean()),
    estimatedTotalPages: v.optional(v.number()),
    currentPageIndex: v.optional(v.number()),
  }),
} as const;

// Enhanced Pagination Result validator
export const EnhancedPaginationResultV = <T>(itemValidator: any) =>
  v.object({
    page: v.array(itemValidator),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    metadata: PaginationMetadataV.full,
  });

// Pagination Options validator (matches Convex paginationOptsValidator exactly)
export const PaginationOptionsV = {
  // Standard Convex pagination options
  standard: v.object({
    numItems: v.number(),
    cursor: v.union(v.string(), v.null()),
  }),

  // Extended pagination options with filters
  extended: v.object({
    numItems: v.number(),
    cursor: v.union(v.string(), v.null()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    filters: v.optional(v.record(v.string(), v.any())),
  }),
} as const;

// Pagination Config validator
export const PaginationConfigV = {
  full: v.object({
    defaultPageSize: v.number(),
    maxPageSize: v.number(),
    minPageSize: v.number(),
    allowTotalCount: v.boolean(),
    cacheResults: v.boolean(),
    cacheTTL: v.optional(v.number()),
  }),
} as const;

// Cursor Info validator
export const CursorInfoV = {
  full: v.object({
    cursor: v.union(v.string(), v.null()),
    direction: v.union(v.literal("forward"), v.literal("backward")),
    timestamp: v.optional(v.number()),
    position: v.optional(v.number()),
  }),
} as const;

// Offset Pagination validators (for compatibility, not recommended for Convex)
export const OffsetPaginationOptionsV = {
  full: v.object({
    offset: v.number(),
    limit: v.number(),
  }),
} as const;

export const OffsetPaginationResultV = <T>(itemValidator: any) =>
  v.object({
    items: v.array(itemValidator),
    totalCount: v.number(),
    offset: v.number(),
    limit: v.number(),
    hasNextPage: v.boolean(),
    hasPreviousPage: v.boolean(),
  });

// Time-based Pagination validators
export const TimePaginationOptionsV = {
  full: v.object({
    before: v.optional(v.number()),
    after: v.optional(v.number()),
    limit: v.number(),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  }),
} as const;

export const TimePaginationResultV = <T>(itemValidator: any) =>
  v.object({
    items: v.array(itemValidator),
    hasMore: v.boolean(),
    oldestTimestamp: v.optional(v.number()),
    newestTimestamp: v.optional(v.number()),
    nextCursor: v.optional(v.string()),
  });

// Pagination Error validator
export const PaginationErrorV = {
  full: v.object({
    code: v.union(
      v.literal("INVALID_PAGE_SIZE"),
      v.literal("INVALID_CURSOR"),
      v.literal("PAGE_SIZE_EXCEEDED"),
    ),
    message: v.string(),
    details: v.optional(
      v.object({
        requestedSize: v.optional(v.number()),
        maxSize: v.optional(v.number()),
        minSize: v.optional(v.number()),
        cursor: v.optional(v.string()),
      }),
    ),
  }),
} as const;

// Pagination Metrics validator
export const PaginationMetricsV = {
  full: v.object({
    queryTime: v.number(),
    resultCount: v.number(),
    cursorPosition: v.optional(v.number()),
    cacheHit: v.optional(v.boolean()),
    indexUsed: v.optional(v.string()),
    estimatedTotalTime: v.optional(v.number()),
  }),
} as const;

// Comprehensive pagination validators export
export const PaginationV = {
  // Core pagination
  result: PaginationResultV,
  metadata: PaginationMetadataV.full,
  enhanced: EnhancedPaginationResultV,

  // Options
  options: PaginationOptionsV.standard,
  extendedOptions: PaginationOptionsV.extended,
  config: PaginationConfigV.full,

  // Alternative pagination styles
  offsetOptions: OffsetPaginationOptionsV.full,
  offsetResult: OffsetPaginationResultV,
  timeOptions: TimePaginationOptionsV.full,
  timeResult: TimePaginationResultV,

  // Utilities
  cursor: CursorInfoV.full,
  error: PaginationErrorV.full,
  metrics: PaginationMetricsV.full,
} as const;
