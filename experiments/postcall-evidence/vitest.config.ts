import { defineConfig } from "vitest/config";

// Scoped config for the post-call evidence study only. Run from the repo
// root: `pnpm exec vitest run --config experiments/postcall-evidence/vitest.config.ts`
// This suite intentionally excludes every other test in the repository.
export default defineConfig({
  test: {
    environment: "node",
    include: ["experiments/postcall-evidence/**/*.test.ts"],
    testTimeout: 30000,
  },
});
