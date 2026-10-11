/**
 * Entry point for the reconnect study (replaces runner.ts).
 *
 *   corepack pnpm exec tsx experiments/reconnect/run.ts                     # everything
 *   corepack pnpm exec tsx experiments/reconnect/run.ts --section=handlers  # production handlers only
 *   corepack pnpm exec tsx experiments/reconnect/run.ts --section=vitest    # vitest + aggregation only
 *   corepack pnpm exec tsx experiments/reconnect/run.ts --section=walk      # browser walk only
 *   corepack pnpm exec tsx experiments/reconnect/run.ts --replay            # + determinism check
 *
 * Sections:
 *  - handlers: the standalone [production-handler] script
 *    (production-handlers.ts) invoked directly — convex-test against the
 *    real schema, validators, and auth guards, no fake transport ->
 *    results/production-handlers.json
 *  - vitest: ALL suites (14 [simulated-transport] hook scenarios, the 9
 *    [production-handler] convex-test scenarios in
 *    scenarios/productionHandlers.test.ts, and the receipt-pin tests in
 *    production-handlers.test.ts), then aggregates results/counts.json
 *    (every scenario tagged with its layer) and
 *    results/productionHandlers.json (observed duplicate-delivery verdicts
 *    from the registered handlers, merged from both production suites).
 *    --replay diffs the fresh counts against results/counts.prev.json into
 *    results/replay.json, then rotates prev.
 *  - walk: builds the browser prototype and runs the KEYBOARD-ONLY walk
 *    (reducedMotion 'reduce', zero mouse input) -> results/walk/*.png +
 *    results/walk.json
 *
 * tsx treats this file as CJS — no top-level await.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const EXP = path.join(REPO_ROOT, "experiments", "reconnect");
const RESULTS = path.join(EXP, "results");

const replay = process.argv.includes("--replay");
function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
const section = arg("section", "all");
const want = (s: string) => section === "all" || section === s;

type Layer = "simulated-transport" | "production-handler";

interface ManifestScenario {
  id: string;
  file: string;
  world: string;
  expectation: string;
  layer?: Layer;
  /** Combined-receipt suites: file holding {observations:[{id,...}]}. */
  receipt?: string;
  observationsId?: string;
}
interface Manifest {
  study: string;
  question: string;
  suites: ManifestScenario[];
}

interface Receipt {
  scenario?: string;
  handler?: string;
  sources?: string[];
  counts?: Record<string, unknown>;
  observedDuplicateVerdict?: string;
  harnessNote?: string;
  deliveries?: Array<Record<string, unknown>>;
}

// -- 0) handlers section (standalone production script, not vitest) ---------
async function runHandlers(): Promise<void> {
  console.log("\n=== [production-handler] registered handlers under duplicate delivery ===");
  const { runProductionHandlers } = await import("./production-handlers");
  await runProductionHandlers(path.join(RESULTS, "production-handlers.json"));
}

// -- 1) vitest (all suites) --------------------------------------------------
function runVitest(): void {
  const vitest = spawnSync(
    "corepack",
    ["pnpm", "exec", "vitest", "run", "--config", "experiments/reconnect/vitest.config.ts"],
    { stdio: "inherit" },
  );
  if (vitest.status !== 0) {
    console.error("run: vitest failed — not writing aggregates");
    process.exit(1);
  }
}

// -- 2) aggregate ------------------------------------------------------------
interface AggregatedScenario {
  id: string;
  layer: Layer;
  world: string;
  expectation: string;
  sources: string[];
  counts: Record<string, unknown>;
  handler?: string;
  observedDuplicateVerdict?: string;
  harnessNote?: string;
}

/** Deterministic per-scenario tally computed from what was recorded. */
function tally(receipt: Receipt): Record<string, unknown> {
  const deliveries = receipt.deliveries ?? [];
  const outcomes: Record<string, number> = {};
  for (const d of deliveries) {
    const key = String(d.outcome ?? "unknown");
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }
  return { deliveries: deliveries.length, outcomes };
}

function aggregate(): { scenarios: AggregatedScenario[]; manifest: Manifest } {
  const manifest: Manifest = JSON.parse(
    fs.readFileSync(path.join(EXP, "manifest.json"), "utf8"),
  );

  const scenarios: AggregatedScenario[] = [];
  let missing = 0;
  for (const scenario of manifest.suites) {
    if (scenario.receipt && scenario.observationsId) {
      // Combined-receipt suite (production-handlers.test.ts pins one file).
      const combined = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, scenario.receipt), "utf8"),
      ) as { observations?: Array<Record<string, unknown>> };
      const obs = combined.observations?.find((o) => o.id === scenario.observationsId);
      if (!obs) {
        console.error(`run: MISSING observation ${scenario.observationsId} in ${scenario.receipt}`);
        missing++;
        continue;
      }
      scenarios.push({
        id: scenario.id,
        layer: scenario.layer ?? "production-handler",
        world: scenario.world,
        expectation: scenario.expectation,
        sources: [],
        counts: { observed: obs.observed },
        handler: String(obs.handler ?? ""),
      });
      continue;
    }
    const [suite, name] = scenario.id.split("/");
    const file = path.join(EXP, "results", "vitest", `${suite}-${name}.json`);
    if (!fs.existsSync(file)) {
      console.error(`run: MISSING result for scenario ${scenario.id} (${file})`);
      missing++;
      continue;
    }
    const receipt = JSON.parse(fs.readFileSync(file, "utf8")) as Receipt;
    const layer: Layer = scenario.layer ?? "simulated-transport";
    scenarios.push({
      id: scenario.id,
      layer,
      world: scenario.world,
      expectation: scenario.expectation,
      sources: receipt.sources ?? [],
      counts: layer === "production-handler" ? tally(receipt) : receipt.counts ?? {},
      ...(receipt.handler !== undefined ? { handler: receipt.handler } : {}),
      ...(receipt.observedDuplicateVerdict !== undefined
        ? { observedDuplicateVerdict: receipt.observedDuplicateVerdict }
        : {}),
      ...(receipt.harnessNote !== undefined ? { harnessNote: receipt.harnessNote } : {}),
    });
  }
  if (missing > 0) {
    console.error(`run: ${missing} scenario result(s) missing — not writing aggregates`);
    process.exit(1);
  }
  return { scenarios, manifest };
}

