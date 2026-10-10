#!/usr/bin/env node
/**
 * CLI for the post-call evidence study.
 *
 * Run mode (source extraction, permissive generation, conservative refusal):
 *   pnpm exec tsx experiments/postcall-evidence/run.ts \
 *     --manifest experiments/postcall-evidence/manifest.json
 *
 * Replay mode (regenerate from frozen inputs and compare against the
 * committed results):
 *   pnpm exec tsx experiments/postcall-evidence/run.ts \
 *     --replay experiments/postcall-evidence/results
 *
 * The model-parser arm is NOT RUN: no model parser exists in Connvo and no
 * live endpoint is contacted. External effects: none (in-process only).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { findRepoRoot } from "./adapter";
import { executeStudy } from "./study";

const MANIFEST_DEFAULT = "experiments/postcall-evidence/manifest.json";

interface CliArgs {
  manifest?: string;
  replay?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--manifest") args.manifest = argv[++i];
    else if (argv[i] === "--replay") args.replay = argv[++i];
  }
  return args;
}

function ensureUnderExperiment(p: string): string {
  const resolved = path.resolve(p);
  if (!resolved.split(path.sep).includes("postcall-evidence")) {
    throw new Error(
      `Path must stay inside experiments/postcall-evidence/ (got ${resolved})`,
    );
  }
  return resolved;
}

function buildRecapData(execution: ReturnType<typeof executeStudy>["execution"], generatedAt: string) {
  return {
    schemaVersion: 1,
    generatedAt,
    sourceSha256: execution.sourceSha256,
    fixturesSha256: execution.fixturesSha256,
    canonical: execution.canonical,
    totals: execution.totals,
    modelArm: "not-run: no model parser exists in Connvo; offline study",
    groups: execution.groups.map((group) => ({
      groupId: group.groupId,
      metrics: group.metrics,
      meetings: group.meetings.map((meeting) => ({
        meetingId: meeting.meetingId,
        notesVersion: meeting.notesVersion,
        produced: meeting.produced,
        summary: meeting.summary,
        claims: meeting.claims.map((claim) => ({
          text: claim.text,
          rawEmissions: claim.rawEmissions,
          source: {
            kind: claim.position.sourceKind,
            segmentIndex: claim.position.segmentIndex,
            sentenceIndex: claim.position.sentenceIndex,
            charStart: claim.position.charStart,
            charEnd: claim.position.charEnd,
            startMs: claim.position.startMs,
            endMs: claim.position.endMs,
            quote: claim.position.quote,
          },
          label: claim.classification.label,
          unsupportedKind: claim.classification.unsupportedKind ?? null,
          conservative: claim.conservative,
        })),
        metrics: meeting.metrics,
      })),
    })),
  };
}

async function runMode(repoRoot: string, manifestPath: string): Promise<number> {
  const manifestResolved = ensureUnderExperiment(path.resolve(repoRoot, manifestPath));
  const resultsDir = ensureUnderExperiment(
    path.resolve(repoRoot, "experiments/postcall-evidence/results"),
  );
  fs.mkdirSync(resultsDir, { recursive: true });

  const relManifest = path.relative(repoRoot, manifestResolved);
  const { execution } = await executeStudy(repoRoot, relManifest);
  const generatedAt = new Date().toISOString();

  const runJson = {
    schemaVersion: 1,
    runAt: generatedAt,
    manifest: relManifest,
    sourceSha256: execution.sourceSha256,
    sliceSha256: execution.sliceSha256,
    fixturesSha256: execution.fixturesSha256,
    manifestSha256: execution.manifestSha256,
    canonical: execution.canonical,
    arms: {
      permissive: "production-heuristic (actual current output, unmodified)",
      conservative: "study-side refusal policy (provisional)",
      model: "NOT RUN - no model parser exists in Connvo; no live endpoint contacted",
    },
    totals: execution.totals,
    groups: execution.groups,
  };
  const runPath = path.join(resultsDir, "run.json");
  fs.writeFileSync(runPath, `${JSON.stringify(runJson, null, 2)}\n`);

  const recapPath = path.join(resultsDir, "recap-data.json");
  fs.writeFileSync(
    recapPath,
    `${JSON.stringify(buildRecapData(execution, generatedAt), null, 2)}\n`,
  );

  const t = execution.totals;
  console.log("postcall-evidence run complete");
  console.log(`  source sha256        ${execution.sourceSha256}`);
  console.log(`  canonical            ${execution.canonical}`);
  console.log(`  groups / meetings    ${t.groups} / ${t.meetings}`);
  console.log(`  cases (S/U)          ${t.cases} (${t.casesSupported}/${t.casesUnsupported})`);
  console.log(`  emitted raw/unique   ${t.emittedRaw} / ${t.emittedUnique}`);
  console.log(`  items supported      ${t.itemsSupported}`);
  console.log(`  items unsupported    ${t.itemsUnsupported}`);
  console.log(`  unsupported by kind  ${JSON.stringify(t.unsupportedByKind)}`);
  console.log(`  missed supported     ${t.missedSupported}`);
  console.log(`  conservative kept/refused  ${t.conservativeKept} / ${t.conservativeRefused}`);
  console.log(`  refusal reasons      ${JSON.stringify(t.conservativeRefusalReasons)}`);
  console.log(`  wrote ${path.relative(repoRoot, runPath)}`);
  console.log(`  wrote ${path.relative(repoRoot, recapPath)}`);
  console.log("  model arm: NOT RUN (no model parser exists; offline study)");
  return 0;
}

interface CommittedRun {
  canonical: string;
  sourceSha256: string;
  fixturesSha256: string;
  manifestSha256: string;
  totals: unknown;
  groups: unknown;
}

async function replayMode(repoRoot: string, resultsDirArg: string): Promise<number> {
  const resultsDir = ensureUnderExperiment(path.resolve(repoRoot, resultsDirArg));
  const runPath = path.join(resultsDir, "run.json");
  if (!fs.existsSync(runPath)) {
    console.error(`No committed run at ${runPath}; run with --manifest first.`);
    return 2;
  }
  const committed = JSON.parse(fs.readFileSync(runPath, "utf8")) as CommittedRun;

  const { execution } = await executeStudy(repoRoot, MANIFEST_DEFAULT);
  const replayedAt = new Date().toISOString();

  const sourceAgreement = execution.sourceSha256 === committed.sourceSha256;
  const fixturesAgreement = execution.fixturesSha256 === committed.fixturesSha256;
  const manifestAgreement = execution.manifestSha256 === committed.manifestSha256;
  const countsAgreement =
    JSON.stringify(execution.totals) === JSON.stringify(committed.totals);
  const claimsAgreement =
    JSON.stringify(execution.groups) === JSON.stringify(committed.groups);
  const agreement =
    sourceAgreement &&
    fixturesAgreement &&
    manifestAgreement &&
    countsAgreement &&
    claimsAgreement &&
    execution.canonical === committed.canonical;

  const replayJson = {
    schemaVersion: 1,
    replayedAt,
    committedCanonical: committed.canonical,
    recomputedCanonical: execution.canonical,
    sourceAgreement,
    fixturesAgreement,
    manifestAgreement,
    countsAgreement,
    claimsAgreement,
    agreement,
    modelArm: "NOT RUN - no model parser exists in Connvo; offline study",
  };
  const replayPath = path.join(resultsDir, "replay.json");
  fs.writeFileSync(replayPath, `${JSON.stringify(replayJson, null, 2)}\n`);

  console.log(`postcall-evidence replay: ${agreement ? "AGREEMENT" : "DISAGREEMENT"}`);
  console.log(`  committed canonical  ${committed.canonical}`);
  console.log(`  recomputed canonical ${execution.canonical}`);
  console.log(`  source ${sourceAgreement} fixtures ${fixturesAgreement} manifest ${manifestAgreement}`);
  console.log(`  counts ${countsAgreement} claims ${claimsAgreement}`);
  console.log(`  wrote ${path.relative(repoRoot, replayPath)}`);
  return agreement ? 0 : 1;
}

async function main(): Promise<number> {
  const repoRoot = findRepoRoot();
  const args = parseArgs(process.argv.slice(2));
  if (args.replay) return replayMode(repoRoot, args.replay);
  return runMode(repoRoot, args.manifest ?? MANIFEST_DEFAULT);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(
      "postcall-evidence run failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  },
);
