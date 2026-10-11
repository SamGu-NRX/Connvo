/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import path from "path";

const commonResolve = {
  alias: {
    "@": path.resolve(__dirname, "./src"),
    "@convex": path.resolve(__dirname, "./convex"),
  },
};

export default defineConfig({
  test: {
    globals: true,
    exclude: ["node_modules/**", ".next/**", "dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
    projects: [
      {
        test: {
          name: "convex",
          include: [
            "convex/**/*.test.ts",
            "convex/**/*.spec.ts",
            "test/convex/**/*.test.ts",
            "test/convex/**/*.spec.ts",
          ],
          environment: "edge-runtime",
          setupFiles: ["./test/convex/setup.ts"],
          pool: "threads",
          maxWorkers: 1, // Run tests sequentially to avoid race conditions
          isolate: false, // Disable isolation for single-threaded execution
          server: {
            deps: {
              inline: ["convex-test"],
            },
          },
        },
        resolve: commonResolve,
      },
      {
        test: {
          name: "frontend",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          environment: "jsdom",
        },
        resolve: commonResolve,
      },
  {
    // In-call client contract witnesses. Runs in the plain node
    // environment: the existing "frontend" project requires jsdom (not
    // installed) and only covers src/**, while these tests drive the real
    // hooks through a fake transport via react-dom/server (no DOM needed).
    test: {
      name: "in-call",
      include: ["test/in-call/**/*.test.ts"],
      environment: "node",
      testTimeout: 30000,
      hookTimeout: 30000,
    },
    resolve: commonResolve,
  }
  
    ],
  },
  resolve: commonResolve,
});