function writeAggregates(scenarios: AggregatedScenario[], manifest: Manifest): void {
  const production = scenarios.filter((s) => s.layer === "production-handler");

  const counts = {
    study: manifest.study,
    question: manifest.question,
    vitest: {
      config: "experiments/reconnect/vitest.config.ts",
      suites: new Set(manifest.suites.map((s) => s.file)).size,
      scenarios: manifest.suites.length,
      status: "passed" as const,
    },
    scenarios,
  };
  fs.writeFileSync(path.join(RESULTS, "counts.json"), JSON.stringify(counts, null, 2) + "\n");

  // results/productionHandlers.json — merged production-handler receipt
  // (per-scenario verdicts from scenarios/productionHandlers.test.ts plus the
  // observations recorded by production-handlers.ts).
  const combinedReceipt = path.join(RESULTS, "production-handlers.json");
  const scriptObservations: Array<Record<string, unknown>> = [];
  if (fs.existsSync(combinedReceipt)) {
    const combined = JSON.parse(fs.readFileSync(combinedReceipt, "utf8")) as {
      observations?: Array<Record<string, unknown>>;
    };
    scriptObservations.push(...(combined.observations ?? []));
  }
  const productionReceipt = {
    layer: "production-handler" as const,
    backend: "convex-test 0.0.38 against the real schema, validators, and auth guards",
    note:
      "verdicts are what the REGISTERED handlers did when the same delivery arrived twice — observed, not scripted in the fake transport",
    suites: {
      scenariosProductionHandlersTest: production
        .filter((s) => s.observedDuplicateVerdict !== undefined)
        .map((s) => ({
          id: s.id,
          handler: s.handler,
          observedDuplicateVerdict: s.observedDuplicateVerdict,
          ...(s.harnessNote !== undefined ? { harnessNote: s.harnessNote } : {}),
          counts: s.counts,
        })),
      productionHandlersScript: scriptObservations.map((o) => ({
        id: o.id,
        handler: o.handler,
        delivery: o.delivery,
        observed: o.observed,
      })),
    },
  };
  fs.writeFileSync(
    path.join(RESULTS, "productionHandlers.json"),
    JSON.stringify(productionReceipt, null, 2) + "\n",
  );
}

// -- 3) replay ----------------------------------------------------------------
function writeReplay(scenarios: AggregatedScenario[]): void {
  const prevPath = path.join(RESULTS, "counts.prev.json");
  if (!fs.existsSync(prevPath)) {
    console.error("run: --replay requested but results/counts.prev.json is missing; run without --replay first");
    process.exit(1);
  }
  const prev = JSON.parse(fs.readFileSync(prevPath, "utf8")) as {
    scenarios?: AggregatedScenario[];
  };
  const perScenario = scenarios.map((cur) => {
    const before = prev.scenarios?.find((s) => s.id === cur.id);
    return {
      id: cur.id,
      layer: cur.layer,
      agrees: !!before && JSON.stringify(before.counts) === JSON.stringify(cur.counts),
    };
  });
  const replayReport = {
    comparedRuns: "results/counts.prev.json",
    allScenariosAgree: perScenario.every((s) => s.agrees),
    perScenario,
  };
  fs.writeFileSync(path.join(RESULTS, "replay.json"), JSON.stringify(replayReport, null, 2) + "\n");
  console.log(`run: replay ${replayReport.allScenariosAgree ? "AGREES" : "DISAGREES"}`);
}

// -- main (CJS-safe: async main, no top-level await) ---------------------------
async function main(): Promise<void> {
  if (want("handlers")) await runHandlers();

  if (want("vitest")) {
    runVitest();
    const { scenarios, manifest } = aggregate();
    writeAggregates(scenarios, manifest);
    if (replay) writeReplay(scenarios);
    fs.copyFileSync(path.join(RESULTS, "counts.json"), path.join(RESULTS, "counts.prev.json"));
    console.log(
      `run: ${scenarios.length}/${manifest.suites.length} scenarios aggregated ` +
        `(${scenarios.filter((s) => s.layer === "simulated-transport").length} [simulated-transport], ` +
        `${scenarios.filter((s) => s.layer === "production-handler").length} [production-handler]) ` +
        `-> results/counts.json, results/productionHandlers.json`,
    );
  }

  if (want("walk")) {
    console.log("\n=== browser walk (keyboard-only, reduced motion) ===");
    const build = spawnSync("bash", ["experiments/reconnect/prototype/build.sh"], { stdio: "inherit" });
    if (build.status !== 0) {
      console.error("run: prototype build failed");
      process.exit(1);
    }
    const walk = spawnSync("node", ["experiments/reconnect/prototype/walk.mjs"], { stdio: "inherit" });
    if (walk.status !== 0) {
      console.error("run: browser walk failed");
      process.exit(1);
    }
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
