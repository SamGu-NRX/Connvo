import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Experiment-local vitest config for experiments/match-explanations.
 * Deliberately standalone: it does NOT import or extend the root
 * vitest.config.ts (root test infrastructure stays untouched), uses the
 * plain node environment (no convex-test harness), and only picks up test
 * files inside this experiment directory.
 */
export default defineConfig({
  root: path.resolve(__dirname, "..", ".."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "..", "..", "src"),
      "@convex": path.resolve(__dirname, "..", "..", "convex"),
    },
  },
  test: {
    name: "match-explanations",
    environment: "node",
    include: ["experiments/match-explanations/**/*.test.ts"],
    testTimeout: 30000,
  },
});
