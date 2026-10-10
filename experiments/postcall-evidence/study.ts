/**
 * Core executor for the post-call evidence study.
 *
 * `executeStudy` is the single canonical path used by run mode, replay
 * mode, and the vitest suite, so replay agreement compares like with like.
 *
 * Arms:
 *  - permissive   : the actual production heuristic, unmodified (baseline)
 *  - conservative : study-side refusal pass over permissive output
 *  - model        : NOT RUN — no model parser exists in Connvo; no live
 *                   endpoint is invoked by this study (offline-only)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadProductionGenerator,
  sha256,
  type LoadedProductionModule,
} from "./adapter";
import {
  classifyAgainstLabels,
  conservativeVerdict,
  findMissedSupported,
  normalizeText,
  resolveProvenance,
  type ClaimClassification,
  type ConservativeVerdict,
  type SourcePosition,
} from "./policy";

// ---------------------------------------------------------------------------
// Fixture and manifest shapes
// ---------------------------------------------------------------------------

export interface FixtureSegment {
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  topics: string[];
}

export interface FixtureNotes {
  version: number;
  content: string | null;
}

export interface FixtureMeeting {
  id: string;
  segments: FixtureSegment[];
  notes: FixtureNotes | null;
  notesHistory: Array<{ version: number; content: string }>;
}

export interface FixtureLabels {
  supportedActionItems: Array<{ text: string; kind: string; note?: string }>;
  unsupportedTriggers: Array<{ text: string; kind: string; note?: string }>;
  staleActionItems?: Array<{
    text: string;
    fromNotesVersion: number;
    kind: string;
    note?: string;
  }>;
}

export interface FixtureGroup {
  id: string;
  purpose: string;
  meetings: FixtureMeeting[];
  labels: FixtureLabels;
}

export interface FixturesFile {
  schemaVersion: number;
  frozenAt: string;
  frozenAtBaseCommit: string;
  labelStatus: string;
  groups: FixtureGroup[];
}

export interface StudyManifest {
  name: string;
  createdAt: string;
  branch: string;
  baseBranch: string;
  productionSource: {
    module: string;
    sha256: string;
    extractionMarker: string;
    note: string;
  };
  arms: {
    permissive: { kind: string; description: string };
    conservative: { kind: string; description: string };
    model: {
      kind: string;
      status: "not-run";
      reason: string;
    };
  };
  fixtures: { file: string };
  declaredCounts: {
    groups: number;
    meetings: number;
    cases: number;
    casesSupported: number;
    casesUnsupported: number;
  };
}

export interface StudyCase {
  groupId: string;
  meetingId: string;
  text: string;
  kind: string;
  label: "supported" | "unsupported" | "stale";
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadManifest(repoRoot: string, manifestPath: string): StudyManifest {
  const resolved = path.resolve(repoRoot, manifestPath);
  if (!resolved.includes(path.join(repoRoot, "experiments") + path.sep)) {
    throw new Error(
      `Manifest must live under experiments/ (got ${resolved}); the study is scoped to experiments/postcall-evidence/.`,
    );
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as StudyManifest;
}

export function loadFixtures(repoRoot: string, fixturesRel: string): FixturesFile {
  const resolved = path.resolve(repoRoot, fixturesRel);
  if (!resolved.includes(path.join(repoRoot, "experiments") + path.sep)) {
    throw new Error(
      `Fixtures must live under experiments/ (got ${resolved}); the study is scoped to experiments/postcall-evidence/.`,
    );
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as FixturesFile;
}

/** Count labeled cases: supported + unsupported label entries per group. */
export function countCases(groups: FixtureGroup[]): {
  cases: number;
  casesSupported: number;
  casesUnsupported: number;
} {
  let casesSupported = 0;
  let casesUnsupported = 0;
  for (const group of groups) {
    casesSupported += group.labels.supportedActionItems.length;
    casesUnsupported += group.labels.unsupportedTriggers.length;
  }
  return { cases: casesSupported + casesUnsupported, casesSupported, casesUnsupported };
}

// ---------------------------------------------------------------------------
// Study execution
// ---------------------------------------------------------------------------

export interface StudyClaim {
  text: string;
  rawEmissions: number;
  position: SourcePosition;
  classification: ClaimClassification;
  conservative: ConservativeVerdict;
}

