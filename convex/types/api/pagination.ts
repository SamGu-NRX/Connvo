/**
 * Standardized Pagination Types
 *
 * This module provides consistent pagination patterns following Convex
 * guidelines for all paginated endpoints with comprehensive pagination support.
 *
 * Requirements: 2.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 * Compliance: steering/convex_rules.mdc - Proper pagination with paginationOptsValidator
 */

// Standard pagination result shape (matches Convex .paginate() return exactly)
export interface PaginationResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
}

// Pagination metadata for enhanced responses
export interface PaginationMetadata {
  totalCount?: number; // Optional, expensive to compute
  pageSize: number;
  requestedSize: number;
  hasNextPage: boolean;
  hasPreviousPage?: boolean; // Usually false for Convex cursor-based pagination
  estimatedTotalPages?: number;
  currentPageIndex?: number;
}

// Enhanced pagination result with metadata
export interface EnhancedPaginationResult<T> extends PaginationResult<T> {
  metadata: PaginationMetadata;
}

// Pagination options (matches Convex paginationOptsValidator exactly)
export interface PaginationOptions {
  numItems: number;
  cursor: string | null;
}

// Extended pagination options with additional filters
export interface ExtendedPaginationOptions extends PaginationOptions {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, any>;
}

// Pagination configuration for different contexts
export interface PaginationConfig {
  defaultPageSize: number;
  maxPageSize: number;
  minPageSize: number;
  allowTotalCount: boolean; // Whether to compute expensive total counts
  cacheResults: boolean;
  cacheTTL?: number; // Cache time-to-live in milliseconds
}

// Common pagination limits and configurations
export const PaginationLimits = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,

  // Context-specific limits
  SEARCH_DEFAULT_SIZE: 10,
  SEARCH_MAX_SIZE: 50,

  ANALYTICS_DEFAULT_SIZE: 100,
  ANALYTICS_MAX_SIZE: 1000,

  EXPORT_DEFAULT_SIZE: 1000,
  EXPORT_MAX_SIZE: 10000,
} as const;

// Pagination configurations for different contexts
export const PaginationConfigs: Record<string, PaginationConfig> = {
  default: {
    defaultPageSize: PaginationLimits.DEFAULT_PAGE_SIZE,
    maxPageSize: PaginationLimits.MAX_PAGE_SIZE,
    minPageSize: PaginationLimits.MIN_PAGE_SIZE,
    allowTotalCount: false,
    cacheResults: true,
    cacheTTL: 60000, // 1 minute
  },

  search: {
    defaultPageSize: PaginationLimits.SEARCH_DEFAULT_SIZE,
    maxPageSize: PaginationLimits.SEARCH_MAX_SIZE,
    minPageSize: PaginationLimits.MIN_PAGE_SIZE,
    allowTotalCount: true, // Search often needs total counts
    cacheResults: true,
    cacheTTL: 30000, // 30 seconds
  },

  analytics: {
    defaultPageSize: PaginationLimits.ANALYTICS_DEFAULT_SIZE,
    maxPageSize: PaginationLimits.ANALYTICS_MAX_SIZE,
    minPageSize: PaginationLimits.MIN_PAGE_SIZE,
    allowTotalCount: true,
    cacheResults: true,
    cacheTTL: 300000, // 5 minutes
  },

  export: {
    defaultPageSize: PaginationLimits.EXPORT_DEFAULT_SIZE,
    maxPageSize: PaginationLimits.EXPORT_MAX_SIZE,
    minPageSize: PaginationLimits.MIN_PAGE_SIZE,
    allowTotalCount: false,
    cacheResults: false,
  },

  realtime: {
    defaultPageSize: 50,
    maxPageSize: 200,
    minPageSize: PaginationLimits.MIN_PAGE_SIZE,
    allowTotalCount: false,
    cacheResults: false, // Real-time data shouldn't be cached
  },
};

// Cursor-based pagination info
export interface CursorInfo {
  cursor: string | null;
  direction: "forward" | "backward";
  timestamp?: number;
  position?: number;
}

// Offset-based pagination (for compatibility, not recommended for Convex)
export interface OffsetPaginationOptions {
  offset: number;
  limit: number;
}

export interface OffsetPaginationResult<T> {
  items: T[];
  totalCount: number;
  offset: number;
  limit: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

// Time-based pagination for chronological data
export interface TimePaginationOptions {
  before?: number; // timestamp
  after?: number; // timestamp
  limit: number;
  order?: "asc" | "desc";
}

export interface TimePaginationResult<T> {
  items: T[];
  hasMore: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  nextCursor?: string;
}

// Helper functions

// Validate pagination options
export const validatePaginationOptions = (
  opts: PaginationOptions,
  config: PaginationConfig = PaginationConfigs.default,
): PaginationOptions => {
  const { numItems, cursor } = opts;

  if (numItems < config.minPageSize || numItems > config.maxPageSize) {
    throw new Error(
      `Page size must be between ${config.minPageSize} and ${config.maxPageSize}`,
    );
  }

  return { numItems, cursor };
};

// Create pagination metadata
export const createPaginationMetadata = <T>(
  result: PaginationResult<T>,
  requestedSize: number,
  totalCount?: number,
): PaginationMetadata => ({
  pageSize: result.page.length,
  requestedSize,
  hasNextPage: !result.isDone,
  hasPreviousPage: false, // Convex cursor-based pagination is forward-only
  totalCount,
  estimatedTotalPages: totalCount
    ? Math.ceil(totalCount / requestedSize)
    : undefined,
});

// Create enhanced pagination result
export const createEnhancedPaginationResult = <T>(
  result: PaginationResult<T>,
  requestedSize: number,
  totalCount?: number,
): EnhancedPaginationResult<T> => ({
  ...result,
  metadata: createPaginationMetadata(result, requestedSize, totalCount),
});

// Apply default pagination options
export const applyDefaultPaginationOptions = (
  opts: Partial<PaginationOptions>,
  config: PaginationConfig = PaginationConfigs.default,
): PaginationOptions => ({
  numItems: opts.numItems ?? config.defaultPageSize,
  cursor: opts.cursor ?? null,
});

// Check if pagination result is empty
export const isPaginationResultEmpty = <T>(
  result: PaginationResult<T>,
): boolean => result.page.length === 0;

// Check if pagination result has more pages
export const hasMorePages = <T>(result: PaginationResult<T>): boolean =>
  !result.isDone;

// Get next page cursor
export const getNextPageCursor = <T>(
  result: PaginationResult<T>,
): string | null => (result.isDone ? null : result.continueCursor);

// Pagination error types
export interface PaginationError {
  code: "INVALID_PAGE_SIZE" | "INVALID_CURSOR" | "PAGE_SIZE_EXCEEDED";
  message: string;
  details?: {
    requestedSize?: number;
    maxSize?: number;
    minSize?: number;
    cursor?: string;
  };
}

// Create pagination error
export const createPaginationError = (
  code: PaginationError["code"],
  message: string,
  details?: PaginationError["details"],
): PaginationError => ({
  code,
  message,
  details,
});

// Pagination performance metrics
export interface PaginationMetrics {
  queryTime: number;
  resultCount: number;
  cursorPosition?: number;
  cacheHit?: boolean;
  indexUsed?: string;
  estimatedTotalTime?: number;
}
