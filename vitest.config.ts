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
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true, // Avoid race conditions in Convex tests
      },
    },
    projects: [
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts", "convex/**/*.spec.ts"],
          environment: "edge-runtime",
          setupFiles: ["./convex/test/setup.ts"],
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
    ],
  },
  resolve: commonResolve,
});
