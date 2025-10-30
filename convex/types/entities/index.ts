/**
 * Centralized Entity Type Definitions
 *
 * This module provides a single source of truth for all entity types
 * across the Connvo Convex backend.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 * Compliance: steering/convex_rules.mdc - Type-first approach with proper exports
 */

// Core entity exports
export * from "./user";
export * from "./meeting";
export * from "./transcript";
export * from "./note";
export * from "./prompt";
export * from "./matching";
export * from "./webrtc";
export * from "./embedding";
export * from "./messaging";
export * from "./system";
export * from "./stream";

// Re-export common types for convenience
export type { Id } from "@convex/_generated/dataModel";
