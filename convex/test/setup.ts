/// <reference types="vite/client" />

/**
 * Test Setup for Convex Functions
 *
 * This file configures the test environment for Convex functions.
 * It exports the modules glob required by convex-test to properly
 * resolve function imports in the test environment. - index.ts check as well
 *
 * Requirements: 1.1, 1.2, 1.3, 3.1, 3.2
 * Compliance: steering/convex_rules.mdc - Proper test setup patterns
 */

import { beforeEach, afterEach } from "vitest";

// Export modules glob for convex-test to resolve function imports
// This fixes the "(intermediate value).glob is not a function" error
export const modules = import.meta.glob("../**/*.ts");

// Global test setup
beforeEach(() => {
  // Reset any global state before each test
  // Clear console to avoid test pollution
  console.clear();
});

afterEach(() => {
  // Clean up after each test
  // This ensures test isolation
});
