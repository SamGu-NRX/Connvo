/**
 * Shared Utility Types
 *
 * This module provides common utility types used across the type system
 * for consistent patterns and branded types.
 *
 * Requirements: 1.1, 1.5, 7.1, 7.2, 7.3
 * Compliance: steering/convex_rules.mdc - Type safety and performance
 */

import type { Id } from "@convex/_generated/dataModel";

// Branded time types for enhanced type safety
export type EpochMs = number & { readonly __brand: "EpochMs" };
export type DurationMs = number & { readonly __brand: "DurationMs" };

// Helper functions for branded types
export const toEpochMs = (timestamp: number): EpochMs => timestamp as EpochMs;
export const toDurationMs = (duration: number): DurationMs =>
  duration as DurationMs;

// Common entity patterns
export interface BaseEntity {
  _id: Id<any>;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

// Audit trail pattern
export interface AuditableEntity extends BaseEntity {
  createdBy?: Id<"users">;
  updatedBy?: Id<"users">;
}

// Soft delete pattern
export interface SoftDeletableEntity extends BaseEntity {
  deletedAt?: EpochMs;
  deletedBy?: Id<"users">;
  isDeleted: boolean;
}

// Versioning pattern
export interface VersionedEntity extends BaseEntity {
  version: number;
  lastModifiedBy?: Id<"users">;
}

// Status pattern for state machines
export interface StatefulEntity<TState extends string> extends BaseEntity {
  state: TState;
  stateChangedAt: EpochMs;
  stateChangedBy?: Id<"users">;
}

// Common field patterns
export type OptionalString = string | undefined;
export type OptionalNumber = number | undefined;
export type OptionalBoolean = boolean | undefined;

// Array buffer helpers for embeddings (performance optimization)
export interface EmbeddingVector {
  data: ArrayBuffer; // Use v.bytes() for optimal storage
  dimensions: number;
  model: string;
}

// Helper to convert Float32Array to/from ArrayBuffer
export const float32ArrayToBuffer = (array: Float32Array): ArrayBuffer =>
  array.buffer;
export const bufferToFloat32Array = (buffer: ArrayBuffer): Float32Array =>
  new Float32Array(buffer);

// Common validation patterns
export type NonEmptyString = string & { readonly __brand: "NonEmptyString" };
export type PositiveNumber = number & { readonly __brand: "PositiveNumber" };
export type EmailAddress = string & { readonly __brand: "EmailAddress" };
export type URL = string & { readonly __brand: "URL" };

// Helper functions for validation
export const toNonEmptyString = (str: string): NonEmptyString => {
  if (!str.trim()) throw new Error("String cannot be empty");
  return str as NonEmptyString;
};

export const toPositiveNumber = (num: number): PositiveNumber => {
  if (num <= 0) throw new Error("Number must be positive");
  return num as PositiveNumber;
};

export const toEmailAddress = (email: string): EmailAddress => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) throw new Error("Invalid email address");
  return email as EmailAddress;
};

export const toURL = (url: string): URL => {
  try {
    new globalThis.URL(url);
    return url as URL;
  } catch {
    throw new Error("Invalid URL");
  }
};
