/**
 * Main Type System Entry Point
 *
 * This is the primary entry point for the centralized type system.
 * All entity types, validators, API responses, and domain types are
 * exported from this module for easy consumption.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.6
 * Compliance: steering/convex_rules.mdc - Barrel exports for reduced import friction
 */

// Main exports organized by category
export * from "./entities";
export * from "./validators";
export * from "./api";
export * from "./domain";

// Utility types
export * from "./utils";
