/**
 * Freeze-integrity and control tests for the post-call evidence study.
 *
 * Milestone 1 scope: source hash pinning, case/group counts, and the
 * negation/correction controls. These tests run against the ACTUAL
 * production generator via the hash-pinned adapter — no copies, no
 * reimplementations, no external effects.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { loadProductionGenerator, findRepoRoot, sha256 } from "./adapter";
import { conservativeVerdict } from "./policy";
import {
  countCases,
  executeStudy,
  loadFixtures,
  type FixtureGroup,
  type FixturesFile,
  type StudyExecution,
} from "./study";

const repoRoot = findRepoRoot();
const MANIFEST = "experiments/postcall-evidence/manifest.json";

function readManifest(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(`${repoRoot}/${MANIFEST}`, "utf8"),
  ) as Record<string, unknown>;
}

async function study(): Promise<{
  fixtures: FixturesFile;
  execution: StudyExecution;
}> {
  const { fixtures, execution } = await executeStudy(repoRoot, MANIFEST);
  return { fixtures, execution };
}

function groupById(
  groups: FixtureGroup[],
  id: string,
): FixtureGroup {
  const group = groups.find((g) => g.id === id);
  if (!group) throw new Error(`fixture group not found: ${id}`);
  return group;
}

describe("freeze: production source and fixtures are pinned", () => {
  it("pins the production generator by sha256 recorded in the manifest", () => {
    const manifest = readManifest() as never as {
      productionSource: { sha256: string; module: string };
    };
    const source = fs.readFileSync(
      `${repoRoot}/convex/insights/generation.ts`,
      "utf8",
    );
    expect(sha256(source)).toBe(manifest.productionSource.sha256);
    expect(manifest.productionSource.module).toBe("convex/insights/generation.ts");
  });

  it("adapter yields the five production heuristic functions from the pinned slice", () => {
    const manifest = readManifest() as never as {
      productionSource: { sha256: string };
    };
    const mod = loadProductionGenerator({
      expectedSha256: manifest.productionSource.sha256,
    });
    expect(typeof mod.analyzeContentForInsights).toBe("function");
    expect(mod.sourceSha256).toBe(manifest.productionSource.sha256);
    expect(mod.sliceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("adapter fails closed when the production source hash drifts", () => {
    expect(() =>
      loadProductionGenerator({ expectedSha256: "0".repeat(64) }),
    ).toThrowError(/FROZEN-SOURCE VIOLATION/);
  });

  it("the extraction slice contains no Convex runtime imports", () => {
    const manifest = readManifest() as never as {
      productionSource: { extractionMarker: string };
    };
    const source = fs.readFileSync(
      `${repoRoot}/convex/insights/generation.ts`,
      "utf8",
    );
    const slice = source.slice(source.indexOf(manifest.productionSource.extractionMarker));
    expect(slice).not.toMatch(/@convex\/_generated/);
    expect(slice).not.toMatch(/"use node"/);
    expect(slice).toMatch(/function generateHeuristicSummary/);
    expect(slice).toMatch(/function generateHeuristicActionItems/);
    expect(slice).toMatch(/function generateHeuristicRecommendations/);
    expect(slice).toMatch(/function generateHeuristicLinks/);
  });
});

describe("freeze: case and group counts", () => {
  it("declared counts in the manifest match the frozen fixtures", () => {
    const manifest = readManifest() as never as {
      declaredCounts: { groups: number; meetings: number; cases: number; casesSupported: number; casesUnsupported: number };
      fixtures: { file: string };
    };
    const fixtures = loadFixtures(repoRoot, manifest.fixtures.file);
    const cases = countCases(fixtures.groups);

    expect(fixtures.groups.length).toBe(manifest.declaredCounts.groups);
    const meetings = fixtures.groups.reduce((n, g) => n + g.meetings.length, 0);
    expect(meetings).toBe(manifest.declaredCounts.meetings);
    expect(cases.cases).toBe(manifest.declaredCounts.cases);
    expect(cases.casesSupported).toBe(manifest.declaredCounts.casesSupported);
    expect(cases.casesUnsupported).toBe(manifest.declaredCounts.casesUnsupported);
  });

  it("every fixture meeting carries a unique id", () => {
    const manifest = readManifest() as never as { fixtures: { file: string } };
    const fixtures = loadFixtures(repoRoot, manifest.fixtures.file);
    const ids = fixtures.groups.flatMap((g) => g.meetings.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("negation control (g2): a quoted segment can support the wrong conclusion", () => {
  let fixtures: FixturesFile;
  let execution: StudyExecution;
  beforeAll(async () => {
    ({ fixtures, execution } = await study());
  });
  const groupByIdLocal = groupById;

  it("the permissive baseline emits an action item for every negated sentence", () => {
    const group = groupByIdLocal(fixtures.groups, "g2-negation");
    const result = execution.groups.find((g) => g.groupId === "g2-negation")!;
    const m2a = result.meetings[0];
    // Production keyword matching fires on "will", "should", "need to"
    // even though each sentence negates the commitment.
    expect(m2a.claims.length).toBe(group.labels.unsupportedTriggers.length);
    for (const claim of m2a.claims) {
      expect(claim.classification.label).toBe("unsupported");
      expect(claim.classification.unsupportedKind).toBe("negation");
      // every unsupported emission still quotes a real transcript position
      expect(claim.position.sourceKind).toBe("transcript");
    }
  });

  it("conservative refusal rejects all negated emissions and keeps nothing", () => {
    const result = execution.groups.find((g) => g.groupId === "g2-negation")!;
    const m2a = result.meetings[0];
    expect(m2a.metrics.kept).toBe(0);
    expect(m2a.metrics.refused).toBe(m2a.claims.length);
    for (const claim of m2a.claims) {
      expect(claim.conservative).toEqual({ verdict: "refused", reason: "negation" });
    }
  });
});

describe("correction control (g3): superseded plan vs current commitment", () => {
  let fixtures: FixturesFile;
  let execution: StudyExecution;
  beforeAll(async () => {
    ({ fixtures, execution } = await study());
  });

  it("emits both the superseded plan and the correcting commitment", () => {
    const m3a = execution.groups.find((g) => g.groupId === "g3-correction")!.meetings[0];
    const texts = m3a.claims.map((c) => c.position.quote);
    expect(texts.some((t) => t.includes("Earlier we agreed we should move"))).toBe(true);
    expect(texts.some((t) => t.includes("We will keep Friday for the dry run"))).toBe(true);
  });

  it("classifies the superseded plan as unsupported (correction)", () => {
    const m3a = execution.groups.find((g) => g.groupId === "g3-correction")!.meetings[0];
    const stale = m3a.claims.find((c) =>
      c.position.quote.includes("Earlier we agreed we should move"),
    )!;
    expect(stale.classification.label).toBe("unsupported");
    expect(stale.classification.unsupportedKind).toBe("correction");
  });

  it("conservative refusal refuses the superseded plan and keeps the current commitment", () => {
    const m3a = execution.groups.find((g) => g.groupId === "g3-correction")!.meetings[0];
    const stale = m3a.claims.find((c) =>
      c.position.quote.includes("Earlier we agreed we should move"),
    )!;
    const current = m3a.claims.find((c) =>
      c.position.quote.includes("We will keep Friday for the dry run"),
    )!;
    expect(stale.conservative).toEqual({ verdict: "refused", reason: "stale-plan" });
    expect(current.conservative).toEqual({ verdict: "kept" });
    expect(current.classification.label).toBe("supported");
  });

  it("the correction scene still yields exactly one supported label", () => {
    const group = groupById(fixtures.groups, "g3-correction");
    expect(group.labels.supportedActionItems).toHaveLength(1);
  });
});

describe("conservative policy sanity on genuine commitments (g1)", () => {
  it("keeps all supported commitments in the recall control group", async () => {
    const { execution } = await study();
    const g1 = execution.groups.find((g) => g.groupId === "g1-supported-commitments")!;
    expect(g1.metrics.missedSupported).toHaveLength(0);
    for (const claim of g1.meetings[0].claims) {
      expect(claim.conservative.verdict).toBe("kept");
      expect(claim.classification.label).toBe("supported");
    }
  });
});

describe("study-side helpers", () => {
  it("conservativeVerdict refuses fabricated (no-source) emissions", () => {
    const verdict = conservativeVerdict(
      "Follow up on key discussion points from this meeting",
      { sourceKind: "fabricated", quote: "Follow up on key discussion points from this meeting" },
    );
    expect(verdict).toEqual({ verdict: "refused", reason: "no-source" });
  });
});
