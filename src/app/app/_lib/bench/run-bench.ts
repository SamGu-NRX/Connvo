/**
 * Benchmark harness for `src/app/app/` hot paths.
 *
 * Run with one command from the repo root:
 *
 *   npm run bench:app            # human-readable table
 *   npm run bench:app -- --json  # machine-readable JSON
 *
 * Each suite under `./suites/` measures a before/after pair:
 * the FROZEN original inline code vs. the optimized helper the page now
 * uses. Medians are taken over repeated interleaved samples and the
 * machine load average is printed with the results.
 *
 * Protocol and conventions: see `src/app/app/_lib/README.md`.
 */
import path from "node:path";
import {
  formatMs,
  getResults,
  loadavgSnapshot,
  machineInfo,
} from "./harness";
import type { Suite } from "./types";
import type { BenchMeasurement } from "./types";

// One line per part-suite. Suites are stubbed until their part fills them.
import suite01DashboardView from "./suites/01-dashboard-view.bench";
import suite02ProfileHelpers from "./suites/02-profile-helpers.bench";
import suite03SettingsPage from "./suites/03-settings-page.bench";
import suite04SettingsToggle from "./suites/04-settings-toggle.bench";
import suite05MeetingSummaryParse from "./suites/05-meeting-summary-parse.bench";
import suite06MeetingSummaryView from "./suites/06-meeting-summary-view.bench";
import suite07CallRedirect from "./suites/07-call-redirect.bench";
import suite08QueueParams from "./suites/08-queue-params.bench";
import suite09ProfessionalQuery from "./suites/09-professional-query.bench";
import suite10ProfessionalSubpages from "./suites/10-professional-subpages.bench";
import suite11HomeLayout from "./suites/11-home-layout.bench";

const SUITES: Suite[] = [
  suite01DashboardView,
  suite02ProfileHelpers,
  suite03SettingsPage,
  suite04SettingsToggle,
  suite05MeetingSummaryParse,
  suite06MeetingSummaryView,
  suite07CallRedirect,
  suite08QueueParams,
  suite09ProfessionalQuery,
  suite10ProfessionalSubpages,
  suite11HomeLayout,
];

const jsonMode = process.argv.includes("--json");

async function main(): Promise<void> {
  const loadavgAtStart = loadavgSnapshot();
  for (const suite of SUITES) {
    await suite.run();
  }

  const results = getResults();

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          machine: machineInfo(),
          loadavg: { atStart: loadavgAtStart, atEnd: loadavgSnapshot() },
          results,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  process.stdout.write(`== Connvo src/app/app benchmark ==\n`);
  process.stdout.write(`${machineInfo()}\n`);
  process.stdout.write(`loadavg at start: ${loadavgAtStart}\n\n`);

  const nameWidth = Math.max(
    "hot path".length,
    ...results.map((r) => r.name.length),
  );
  const suiteWidth = Math.max(
    "suite".length,
    ...results.map((r) => r.suite.length),
  );

  const header =
    `${"suite".padEnd(suiteWidth)}  ${"hot path".padEnd(nameWidth)}  ` +
    `${"before (median)".padStart(16)}  ${"after (median)".padStart(16)}  ` +
    `${"delta".padStart(10)}   note`;
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${"-".repeat(header.length + 8)}\n`);

  for (const r of results) {
    const ratio =
      r.beforeMsPerCall > 0 && r.afterMsPerCall > 0
        ? r.beforeMsPerCall / r.afterMsPerCall
        : Number.NaN;
    const delta = Number.isFinite(ratio)
      ? `${ratio.toFixed(2)}x`
      : "n/a";
    process.stdout.write(
      `${r.suite.padEnd(suiteWidth)}  ${r.name.padEnd(nameWidth)}  ` +
        `${formatMs(r.beforeMsPerCall).padStart(16)}  ` +
        `${formatMs(r.afterMsPerCall).padStart(16)}  ` +
        `${delta.padStart(10)}   ${r.note ?? ""}\n`,
    );
  }
  if (results.length === 0) {
    process.stdout.write("(no benches recorded — all suites are stubs)\n");
  }

  process.stdout.write(`\nloadavg at end: ${loadavgSnapshot()}\n`);
}

main().catch((error) => {
  // Benchmarks must never fail the build; print and exit non-zero so the
  // failure is visible in CI logs.
  process.stderr.write(`bench:app failed: ${String(error)}\n`);
  process.exitCode = 1;
});
