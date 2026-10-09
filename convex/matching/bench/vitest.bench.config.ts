/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Standalone config for the matching load harness.
 *
 * Run with (one command, from the repo root):
 *   bash convex/matching/bench/run.sh <tag>
 *
 * Kept separate from vitest.config.ts so `pnpm test:run` never executes the
 * benchmark (files match `*.bench.ts`, which the main config does not pick
 * up), and so bench runs get a long timeout and single-worker pool.
 */
export default defineConfig({
  root: path.resolve(__dirname, "../../.."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../../src"),
      "@convex": path.resolve(__dirname, "../../../convex"),
    },
  },
  test: {
    name: "matching-bench",
    globals: true,
    environment: "edge-runtime",
    setupFiles: ["./test/convex/setup.ts"],
    include: ["convex/matching/bench/**/*.bench.ts"],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    pool: "threads",
    maxWorkers: 1,
    isolate: false,
    typecheck: { enabled: false },
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
