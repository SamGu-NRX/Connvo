/**
 * Common Validator Utilities
 *
 * This module provides shared validator patterns and utilities used
 * across all entity validators.
 *
 * Requirements: 1.6, 1.7, 2.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 * Compliance: steering/convex_rules.mdc - Proper validator patterns
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

// Re-export Convex pagination validator
export { paginationOptsValidator };

// Common field validators
export const CommonV = {
  // Time-related validators
  epochMs: v.number(),
  durationMs: v.number(),

  // String validators
  nonEmptyString: v.string(),
  email: v.string(),
  url: v.string(),

  // Numeric validators
  positiveNumber: v.number(),
  nonNegativeNumber: v.number(),

  // Array validators
  stringArray: v.array(v.string()),
  numberArray: v.array(v.number()),

  // Object validators
  metadata: v.record(
    v.string(),
    v.union(v.string(), v.number(), v.boolean()),
  ),

  // Embedding vector (using ArrayBuffer for performance)
  embeddingVector: v.object({
    data: v.bytes(), // ArrayBuffer for optimal storage
    dimensions: v.number(),
    model: v.string(),
  }),

  // Common entity patterns
  baseEntity: v.object({
    _id: v.string(), // Will be overridden with specific v.id() in actual entities
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  auditableEntity: v.object({
    _id: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.optional(v.id("users")),
    updatedBy: v.optional(v.id("users")),
  }),

  softDeletableEntity: v.object({
    _id: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
    isDeleted: v.boolean(),
  }),

  versionedEntity: v.object({
    _id: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.number(),
    lastModifiedBy: v.optional(v.id("users")),
  }),
} as const;

// Error validators
export const ErrorV = {
  validationError: v.object({
    field: v.string(),
    message: v.string(),
    code: v.string(),
  }),

  apiError: v.object({
    code: v.string(),
    message: v.string(),
    details: v.optional(v.record(v.string(), v.any())),
    timestamp: v.number(),
  }),
} as const;

// State machine validator factory
export const StatefulEntityV = <TState extends string>(stateValidator: any) =>
  v.object({
    _id: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    state: stateValidator,
    stateChangedAt: v.number(),
    stateChangedBy: v.optional(v.id("users")),
  });
