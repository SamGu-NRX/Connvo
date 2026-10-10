/**
 * Production-source adapter for the post-call evidence study.
 *
 * The study must exercise the ACTUAL production recap generator
 * (`convex/insights/generation.ts`) without modifying it. The heuristic
 * functions there are module-private and the module imports Convex
 * internals that cannot load outside a Convex runtime, so this adapter:
 *
 *   1. reads the production source and pins it by sha256 (freeze check),
 *   2. slices the pure-heuristic region (from `analyzeContentForInsights`
 *      to end of file — no Convex imports live in that region),
 *   3. transpiles the slice with the repo's TypeScript compiler,
 *   4. evaluates it in a function sandbox and returns the real functions.
 *
 * Any edit to the production generator changes the hash and fails closed:
 * the study refuses to run against drifted source until the manifest is
 * consciously re-pinned. This adapter never writes to production files.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as ts from "typescript";

export const PRODUCTION_MODULE_REL = "convex/insights/generation.ts";
export const EXTRACTION_MARKER = "async function analyzeContentForInsights";

export const EXPECTED_EXPORTS = [
  "analyzeContentForInsights",
  "generateHeuristicSummary",
  "generateHeuristicActionItems",
  "generateHeuristicRecommendations",
  "generateHeuristicLinks",
] as const;

export type HeuristicActionItem = string;
export type InsightResult = {
  summary: string;
  actionItems: HeuristicActionItem[];
  recommendations: Array<{ type: string; content: string; confidence: number }>;
  links: Array<{ type: string; url: string; title: string }>;
};

/** Minimal structural shapes mirroring convex/types/entities — inputs only. */
export interface StudySegment {
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  topics: string[];
}
export interface StudyNotes {
  version: number;
  content: string | null;
}

export interface LoadedProductionModule {
  sourcePath: string;
  sourceSha256: string;
  sliceSha256: string;
  analyzeContentForInsights: (
    meetingId: string,
    userId: string,
    segments: StudySegment[],
    notes: { content: string | null } | null,
  ) => InsightResult | null;
}

/**
 * Locate the repo root by probing for the pinned production module.
 * Deliberately independent of `__dirname`/`import.meta` so the study
 * behaves identically under tsx and vitest, from any module format.
 * Throws when the production module is not reachable from the cwd.
 */
export function findRepoRoot(): string {
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "..", "..")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, PRODUCTION_MODULE_REL))) {
      return candidate;
    }
  }
  throw new Error(
    `Cannot locate ${PRODUCTION_MODULE_REL} from cwd ${cwd}. ` +
      `Run the study from the repository root.`,
  );
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Load and evaluate the production heuristic functions.
 * Throws (fail-closed) when the source hash does not match `expectedSha256`,
 * or when the extraction slice does not yield the expected function exports.
 */
export function loadProductionGenerator(options: {
  expectedSha256: string;
  repoRoot?: string;
}): LoadedProductionModule {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const sourcePath = path.join(repoRoot, PRODUCTION_MODULE_REL);
  const source = fs.readFileSync(sourcePath, "utf8");
  const sourceSha256 = sha256(source);

  if (sourceSha256 !== options.expectedSha256) {
    throw new Error(
      `FROZEN-SOURCE VIOLATION: ${PRODUCTION_MODULE_REL} sha256 ` +
        `${sourceSha256} does not match the pinned manifest hash ` +
        `${options.expectedSha256}. The study is fail-closed against ` +
        `generator drift; re-pin manifest.productionSource.sha256 only ` +
        `after consciously reviewing the changed generator.`,
    );
  }

  const markerIndex = source.indexOf(EXTRACTION_MARKER);
  if (markerIndex < 0) {
    throw new Error(
      `Extraction marker not found in production source: ${EXTRACTION_MARKER}`,
    );
  }
  const slice = source.slice(markerIndex);
  const sliceSha256 = sha256(slice);

  // Erase type annotations; the slice references no runtime imports.
  const js = ts.transpileModule(slice, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2018,
      module: ts.ModuleKind.None,
      isolateModules: false,
    },
    reportDiagnostics: true,
  });
  const diagnostics = (js.diagnostics ?? []).map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  );
  if (diagnostics.length > 0) {
    throw new Error(
      `Production slice failed to transpile: ${diagnostics.join("; ")}`,
    );
  }

  const factory = new Function(
    `"use strict";\n${js.outputText}\nreturn { ${EXPECTED_EXPORTS.join(
      ", ",
    )} };`,
  ) as () => Record<string, unknown>;

  const mod = factory();
  for (const name of EXPECTED_EXPORTS) {
    if (typeof mod[name] !== "function") {
      throw new Error(
        `Production slice did not yield expected function export: ${name}`,
      );
    }
  }

  return {
    sourcePath,
    sourceSha256,
    sliceSha256,
    analyzeContentForInsights:
      mod.analyzeContentForInsights as LoadedProductionModule["analyzeContentForInsights"],
  };
}
