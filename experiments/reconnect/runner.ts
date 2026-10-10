/**
 * Manifest-driven runner for the reconnect study.
 *
 * Responsibilities:
 *  1. run the vitest suite (2 suites, 14 scenarios),
 *  2. verify every manifest scenario produced its result file and
 *     aggregate its counts into results/counts.json (deterministic: no
 *     timestamps), failing the run if a scenario is missing or a test failed,
 *  3. with --replay, diff the fresh counts against results/counts.prev.json
 *     and write results/replay.json, then rotate prev.
 *
 * Run from the repo root:
 *   corepack pnpm exec tsx experiments/reconnect/runner.ts            # first run
 *   corepack pnpm exec tsx experiments/reconnect/runner.ts --replay   # replay check
 * (tsx comes from the sibling dev-dependency install at
 * /home/user/work/connvo-testdeps; see README.)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const EXP = path.join(REPO_ROOT, "experiments", "reconnect");
const RESULTS = path.join(EXP, "results");

interface ManifestScenario {
  id: string;
  file: string;
  world: string;
  expectation: string;
}
interface Manifest {
  study: string;
  question: string;
  suites: ManifestScenario[];
}

const replay = process.argv.includes("--replay");
const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(EXP, "manifest.json"), "utf8"),
);

// -- 1) vitest -------------------------------------------------------------
const vitest = spawnSync(
  "corepack",
  ["pnpm", "exec", "vitest", "run", "--config", "experiments/reconnect/vitest.config.ts"],
  { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
);
if (vitest.status !== 0) {
  console.error("runner: vitest run failed");
  process.exit(1);
}

// -- 2) aggregate ----------------------------------------------------------
interface ScenarioResult {
  scenario?: string;
  sources?: string[];
  counts?: Record<string, unknown>;
  trace?: unknown;
}
interface Aggregated {
  study: string;
  question: string;
  vitest: { config: string; suites: number; scenarios: number; status: string };
  scenarios: Array<{
    id: string;
    world: string;
    expectation: string;
    sources: string[];
    counts: Record<string, unknown>;
  }>;
}

const aggregated: Aggregated = {
  study: manifest.study,
  question: manifest.question,
  vitest: {
    config: "experiments/reconnect/vitest.config.ts",
    suites: new Set(manifest.suites.map((s) => s.file)).size,
    scenarios: manifest.suites.length,
    status: "passed",
  },
  scenarios: [],
};

let missing = 0;
for (const scenario of manifest.suites) {
  const [suite, name] = scenario.id.split("/");
  const file = path.join(EXP, "results", "vitest", `${suite}-${name}.json`);
  if (!fs.existsSync(file)) {
    console.error(`runner: MISSING result for scenario ${scenario.id} (${file})`);
    missing++;
    continue;
  }
  const result = JSON.parse(fs.readFileSync(file, "utf8")) as ScenarioResult;
  aggregated.scenarios.push({
    id: scenario.id,
    world: scenario.world,
    expectation: scenario.expectation,
    sources: result.sources ?? [],
    counts: result.counts ?? {},
  });
}
if (missing > 0) {
  console.error(`runner: ${missing} scenario result(s) missing — not writing counts.json`);
  process.exit(1);
}

fs.writeFileSync(
  path.join(RESULTS, "counts.json"),
  JSON.stringify(aggregated, null, 2) + "\n",
);

// -- 3) replay -------------------------------------------------------------
const prevPath = path.join(RESULTS, "counts.prev.json");
if (replay) {
  if (!fs.existsSync(prevPath)) {
    console.error("runner: --replay requested but results/counts.prev.json is missing; run without --replay first");
    process.exit(1);
  }
  const prev = JSON.parse(fs.readFileSync(prevPath, "utf8")) as Aggregated;
  const perScenario = aggregated.scenarios.map((cur) => {
    const before = prev.scenarios.find((s) => s.id === cur.id);
    return {
      id: cur.id,
      agrees: !!before && JSON.stringify(before.counts) === JSON.stringify(cur.counts),
    };
  });
  const replayReport = {
    comparedRuns: prevPath,
    allScenariosAgree: perScenario.every((s) => s.agrees),
    perScenario,
  };
  fs.writeFileSync(path.join(RESULTS, "replay.json"), JSON.stringify(replayReport, null, 2) + "\n");
  console.log(`runner: replay ${replayReport.allScenariosAgree ? "AGREES" : "DISAGREES"}`);
}

// rotate current counts into prev for the next replay run
fs.copyFileSync(path.join(RESULTS, "counts.json"), prevPath);

console.log(
  `runner: ${aggregated.scenarios.length}/${manifest.suites.length} scenarios aggregated -> results/counts.json`,
);
