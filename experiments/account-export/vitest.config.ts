import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Scoped config: only this experiment's tests, resolved against the repo root
// so the repo's root vitest config is not polluted by experiment-local setup.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@convex": path.resolve(root, "../../convex"),
    },
  },
  test: {
    environment: "node",
    include: ["experiments/account-export/account-export.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
