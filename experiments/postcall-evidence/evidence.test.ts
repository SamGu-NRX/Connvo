/**
 * Milestone 2 — permissive vs conservative evidence, provenance integrity,
 * changed-version / stale-recap analysis, and replay determinism.
 *
 * These tests run against the ACTUAL production generator via the
 * hash-pinned adapter. All numbers asserted here were observed from the
 * canonical run on the frozen fixtures and are stable by construction
 * (the study is deterministic; the replay tests enforce that).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadProductionGenerator, findRepoRoot } from "./adapter";
import {
  executeStudy,
  loadFixtures,
  runMeeting,
  type FixtureGroup,
  type StudyExecution,
} from "./study";

const repoRoot = findRepoRoot();
const MANIFEST = "experiments/postcall-evidence/manifest.json";

function readManifest(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(`${repoRoot}/${MANIFEST}`, "utf8"),
  ) as Record<string, unknown>;
}

function groupById(
  groups: FixtureGroup[],
  id: string,
): FixtureGroup {
  const group = groups.find((g) => g.id === id);
  if (!group) throw new Error(`missing fixture group ${id}`);
  return group;
}

async function study(): Promise<StudyExecution> {
  return (await executeStudy(repoRoot, MANIFEST)).execution;
}

// Observed from the canonical run over the frozen fixtures (deterministic).
const EXPECTED_TOTALS = {
  groups: 7,
  meetings: 7,
  cases: 13,
  casesSupported: 7,
  casesUnsupported: 6,
  emittedRaw: 17,
  emittedUnique: 15,
  itemsSupported: 6,
  itemsUnsupported: 9,
  missedSupported: 1,
  conservativeKept: 6,
  conservativeRefused: 9,
};

describe("metrics: permissive vs conservative counts", () => {
  it("totals match the canonical run exactly", async () => {
    const execution = await study();
    const t = execution.totals;
    expect(t.groups).toBe(EXPECTED_TOTALS.groups);
    expect(t.meetings).toBe(EXPECTED_TOTALS.meetings);
    expect(t.cases).toBe(EXPECTED_TOTALS.cases);
    expect(t.casesSupported).toBe(EXPECTED_TOTALS.casesSupported);
    expect(t.casesUnsupported).toBe(EXPECTED_TOTALS.casesUnsupported);
    expect(t.emittedRaw).toBe(EXPECTED_TOTALS.emittedRaw);
    expect(t.emittedUnique).toBe(EXPECTED_TOTALS.emittedUnique);
    expect(t.itemsSupported).toBe(EXPECTED_TOTALS.itemsSupported);
    expect(t.itemsUnsupported).toBe(EXPECTED_TOTALS.itemsUnsupported);
    expect(t.missedSupported).toBe(EXPECTED_TOTALS.missedSupported);
    expect(t.conservativeKept).toBe(EXPECTED_TOTALS.conservativeKept);
    expect(t.conservativeRefused).toBe(EXPECTED_TOTALS.conservativeRefused);
  });

  it("unsupported-by-kind decomposition sums to the unsupported total", async () => {
    const execution = await study();
    const kinds = execution.totals.unsupportedByKind;
    // g2 negation x3, g3 correction x1 + unlabeled x1, g6 fabricated x2
    // (unlabeled-emission), g4 hypothetical x1 + question x1.
    expect(kinds).toEqual({
      negation: 3,
      correction: 1,
      "unlabeled-emission": 3,
      hypothetical: 1,
      question: 1,
    });
    const sum = Object.values(kinds).reduce((a, b) => a + b, 0);
    expect(sum).toBe(EXPECTED_TOTALS.itemsUnsupported);
  });

  it("refusal-reason decomposition sums to the refused total", async () => {
    const execution = await study();
    const reasons = execution.totals.conservativeRefusalReasons;
    // negation: g2 x3 + g3 "not Friday" x1; stale-plan: g3 superseded plan;
    // hypothetical/question: g4; no-source: g6 fabricated fallbacks.
    expect(reasons).toEqual({
      negation: 4,
      "stale-plan": 1,
      hypothetical: 1,
      question: 1,
      "no-source": 2,
    });
    const sum = Object.values(reasons).reduce((a, b) => a + b, 0);
    expect(sum).toBe(EXPECTED_TOTALS.conservativeRefused);
  });

  it("kept + refused equals unique emissions for every meeting", async () => {
    const execution = await study();
    for (const group of execution.groups) {
      for (const meeting of group.meetings) {
        expect(meeting.metrics.kept + meeting.metrics.refused).toBe(
          meeting.metrics.emittedUnique,
        );
      }
    }
  });

  it("the missed supported case is exactly the g6 drafted-timeline commitment", async () => {
    const execution = await study();
    const missed = execution.groups.find((g) => g.groupId === "g6-supported-miss")!
      .metrics.missedSupported;
    expect(missed).toHaveLength(1);
    expect(missed[0].text).toContain("draft the announcement template tonight");
  });
});

describe("provenance: every emission resolves to a real source", () => {
  it("segment-sourced claims cite a quote inside the referenced segment with valid timestamps", async () => {
    const execution = await study();
    const mod = loadProductionGenerator({
      expectedSha256: (readManifest() as never as { productionSource: { sha256: string } })
        .productionSource.sha256,
    });
    const fixtures = loadFixtures(repoRoot, (readManifest() as never as { fixtures: { file: string } }).fixtures.file);

    let checked = 0;
    for (const group of execution.groups) {
      const fixtureGroup = groupById(fixtures.groups, group.groupId);
      for (const meeting of group.meetings) {
        const fixtureMeeting = fixtureGroup.meetings.find(
          (m) => m.id === meeting.meetingId,
        )!;
        void mod;
        for (const claim of meeting.claims) {
          if (claim.position.sourceKind !== "transcript") continue;
          const seg = fixtureMeeting.segments[claim.position.segmentIndex];
          expect(seg, `segment ${claim.position.segmentIndex} exists`).toBeDefined();
          const quote = claim.position.quote.toLowerCase();
          expect(seg.text.toLowerCase()).toContain(quote);
          if (
            claim.position.startMs !== undefined &&
            claim.position.endMs !== undefined
          ) {
            expect(claim.position.startMs).toBeLessThanOrEqual(claim.position.endMs);
            expect(claim.position.startMs).toBeGreaterThanOrEqual(seg.startMs);
            expect(claim.position.endMs).toBeLessThanOrEqual(seg.endMs);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("notes-sourced claims cite a quote inside the notes content they were resolved against", async () => {
    const execution = await study();
    const fixtures = loadFixtures(repoRoot, (readManifest() as never as { fixtures: { file: string } }).fixtures.file);
    let checked = 0;
    for (const group of execution.groups) {
      const fixtureGroup = groupById(fixtures.groups, group.groupId);
      for (const meeting of group.meetings) {
        const fixtureMeeting = fixtureGroup.meetings.find(
          (m) => m.id === meeting.meetingId,
        )!;
        for (const claim of meeting.claims) {
          if (claim.position.sourceKind !== "notes") continue;
          expect(fixtureMeeting.notes).not.toBeNull();
          const content = fixtureMeeting.notes!.content ?? "";
          expect(content.toLowerCase()).toContain(
            claim.position.quote.toLowerCase(),
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("g6 fallback items are fabricated sources refused as no-source", async () => {
    const execution = await study();
    const g6 = execution.groups.find((g) => g.groupId === "g6-supported-miss")!;
    const claims = g6.meetings[0].claims;
    expect(claims.length).toBe(2);
    for (const claim of claims) {
      expect(claim.position.sourceKind).toBe("fabricated");
      expect(claim.classification.label).toBe("unsupported");
      expect(claim.classification.unsupportedKind).toBeUndefined();
      expect(claim.conservative).toEqual({ verdict: "refused", reason: "no-source" });
    }
  });
});

describe("changed-version / stale-recap (g5)", () => {
  it("the current run resolves against notes v2 and records its hash", async () => {
    const execution = await study();
    const m5a = execution.groups.find(
      (g) => g.groupId === "g5-changed-version-stale-recap",
    )!.meetings[0];
    expect(m5a.notesVersion).toBe(2);
    expect(m5a.notesSha256).toBeTruthy();
    for (const claim of m5a.claims) {
      expect(claim.position.sourceKind).toBe("notes");
    }
  });

  it("regenerating from the stale recap version (v1) reproduces the stale items", async () => {
    const manifest = readManifest() as never as {
      productionSource: { sha256: string };
      fixtures: { file: string };
    };
    const fixtures = loadFixtures(repoRoot, manifest.fixtures.file);
    const g5 = groupById(fixtures.groups, "g5-changed-version-stale-recap");
    const meeting = g5.meetings[0];
    expect(meeting.notesHistory).toBeDefined();
    const staleVersion = meeting.notesHistory![0];
    expect(staleVersion.version).toBe(1);

    const staleItems = g5.labels.staleActionItems ?? [];
    const mod = loadProductionGenerator({
      expectedSha256: manifest.productionSource.sha256,
    });
    const regen = await runMeeting(mod, meeting, g5.labels, staleVersion);

    // The stale recap yields exactly the items a version-blind consumer
    // would have committed — identical content, different provenance.
    expect(regen.actionItems).toEqual(staleItems.map((s) => s.text));
    for (const claim of regen.claims) {
      expect(claim.position.sourceKind).toBe("notes");
      // The quote must resolve inside the STALE content, not the current.
      expect((staleVersion.content ?? "").toLowerCase()).toContain(
        claim.position.quote.toLowerCase(),
      );
    }
  });

  it("regenerating from the stale version differs from the current version", async () => {
    const manifest = readManifest() as never as {
      productionSource: { sha256: string };
      fixtures: { file: string };
    };
    const fixtures = loadFixtures(repoRoot, manifest.fixtures.file);
    const g5 = groupById(fixtures.groups, "g5-changed-version-stale-recap");
    const meeting = g5.meetings[0];
    const staleItems = g5.labels.staleActionItems ?? [];
    const mod = loadProductionGenerator({
      expectedSha256: manifest.productionSource.sha256,
    });
    const regenStale = await runMeeting(mod, meeting, g5.labels, meeting.notesHistory![0]);
    const current = await runMeeting(mod, meeting, g5.labels);

    // Regenerating from notes v1 yields the superseded items, not the
    // current ones — this is exactly what a consumer that lost the
    // version field would silently commit.
    expect(regenStale.actionItems).toEqual(staleItems.map((s) => s.text));
    expect(current.actionItems).not.toEqual(regenStale.actionItems);
    expect(regenStale.notesSha256).not.toBe(current.notesSha256);
    expect(regenStale.notesVersion).toBe(1);
    expect(current.notesVersion).toBe(2);
  });

  it("regeneration is deterministic: same inputs give byte-identical claims", async () => {
    const manifest = readManifest() as never as {
      productionSource: { sha256: string };
      fixtures: { file: string };
    };
    const fixtures = loadFixtures(repoRoot, manifest.fixtures.file);
    const g5 = groupById(fixtures.groups, "g5-changed-version-stale-recap");
    const mod = loadProductionGenerator({
      expectedSha256: manifest.productionSource.sha256,
    });
    const a = await runMeeting(mod, g5.meetings[0], g5.labels);
    const b = await runMeeting(mod, g5.meetings[0], g5.labels);
    expect(JSON.stringify(a.claims)).toBe(JSON.stringify(b.claims));
  });
});

describe("replay: regeneration agreement", () => {
  it("two full executions agree on canonical hash and totals", async () => {
    const [a, b] = await Promise.all([study(), study()]);
    expect(a.canonical).toBe(b.canonical);
    expect(JSON.stringify(a.totals)).toBe(JSON.stringify(b.totals));
    expect(JSON.stringify(a.groups)).toBe(JSON.stringify(b.groups));
  });

  it("the CLI replay mode detects agreement and canonical drift", async () => {
    const tsx = (args: string[], allowFailure = false): number => {
      try {
        return execFileSync(
          "corepack",
          ["pnpm", "exec", "tsx", "experiments/postcall-evidence/run.ts", ...args],
          { cwd: repoRoot, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
        ).status ?? 0;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (allowFailure && typeof status === "number") return status;
        throw err;
      }
    };

    // Fresh run, then replay against it: must agree.
    expect(tsx(["--manifest", MANIFEST])).toBe(0);
    const resultsDir = "experiments/postcall-evidence/results";
    expect(tsx(["--replay", resultsDir])).toBe(0);
    const replay = JSON.parse(
      fs.readFileSync(path.join(repoRoot, resultsDir, "replay.json"), "utf8"),
    ) as { agreement: boolean; claimsAgreement: boolean; countsAgreement: boolean };
    expect(replay.agreement).toBe(true);
    expect(replay.claimsAgreement).toBe(true);
    expect(replay.countsAgreement).toBe(true);

    // Drifted canonical in a copy: replay must detect and exit non-zero.
    const driftDir = "experiments/postcall-evidence/results-drift-tmp";
    fs.mkdirSync(path.join(repoRoot, driftDir), { recursive: true });
    const run = JSON.parse(
      fs.readFileSync(path.join(repoRoot, resultsDir, "run.json"), "utf8"),
    ) as Record<string, unknown>;
    run.canonical = `drifted-${String(run.canonical)}`;
    fs.writeFileSync(
      path.join(repoRoot, driftDir, "run.json"),
      JSON.stringify(run, null, 2),
    );
    expect(tsx(["--replay", driftDir], true)).toBe(1);
    fs.rmSync(path.join(repoRoot, driftDir), { recursive: true, force: true });
  });
});
