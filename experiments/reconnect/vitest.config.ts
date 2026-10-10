/// <reference types="vitest/config" />
import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Experiment-only vitest config for the reconnect study. Deliberately
 * standalone: it does not inherit the root config's projects, typecheck
 * step, or setup files, and nothing outside experiments/reconnect/ is
 * included.
 */

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
      "@convex": path.resolve(__dirname, "../../convex"),
    },
  },
  test: {
    globals: true,
    environment: path.resolve(__dirname, "./env/jsdom-sibling.ts"),
    include: ["experiments/reconnect/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
