/**
 * Module map builder for the matching study runner.
 *
 * convex-test expects a map of Convex module paths to module namespaces (or
 * thunks resolving them), keyed relative to the repo root with a leading
 * "convex/" prefix — its `findModulesRoot` derives the modules root from a key
 * containing "_generated". The production test suite builds this map with
 * Vite's `import.meta.glob` (test/convex/setup.ts), which is unavailable under
 * plain tsx, so the runner walks the convex/ tree itself.
 *
 * Test files are excluded: they import vitest and export no Convex functions.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CONVEX_ROOT = path.join(REPO_ROOT, "convex");

export const repoRoot = REPO_ROOT;

function walkModuleFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkModuleFiles(full, out);
    } else if (entry.isFile()) {
      // Include hand-written .ts modules and the generated .js entry points
      // (_generated/api.js, _generated/server.js) whose paths anchor
      // convex-test's modules-root detection.
      const isTs =
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".d.ts");
      const isGeneratedJs =
        entry.name.endsWith(".js") && full.includes(`${path.sep}_generated${path.sep}`);
      if (isTs || isGeneratedJs) out.push(full);
    }
  }
  return out;
}

export type ConvexModuleMap = Record<string, () => Promise<unknown>>;

/**
 * Builds a convex-test-compatible module map by walking convex/ and lazily
 * importing every module. Keys are extension-stripped paths prefixed with
 * "convex/" (e.g. "convex/matching/engine"), matching convex-test's
 * prefix-resolution rule.
 */
export function buildModuleMap(): ConvexModuleMap {
  const files = walkModuleFiles(CONVEX_ROOT);
  const map: ConvexModuleMap = {};
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    const key = rel.replace(/\.(ts|js)$/, "");
    map[key] = () => import(file);
  }
  return map;
}
