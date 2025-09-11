/**
 * Idempotency Management
 *
 * This module provides idempotency key management for actions to ensure
 * exactly-once execution of critical operations.
 *
 * Requirements: 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { MutationCtx, ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "./errors";

/**
 * Generates an idempotency key for an operation
 */
export function generateIdempotencyKey(
  scope: string,
  identifier: string,
  operation: string,
): string {
  return `${scope}:${identifier}:${operation}`;
}

/**
 * Checks if an operation has already been performed
 */
export async function checkIdempotency(
  ctx: MutationCtx,
  key: string,
  scope: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query("idempotencyKeys")
    .withIndex("by_key_scope", (q) => q.eq("key", key).eq("scope", scope))
    .unique();

  return !!existing;
}

/**
 * Records an idempotency key to prevent duplicate operations
 */
export async function recordIdempotency(
  ctx: MutationCtx,
  key: string,
  scope: string,
): Promise<void> {
  const existing = await checkIdempotency(ctx, key, scope);

  if (existing) {
    throw createError.validation("Operation already performed", key);
  }

  await ctx.db.insert("idempotencyKeys", {
    key,
    scope,
    createdAt: Date.now(),
  });
}

/**
 * Wrapper for idempotent mutations
 */
export async function withIdempotency<T>(
  ctx: MutationCtx,
  key: string,
  scope: string,
  operation: () => Promise<T>,
): Promise<T> {
  const hasBeenExecuted = await checkIdempotency(ctx, key, scope);

  if (hasBeenExecuted) {
    throw createError.validation("Operation already performed", key);
  }

  // Record the key before executing to prevent race conditions
  await recordIdempotency(ctx, key, scope);

  try {
    return await operation();
  } catch (error) {
    // If operation fails, we might want to remove the key to allow retry
    // This depends on the specific use case and error type
    throw error;
  }
}

/**
 * Cleans up old idempotency keys (should be run periodically)
 */
export async function cleanupIdempotencyKeys(
  ctx: MutationCtx,
  olderThanMs: number = 24 * 60 * 60 * 1000, // 24 hours
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;

  const oldKeys = await ctx.db
    .query("idempotencyKeys")
    .filter((q) => q.lt(q.field("createdAt"), cutoff))
    .collect();

  for (const key of oldKeys) {
    await ctx.db.delete(key._id);
  }

  return oldKeys.length;
}
