/**
 * Replay-falsifier and honest-reproduction tests for the matched-pair
 * decision receipt (reviewer round 2).
 *
 * The pre-fix normalizer ranked participant ids within the MATCHED SUBSET of
 * each matching, so a replayed run that matched a DIFFERENT subset with the
 * same pair count and relative order produced the identical compressed
 * signature and wrongly passed. Example: recorded pair 0-1 vs replayed pair
 * 2-3 both compressed to "0-1".
 *
 * The fixed normalizer maps participant ids to indices in the COMPLETE
 * population plan insertion order, so any change in WHICH users matched
 * breaks agreement.
 *
 * Both tests exercise the real replay path: the actual manifest scenario
 * executed through convex-test, the actual `replay()`/`replayPasses()` code
 * from run.ts, and the actual receipt comparator. Only the hypothetical
 * PRIOR run's recorded artifacts are fabricated — that is the point of a
 * falsifier: a recorded history that disagrees with what the code really
 * does must be rejected.
 */

import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  executeScenario,
  type ScenarioResult,
} from "../../experiments/matching-study/src/runFlow.js";
import {
  hashStudySources,
  sha256File,
} from "../../experiments/matching-study/src/artifacts.js";
import {
  runInvariantSuite,
  type InvariantSuiteOutput,
} from "../../experiments/matching-study/src/invariantScenarios.js";
import type { ScenarioSpec } from "../../experiments/matching-study/src/types.js";
import {
  matchedPairsReceipt,
  nodeFactory,
  replay,
  replayPasses,
} from "../../experiments/matching-study/run.js";
import type { RuntimeFactory } from "../../experiments/matching-study/src/runFlow.js";

const SCENARIO = "quality-n4-s101";

/** Replica of the PRE-FIX normalizer (subset-compressed ranks), kept here
 * only to document the historical flaw: it assigns the same signature to
 * different matched subsets with preserved relative order. */
