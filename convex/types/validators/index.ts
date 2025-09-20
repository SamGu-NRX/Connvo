/**
 * Centralized Validator Definitions
 *
 * This module provides Convex validators that correspond to the centralized
 * TypeScript types, ensuring type-validator alignment.
 *
 * Requirements: 1.1, 1.2, 1.6, 1.7, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns
 */

// Validator exports
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

// Domain-specific validators
export * from "./operationalTransform";
export * from "./realTime";

// API response validators
export * from "./responses";
export * from "./pagination";

// Common validator utilities
export * from "./common";
