/**
 * Idempotency Management System
 *
 * This module provides idempotency guarantees for critical operations,
 * ensuring exactly-once execution for external service calls and mutations.
 *
 * Requirements: 6.5, 19.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { MutationCtx, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createError } from "./errors";

/**
 * Idempotency key configuration
 */
export interface IdempotencyConfig {
  key: string;
  scope: string;
  ttlMs?: number; // Time to live in milliseconds
  allowRetry?: boolean; // Allow retry if operation failed
}

/**
 * Idempotency result
 */
export interface IdempotencyResult<T> {
  isFirstExecution: boolean;
  result?: T;
  previousError?: string;
}

/**
 * Ensures idempotent execution of mutations
 */
export async function withIdempotency<T>(
  ctx: MutationCtx,
  config: IdempotencyConfig,
  operation: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  const { key, scope, ttlMs = 3600000, allowRetry = false } = config; // Default 1 hour TTL

  // Check if operation was already executed
  const existingKey = await ctx.db
    .query("idempotencyKeys")
    .withIndex("by_key_scope", (q) => q.eq("key", key).eq("scope", scope))
    .unique();

  const now = Date.now();

  if (existingKey) {
    // Check if key has expired
    if (existingKey.createdAt + ttlMs < now) {
      // Key expired, delete it and allow re-execution
      await ctx.db.delete(existingKey._id);
    } else {
      // Key still valid, check if we should allow retry
      const metadata = existingKey.metadata as any;

      if (metadata?.failed && allowRetry) {
        // Previous execution failed and retry is allowed
        await ctx.db.delete(existingKey._id);
      } else if (metadata?.failed) {
        // Previous execution failed but retry not allowed
        return {
          isFirstExecution: false,
          previousError: metadata.error || "Previous execution failed",
        };
      } else {
        // Previous execution succeeded
        return {
          isFirstExecution: false,
          result: metadata?.result,
        };
      }
    }
  }

  // Create idempotency key before execution
  const idempotencyId = await ctx.db.insert("idempotencyKeys", {
    key,
    scope,
    metadata: { status: "executing", startedAt: now },
    createdAt: now,
  });

  try {
    // Execute the operation
    const result = await operation();

    // Update idempotency key with success
    await ctx.db.patch(idempotencyId, {
      metadata: {
        status: "completed",
        result,
        completedAt: Date.now(),
      },
    });

    return {
      isFirstExecution: true,
      result,
    };
  } catch (error) {
    // Update idempotency key with failure
    await ctx.db.patch(idempotencyId, {
      metadata: {
        status: "failed",
        failed: true,
        error: error instanceof Error ? error.message : "Unknown error",
        failedAt: Date.now(),
      },
    });

    throw error;
  }
}

/**
 * Ensures idempotent execution of actions (external calls)
 */
export async function withActionIdempotency<T>(
  ctx: ActionCtx,
  config: IdempotencyConfig,
  operation: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  const { key, scope, ttlMs = 3600000, allowRetry = true } = config; // Actions default to allow retry

  // Use internal queries/mutations since actions can't access DB directly
  const existingKey = await ctx.runQuery(internal.system.idempotency.getKey, {
    key,
    scope,
  });

  const now = Date.now();

  let idToUse: any | null = null;
  if (existingKey) {
    if (existingKey.createdAt + ttlMs < now) {
      // Key expired, delete it and allow re-execution
      await ctx.runMutation(internal.system.idempotency.deleteKey, {
        id: existingKey._id,
      });
    } else {
      const metadata = (existingKey.metadata as any) || {};
      if (metadata?.failed && allowRetry) {
        await ctx.runMutation(internal.system.idempotency.deleteKey, {
          id: existingKey._id,
        });
      } else if (metadata?.failed) {
        return {
          isFirstExecution: false,
          previousError: metadata.error || "Previous execution failed",
        };
      } else if (metadata?.status === "executing") {
        return {
          isFirstExecution: false,
          previousError: "Operation is currently executing",
        };
      } else {
        return {
          isFirstExecution: false,
          result: metadata?.result,
        };
      }
    }
  }

  // Create idempotency key before execution
  const idempotencyId = await ctx.runMutation(
    internal.system.idempotency.createKey,
    {
      key,
      scope,
      metadata: { status: "executing", startedAt: now },
      createdAt: now,
    },
  );

  try {
    const result = await operation();
    await ctx.runMutation(internal.system.idempotency.patchKey, {
      id: idempotencyId,
      metadata: {
        status: "completed",
        result,
        completedAt: Date.now(),
      },
    });
    return { isFirstExecution: true, result };
  } catch (error) {
    await ctx.runMutation(internal.system.idempotency.patchKey, {
      id: idempotencyId,
      metadata: {
        status: "failed",
        failed: true,
        error: error instanceof Error ? error.message : "Unknown error",
        failedAt: Date.now(),
      },
    });
    throw error;
  }
}

/**
 * Generates idempotency key for meeting operations
 */
export function generateMeetingOperationKey(
  meetingId: string,
  operation: string,
  userId?: string,
): string {
  const parts = [meetingId, operation];
  if (userId) parts.push(userId);
  return parts.join(":");
}

/**
 * Generates idempotency key for external service calls
 */
export function generateExternalServiceKey(
  service: string,
  operation: string,
  resourceId: string,
): string {
  return `${service}:${operation}:${resourceId}`;
}

/**
 * Cleans up expired idempotency keys
 */
export async function cleanupExpiredKeys(
  ctx: MutationCtx,
  olderThanMs: number = 24 * 60 * 60 * 1000, // Default 24 hours
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;

  const expiredKeys = await ctx.db
    .query("idempotencyKeys")
    .withIndex("by_created_at", (q) => q.lt("createdAt", cutoff))
    .collect();

  for (const key of expiredKeys) {
    await ctx.db.delete(key._id);
  }

  return expiredKeys.length;
}

/**
 * Idempotency utilities for common operations
 */
export const IdempotencyUtils = {
  /**
   * Creates idempotency config for meeting lifecycle operations
   */
  meetingLifecycle: (
    meetingId: string,
    operation: string,
    userId?: string,
  ): IdempotencyConfig => ({
    key: generateMeetingOperationKey(meetingId, operation, userId),
    scope: "meeting_lifecycle",
    ttlMs: 30 * 60 * 1000, // 30 minutes
    allowRetry: false, // Lifecycle operations should not be retried
  }),

  /**
   * Creates idempotency config for external service calls
   */
  externalService: (
    service: string,
    operation: string,
    resourceId: string,
  ): IdempotencyConfig => ({
    key: generateExternalServiceKey(service, operation, resourceId),
    scope: "external_service",
    ttlMs: 60 * 60 * 1000, // 1 hour
    allowRetry: true, // External calls can be retried
  }),

  /**
   * Creates idempotency config for WebRTC operations
   */
  webrtcOperation: (
    meetingId: string,
    sessionId: string,
    operation: string,
  ): IdempotencyConfig => ({
    key: `${meetingId}:${sessionId}:${operation}`,
    scope: "webrtc",
    ttlMs: 10 * 60 * 1000, // 10 minutes
    allowRetry: true, // WebRTC operations can be retried
  }),

  /**
   * Creates idempotency config for transcription operations
   */
  transcription: (meetingId: string, operation: string): IdempotencyConfig => ({
    key: `${meetingId}:${operation}`,
    scope: "transcription",
    ttlMs: 2 * 60 * 60 * 1000, // 2 hours
    allowRetry: true, // Transcription can be retried
  }),
};