function preFixSignatureReplica(
  decisions: Array<{ user1: string; user2: string }>,
): string[] {
  const ids = new Set<string>();
  for (const d of decisions) {
    ids.add(d.user1);
    ids.add(d.user2);
  }
  const ordinal = (id: string): number => {
    const m = /^(\d+);/.exec(id);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const ranked = new Map<string, number>();
  [...ids]
    .sort((a, b) => ordinal(a) - ordinal(b))
    .forEach((id, i) => ranked.set(id, i));
  return decisions
    .map((d) => {
      const a = ranked.get(d.user1) as number;
      const b = ranked.get(d.user2) as number;
      return a < b ? `${a}-${b}` : `${b}-${a}`;
    })
    .sort();
}

describe("matched-pair decision receipt (replay falsifier)", () => {
  let tmpRoot: string;
  let factory: RuntimeFactory;
  let spec: ScenarioSpec;
  let genuine: ScenarioResult;
  let suite: InvariantSuiteOutput;
  let realPair: Array<{ user1: string; user2: string }>;
  let shiftedPair: Array<{ user1: string; user2: string }>;

  beforeAll(async () => {
    const repoRoot = process.cwd();
    const manifestPath = nodePath.join(
      repoRoot,
      "experiments",
      "matching-study",
      "manifest.json",
    );
    const manifest = JSON.parse(nodeFs.readFileSync(manifestPath, "utf8")) as {
      defaults: {
        minScore: number;
        maxMatches: number;
        shardCount: number;
        startClockMs: number;
      };
      quality: ScenarioSpec[];
    };
    const found = manifest.quality.find((s) => s.name === SCENARIO);
    expect(found, "manifest must contain quality-n4-s101").toBeTruthy();
    spec = found as ScenarioSpec;

    // Genuine outcome: the REAL seed-101 scenario under the REAL registered
    // Convex functions (convex-test), and the REAL invariant suite outcomes.
    factory = nodeFactory();
    // Sequential: the suite and the scenario both patch the logical clock
    // through the shared factory — never interleave them.
    genuine = await executeScenario(spec, factory);
    suite = await runInvariantSuite(factory);
    realPair = genuine.decisions.map((d) => ({
      user1: d.user1,
      user2: d.user2,
    }));

    // The engine matches exactly one pair in this scenario; the shifted pair
    // claims the two UNMATCHED users matched instead — same pair count, same
    // relative order, different users. Sanity-check the preconditions.
    expect(realPair).toHaveLength(1);
    const matchedIds = new Set(realPair.flatMap((p) => [p.user1, p.user2]));
    const unmatched = genuine.userIds.filter((id) => !matchedIds.has(id));
    expect(unmatched).toHaveLength(2);
    shiftedPair = [{ user1: unmatched[0], user2: unmatched[1] }];

    tmpRoot = nodeFs.mkdtempSync(
      nodePath.join(nodeOs.tmpdir(), "replay-falsifier-"),
    );
  }, 240_000);

  afterAll(() => {
    if (tmpRoot) nodeFs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** Build a self-contained hypothetical prior-run directory whose recorded
   * decisions claim `pairs` matched. Everything else mirrors the genuine
   * run so the pair receipt is the only thing under test. */
  function makeFixtureDir(
    name: string,
    pairs: Array<{ user1: string; user2: string }>,
  ): string {
    const repoRoot = process.cwd();
    const dir = nodePath.join(tmpRoot, name);
    nodeFs.mkdirSync(nodePath.join(dir, "decisions"), { recursive: true });

    const fixtureManifest = {
      name: "replay-falsifier-fixture",
      description:
        "Single-scenario manifest for the replay-falsifier tests; mirrors the real manifest's quality-n4-s101.",
      version: 1,
      defaults: {
        minScore: 0.6,
        maxMatches: 50,
        shardCount: 4,
        startClockMs: 1750000000000,
      },
      quality: [spec],
      loadSmoke: [],
      loadFull: [],
    };
    nodeFs.writeFileSync(
      nodePath.join(dir, "fixture-manifest.json"),
      JSON.stringify(fixtureManifest, null, 2),
    );

    const summary = {
      manifest: "fixture-manifest.json",
      manifestHash: sha256File(nodePath.join(dir, "fixture-manifest.json")),
      gitSha: "replay-falsifier-fixture",
      sourceHashes: hashStudySources(repoRoot),
      invariants: suite.outcomes,
      invariantFailures: [],
      notes: [],
      scenarioResults: [
        {
          scenario: spec.name,
          family: "quality",
          seed: spec.seed,
          qualitySummary: genuine.quality,
          // Quality scenarios also carry load records (cycle totals + waiting
          // percentiles) — mirror the real run-summary faithfully.
          loadSummary: genuine.load,
          invariantFailures: 0,
          decisionsFile: "decisions/quality-n4-s101.json",
        },
      ],
      counterexamples: [],
      wallTotalMs: 0,
    };
    nodeFs.writeFileSync(
      nodePath.join(dir, "run-summary.json"),
      JSON.stringify(summary, null, 2),
    );
    nodeFs.writeFileSync(
      nodePath.join(dir, "decisions", "quality-n4-s101.json"),
      JSON.stringify(
        {
          scenario: genuine.scenario,
          seed: genuine.seed,
          decisionCount: pairs.length,
          userIds: genuine.userIds,
          decisions: pairs,
        },
        null,
        2,
      ),
    );
    return dir;
  }

  it("rejects a changed matched subset that preserves pair count and relative order", async () => {
    // Documentation of the historical flaw: the PRE-FIX normalizer mapped
    // both pair sets to the identical compressed signature, so this drift
    // would have passed.
    expect(preFixSignatureReplica(realPair)).toEqual(
      preFixSignatureReplica(shiftedPair),
    );
    // The population-level-index receipt rejects the same drift directly.
    const unit = matchedPairsReceipt({
      committed: shiftedPair,
      committedPlanOrder: genuine.userIds,
      totalOriginal: 1,
      fresh: realPair,
      freshPlanOrder: genuine.userIds,
    });
    expect(unit.agrees).toBe(false);

    // Full replay path: the recorded history claims the unmatched pair
    // matched; the real replay re-runs the real scenario and must fail
    // closed on the pair-structure receipt.
    const dir = makeFixtureDir("drift", shiftedPair);
    const comparison = await replay(dir);
    const scenario = comparison.scenarios.find((s) => s.scenario === SCENARIO);
    expect(scenario).toBeTruthy();
    const pairReceipt = (
      scenario as NonNullable<typeof scenario>
    ).receipts.find((r) => r.receipt === "matched-pair decisions");
    expect(pairReceipt?.agrees).toBe(false);
    expect(pairReceipt?.detail).toContain("drift");
    // The failure is isolated to pair structure: engine objective and
    // exact-reference receipts still agree (same count, different users).
    const others = (scenario as NonNullable<typeof scenario>).receipts.filter(
      (r) => r.receipt !== "matched-pair decisions",
    );
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((r) => r.agrees === true)).toBe(true);
    expect(comparison.receiptFailureCount).toBeGreaterThan(0);
    expect(replayPasses(comparison)).toBe(false);
  }, 240_000);

  it("accepts an honest reproduction through the same replay path", async () => {
    const dir = makeFixtureDir("honest", realPair);
    const comparison = await replay(dir);
    const scenario = comparison.scenarios.find((s) => s.scenario === SCENARIO);
    expect(scenario?.agreesAll).toBe(true);
    const pairReceipt = (
      scenario as NonNullable<typeof scenario>
    ).receipts.find((r) => r.receipt === "matched-pair decisions");
    expect(pairReceipt?.agrees).toBe(true);
    expect(comparison.receiptFailureCount).toBe(0);
    expect(replayPasses(comparison)).toBe(true);
  }, 240_000);
});