export interface StudyMeetingResult {
  meetingId: string;
  notesVersion: number | null;
  notesSha256: string | null;
  produced: boolean;
  summary: string | null;
  actionItems: string[];
  claims: StudyClaim[];
  metrics: {
    emittedRaw: number;
    emittedUnique: number;
    kept: number;
    refused: number;
    refusalReasons: Record<string, number>;
  };
}

export interface StudyGroupResult {
  groupId: string;
  meetings: StudyMeetingResult[];
  metrics: {
    emittedUnique: number;
    supported: number;
    unsupported: number;
    unsupportedByKind: Record<string, number>;
    missedSupported: Array<{ text: string }>;
  };
}

export interface StudyExecution {
  canonical: string;
  sourceSha256: string;
  sliceSha256: string;
  fixturesSha256: string;
  manifestSha256: string;
  totals: {
    groups: number;
    meetings: number;
    cases: number;
    casesSupported: number;
    casesUnsupported: number;
    emittedRaw: number;
    emittedUnique: number;
    itemsSupported: number;
    itemsUnsupported: number;
    unsupportedByKind: Record<string, number>;
    missedSupported: number;
    conservativeKept: number;
    conservativeRefused: number;
    conservativeRefusalReasons: Record<string, number>;
  };
  groups: StudyGroupResult[];
}

/** Dedupe emissions preserving first-seen order (production can emit the
 * same sentence once per matching keyword). */
export function dedupeEmissions(items: string[]): Array<{ text: string; raw: number }> {
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = normalizeText(item);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const out: Array<{ text: string; raw: number }> = [];
  const consumed = new Map<string, number>();
  for (const item of items) {
    const key = normalizeText(item);
    const already = consumed.get(key) ?? 0;
    if (already === 0) {
      out.push({ text: item, raw: seen.get(key) ?? 1 });
      consumed.set(key, 1);
    } else {
      consumed.set(key, already + 1);
    }
  }
  return out;
}

