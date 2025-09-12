/**
 * Centralized Error Management for Convex
 *
 * This module provides standardized error handling and error codes
 * for consistent error responses across the Convex backend.
 *
 * Requirements: 2.6, 19.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex error patterns
 */

import { ConvexError } from "convex/values";

/**
 * Standardized error codes for the application
 */
export const ErrorCodes = {
  // Authentication & Authorization
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TOKEN: "INVALID_TOKEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",

  // Resource Access
  NOT_FOUND: "NOT_FOUND",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  MEETING_NOT_FOUND: "MEETING_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_INPUT: "INVALID_INPUT",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",

  // Business Logic
  MEETING_NOT_ACTIVE: "MEETING_NOT_ACTIVE",
  MEETING_ALREADY_STARTED: "MEETING_ALREADY_STARTED",
  MEETING_ALREADY_ENDED: "MEETING_ALREADY_ENDED",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",

  // External Services
  STREAM_ERROR: "STREAM_ERROR",
  STREAM_ROOM_NOT_FOUND: "STREAM_ROOM_NOT_FOUND",
  STREAM_TOKEN_EXPIRED: "STREAM_TOKEN_EXPIRED",
  STREAM_WEBHOOK_INVALID: "STREAM_WEBHOOK_INVALID",
  AI_PROVIDER_ERROR: "AI_PROVIDER_ERROR",
  VECTOR_PROVIDER_ERROR: "VECTOR_PROVIDER_ERROR",
  EXTERNAL_SERVICE_TIMEOUT: "EXTERNAL_SERVICE_TIMEOUT",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",

  // System
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  // Conflicts
  CONFLICT: "CONFLICT",
} as const;

/**
 * Custom ConvexError class with enhanced metadata support
 */
// Use ConvexError with structured data payloads for consistency with Convex types

/**
 * Helper functions for creating standardized errors
 */
export const createError = {
  unauthorized: (message = "Authentication required") =>
    new ConvexError({
      code: ErrorCodes.UNAUTHORIZED,
      message,
      statusCode: 401,
    }),

  forbidden: (message = "Access denied", metadata?: Record<string, any>) =>
    new ConvexError({
      code: ErrorCodes.FORBIDDEN,
      message,
      statusCode: 403,
      metadata,
    }),

  notFound: (resource: string, id?: string) =>
    new ConvexError({
      code: ErrorCodes.NOT_FOUND,
      message: `${resource}${id ? ` with ID ${id}` : ""} not found`,
      statusCode: 404,
      metadata: id ? { id } : undefined,
    }),

  validation: (message: string, field?: string) =>
    new ConvexError({
      code: ErrorCodes.VALIDATION_ERROR,
      message,
      statusCode: 400,
      metadata: { field },
    }),

  meetingNotActive: (meetingId: string) =>
    new ConvexError({
      code: ErrorCodes.MEETING_NOT_ACTIVE,
      message: "Meeting is not currently active",
      statusCode: 400,
      metadata: { meetingId },
    }),

  insufficientPermissions: (requiredRole: string, currentRole?: string) =>
    new ConvexError({
      code: ErrorCodes.INSUFFICIENT_PERMISSIONS,
      message: `Requires ${requiredRole} role`,
      statusCode: 403,
      metadata: { requiredRole, currentRole },
    }),

  rateLimitExceeded: (action: string, limit: number) =>
    new ConvexError({
      code: ErrorCodes.RATE_LIMIT_EXCEEDED,
      message: `Rate limit exceeded for ${action}`,
      statusCode: 429,
      metadata: { action, limit },
    }),

  streamError: (operation: string, details?: string) =>
    new ConvexError({
      code: ErrorCodes.STREAM_ERROR,
      message: `Stream ${operation} failed${details ? `: ${details}` : ""}`,
      statusCode: 502,
      metadata: { operation, details },
    }),

  externalServiceTimeout: (service: string, timeoutMs: number) =>
    new ConvexError({
      code: ErrorCodes.EXTERNAL_SERVICE_TIMEOUT,
      message: `${service} request timed out after ${timeoutMs}ms`,
      statusCode: 504,
      metadata: { service, timeoutMs },
    }),

  webhookInvalid: (reason: string) =>
    new ConvexError({
      code: ErrorCodes.STREAM_WEBHOOK_INVALID,
      message: `Invalid webhook: ${reason}`,
      statusCode: 400,
      metadata: { reason },
    }),

  internal: (message = "Internal server error", metadata?: Record<string, any>) =>
    new ConvexError({
      code: ErrorCodes.INTERNAL_ERROR,
      message,
      statusCode: 500,
      metadata,
    }),

  conflict: (message = "Conflict detected", metadata?: Record<string, any>) =>
    new ConvexError({
      code: ErrorCodes.CONFLICT,
      message,
      statusCode: 409,
      metadata,
    }),
};
