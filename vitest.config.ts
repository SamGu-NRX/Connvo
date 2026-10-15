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
          sequence: { groupOrder: 1 },
          include: [
            "convex/**/*.test.ts",
            "convex/**/*.spec.ts",
            "test/convex/**/*.test.ts",
            "test/convex/**/*.spec.ts",
          ],
          exclude: ["convex/types/__tests__/**"],
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
          name: "types",
          // These inspect validators and files; they do not execute Convex functions.
          environment: "node",
          include: ["convex/types/__tests__/**/*.test.ts"],
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
        resolve: commonResolve,
      },
      {
        test: {
          name: "frontend",
          maxWorkers: 1,
          sequence: { groupOrder: 2 },
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          environment: "jsdom",
        },
        resolve: commonResolve,
      },
      // M3 (connvo-notes-ledger-f1): mounted panel tests under test/in-call.
      // Additive only — jsdom + testing-library + jest-axe; the convex and
      // frontend projects above are untouched.
      {
        test: {
          name: "in-call",
          maxWorkers: 1,
          sequence: { groupOrder: 3 },
          // Transform AuthKit so the mounted provider test can replace server actions.
          server: { deps: { inline: ["@workos-inc/authkit-nextjs"] } },
          include: ["test/in-call/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./test/in-call/setup.ts"],
          // Project-level config replaces the root test block in Vitest 4, so
          // the 10k-run property proofs need their own generous timeout.
          testTimeout: 900000,
          hookTimeout: 30000,
        },
        resolve: commonResolve,
      },
      // M2 (connvo-notes-ledger-f1): notes ledger suite under test/notes —
      // ledger/diff units, the convex-test smoke, and the mounted fault
      // matrix. Additive only — jsdom + testing-library, convex-test inlined
      // like the convex project (the harness runs the real notes API).
      {
        test: {
          name: "notes",
          sequence: { groupOrder: 4 },
          include: ["test/notes/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./test/notes/setup.ts"],
          pool: "threads",
          maxWorkers: 1,
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
          name: "eval",
          maxWorkers: 1,
          sequence: { groupOrder: 5 },
          include: [
            "tools/call-eval/**/*.test.ts",
            "tools/call-eval/**/*.test.mjs",
          ],
          environment: "node",
        },
        resolve: commonResolve,
      },
    ],
  },
  resolve: commonResolve,
});