function bumpCounter(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * Run one meeting through the production generator and the study policy.
 * `notesOverride` supports the changed-version / stale-recap analysis
 * (regenerate against a historical notes version).
 */
export async function runMeeting(
  mod: LoadedProductionModule,
  meeting: FixtureMeeting,
  labels: FixtureLabels,
  notesOverride?: { version: number; content: string | null } | null,
): Promise<StudyMeetingResult> {
  const notes = notesOverride !== undefined ? notesOverride : meeting.notes;
  // Production analyzeContentForInsights is async; the extracted slice
  // preserves that, so the study awaits it like the Convex runtime does.
  const result = await mod.analyzeContentForInsights(
    `study_${meeting.id}`,
    "study_user",
    meeting.segments,
    notes ? { content: notes.content } : null,
  );

  const context = { segments: meeting.segments, notes };
  const emittedRaw = result?.actionItems.length ?? 0;
  const deduped = result ? dedupeEmissions(result.actionItems) : [];

  const claims: StudyClaim[] = deduped.map(({ text, raw }) => {
    const position = resolveProvenance(text, context);
    const classification = classifyAgainstLabels(text, labels);
    return {
      text,
      rawEmissions: raw,
      position,
      classification,
      conservative: conservativeVerdict(text, position),
    };
  });

  const refusalReasons: Record<string, number> = {};
  let kept = 0;
  let refused = 0;
  for (const claim of claims) {
    if (claim.conservative.verdict === "kept") {
      kept += 1;
    } else {
      refused += 1;
      bumpCounter(refusalReasons, claim.conservative.reason);
    }
  }

  return {
    meetingId: meeting.id,
    notesVersion: notes ? notes.version : null,
    notesSha256: notes?.content ? sha256(notes.content) : null,
    produced: result !== null,
    summary: result?.summary ?? null,
    actionItems: result?.actionItems ?? [],
    claims,
    metrics: {
      emittedRaw,
      emittedUnique: claims.length,
      kept,
      refused,
      refusalReasons,
    },
  };
}

function groupMetrics(
  group: FixtureGroup,
  meetings: StudyMeetingResult[],
): StudyGroupResult["metrics"] {
  const emittedUnique: string[] = [];
  for (const meeting of meetings) {
    for (const claim of meeting.claims) {
      emittedUnique.push(claim.text);
    }
  }
  const unsupportedByKind: Record<string, number> = {};
  let supported = 0;
  let unsupported = 0;
  for (const meeting of meetings) {
    for (const claim of meeting.claims) {
      if (claim.classification.label === "supported") {
        supported += 1;
      } else {
        unsupported += 1;
        if (claim.classification.unsupportedKind) {
          bumpCounter(unsupportedByKind, claim.classification.unsupportedKind);
        } else {
          bumpCounter(unsupportedByKind, "unlabeled-emission");
        }
      }
    }
  }
  return {
    emittedUnique: emittedUnique.length,
    supported,
    unsupported,
    unsupportedByKind,
    missedSupported: findMissedSupported(emittedUnique, group.labels),
  };
}

export interface ExecuteOptions {
  /** Skip the manifest hash freeze check (used only by tamper tests). */
  expectedSourceSha256?: string;
}

/**
 * Canonical study execution over the frozen fixtures and the pinned
 * production generator. Throws on any freeze violation.
 */
export async function executeStudy(
  repoRoot: string,
  manifestPath: string,
  options: ExecuteOptions = {},
): Promise<{ manifest: StudyManifest; fixtures: FixturesFile; execution: StudyExecution }> {
  const manifest = loadManifest(repoRoot, manifestPath);
  const fixtures = loadFixtures(repoRoot, manifest.fixtures.file);

  const expectedSha256 = options.expectedSourceSha256 ?? manifest.productionSource.sha256;
  const mod = loadProductionGenerator({ expectedSha256 });

  const groups: StudyGroupResult[] = [];
  for (const group of fixtures.groups) {
    const meetings: StudyMeetingResult[] = [];
    for (const meeting of group.meetings) {
      meetings.push(await runMeeting(mod, meeting, group.labels));
    }
    groups.push({
      groupId: group.id,
      meetings,
      metrics: groupMetrics(group, meetings),
    });
  }

  const cases = countCases(fixtures.groups);
  const totals = {
    groups: fixtures.groups.length,
    meetings: fixtures.groups.reduce((n, g) => n + g.meetings.length, 0),
    cases: cases.cases,
    casesSupported: cases.casesSupported,
    casesUnsupported: cases.casesUnsupported,
    emittedRaw: 0,
    emittedUnique: 0,
    itemsSupported: 0,
    itemsUnsupported: 0,
    unsupportedByKind: {} as Record<string, number>,
    missedSupported: 0,
    conservativeKept: 0,
    conservativeRefused: 0,
    conservativeRefusalReasons: {} as Record<string, number>,
  };
  for (const group of groups) {
    totals.emittedUnique += group.metrics.emittedUnique;
    totals.itemsSupported += group.metrics.supported;
    totals.itemsUnsupported += group.metrics.unsupported;
    totals.missedSupported += group.metrics.missedSupported.length;
    for (const [kind, n] of Object.entries(group.metrics.unsupportedByKind)) {
      totals.unsupportedByKind[kind] = (totals.unsupportedByKind[kind] ?? 0) + n;
    }
    for (const meeting of group.meetings) {
      totals.emittedRaw += meeting.metrics.emittedRaw;
      totals.conservativeKept += meeting.metrics.kept;
      totals.conservativeRefused += meeting.metrics.refused;
      for (const [reason, n] of Object.entries(meeting.metrics.refusalReasons)) {
        totals.conservativeRefusalReasons[reason] =
          (totals.conservativeRefusalReasons[reason] ?? 0) + n;
      }
    }
  }

  const execution: StudyExecution = {
    canonical: "", // filled below
    sourceSha256: mod.sourceSha256,
    sliceSha256: mod.sliceSha256,
    fixturesSha256: "",
    manifestSha256: "",
    totals,
    groups,
  };
  execution.fixturesSha256 = sha256(
    JSON.stringify(fixtures),
  );
  execution.manifestSha256 = sha256(JSON.stringify(manifest));

  // Canonical core: everything replay agreement compares. Volatile fields
  // (timestamps, paths) are excluded on purpose.
  const canonicalCore = {
    sourceSha256: execution.sourceSha256,
    sliceSha256: execution.sliceSha256,
    fixturesSha256: execution.fixturesSha256,
    manifestSha256: execution.manifestSha256,
    totals: execution.totals,
    groups: execution.groups,
  };
  execution.canonical = sha256(JSON.stringify(canonicalCore));

  return { manifest, fixtures, execution };
}
