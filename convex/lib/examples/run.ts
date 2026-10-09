/**
 * Runnable examples for convex/lib — terminal runner.
 *
 * Executes every module's self-asserting examples and prints one line per example.
 * Exits non-zero if any example throws or reports no results, so it can be used
 * as a CI-style gate.
 *
 * Usage:
 *   npx tsx convex/lib/examples/run.ts
 */

import { exampleModules, type ExampleResult } from "./index";

async function main(): Promise<void> {
  let failed = 0;
  let total = 0;

  for (const { module, run } of exampleModules) {
    try {
      const results: ExampleResult[] = await run();
      if (!Array.isArray(results) || results.length === 0) {
        failed++;
        console.log(`FAIL ${module}: returned no results`);
        continue;
      }
      for (const r of results) {
        total++;
        console.log(`ok   [${module}] ${r.name} — ${r.detail}`);
      }
    } catch (err) {
      failed++;
      console.log(`FAIL ${module}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${total} examples ran, ${failed} module(s) failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
