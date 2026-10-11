/**
 * Entry point for the reconnect study. Runs fully offline.
 *
 *   npx tsx experiments/reconnect/run.ts                     # everything
 *   npx tsx experiments/reconnect/run.ts --section=handlers  # production handlers only
 *   npx tsx experiments/reconnect/run.ts --section=vitest    # hook scenarios only
 *   npx tsx experiments/reconnect/run.ts --section=walk      # browser walk only
 *
 * Sections:
 *  - handlers: PRODUCTION-OBSERVED duplicate-delivery receipts from the real
 *    registered handlers (convex-test, real schema + auth guards) ->
 *    results/production-handlers.json
 *  - vitest: the 14 fake-transport hook scenarios (SIMULATED-TRANSPORT label)
 *    via experiments/reconnect/vitest.config.ts
 *  - walk: the browser keyboard walk of the real hooks (reduced motion) ->
 *    results/walk/*.png + results/walk.json
 *
 * tsx treats run files as CJS — no top-level await.
 */

/* eslint-disable no-console */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function run(cmd: string, args: string[], label: string): void {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: repoRoot });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status})`);
  }
}

async function main(): Promise<void> {
  const section = arg("section", "all");
  const want = (s: string) => section === "all" || section === s;

  if (want("handlers")) {
    console.log("\n=== PRODUCTION-OBSERVED: real handlers under duplicate delivery ===");
    const { runProductionHandlers } = await import("./production-handlers");
    await runProductionHandlers(
      join(here, "results", "production-handlers.json"),
    );
  }

  if (want("vitest")) {
    run(
      "corepack",
      ["pnpm", "exec", "vitest", "run", "--config", "experiments/reconnect/vitest.config.ts"],
      "SIMULATED-TRANSPORT: hook scenarios (vitest)",
    );
  }

  if (want("walk")) {
    run(
      "bash",
      ["experiments/reconnect/prototype/build.sh"],
      "build browser prototype",
    );
    run("node", ["experiments/reconnect/prototype/walk.mjs"], "browser walk (keyboard, reduced motion)");
  }

  console.log("\nreconnect study: sections complete. Evidence in experiments/reconnect/results/.");
  // convex-test's backend keeps scheduler handles open after all work is
  // done; exit explicitly once every requested section has finished.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
