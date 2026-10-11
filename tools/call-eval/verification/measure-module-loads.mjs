#!/usr/bin/env node
/**
 * Per-module import-load measurement for the convex/ function tree.
 *
 * Why: pushing the schema+function tree to a local Convex backend failed under
 * CPU contention with "module load exceeded 2 s". The backend's cost per module
 * is dominated by parse + top-level evaluation of the module and its full
 * import closure (npm deps included, since convex.json carries no
 * externalDependencies in the repo tree). This script measures exactly that
 * shape of cost, offline, repeatably:
 *
 *   1. Bundle every convex/ module as an entry with esbuild (the same bundler
 *      family the Convex CLI uses): platform=node, format=esm, code-splitting
 *      on, tsconfig paths honored — so each function module's closure is fully
 *      materialized, and a `dynamic import()` of an npm dep lands in its own
 *      chunk that the entry does NOT evaluate at load time.
 *   2. In a FRESH node process per run, time `await import(<entry bundle>)`
 *      with hrtime around the import only (node startup excluded).
 *   3. --runs per module (default 3); report median / min / max.
 *   4. From the esbuild metafile, record closure bytes and the top npm
 *      package contributors per module — what the bundler actually pulls.
 *
 * Entry set mirrors convex/.convexignore: no *.test.* / *.spec.*, no test/,
 * __tests__/, *.md, *.txt, vitest.config.*, .env*; convex/_generated and
 * *.d.ts are excluded as ENTRIES (they still bundle as dependencies).
 *
 * Method caveats (documented so numbers are not over-read):
 *   - Wall-time proxy on whatever box it runs on. Always compare before/after
 *     numbers produced by the SAME script version on the SAME box, run
 *     serially on an otherwise idle machine; record load average.
 *   - Packages that refuse to evaluate under the node platform are reported
 *     as IMPORT_ERROR (observed, not silently dropped).
 *
 * Usage:
 *   node tools/call-eval/verification/measure-module-loads.mjs \
 *        --runs=3 --label=before --out=/tmp/module-loads-before
 * Flags: --runs=N  --label=<name>  --out=<dir>  --filter=<regex>  --keep
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// ------------------------------------------------------------------ CLI
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const RUNS = Math.max(1, parseInt(args.runs ?? "3", 10));
const LABEL = args.label ?? "run";
const FILTER = args.filter ? new RegExp(args.filter) : null;
const KEEP = args.keep === "true";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPT_DIR, "..", "..", ".."); // tools/call-eval/verification -> repo root
const OUT = path.resolve(args.out ?? path.join(REPO, "tools/call-eval/out", `module-loads-${LABEL}`));
const BUNDLES = path.join(OUT, "bundles");

// ------------------------------------------------------------------ esbuild
// Resolve esbuild out of the pnpm store installed here (pnpm 10 blocked its
// postinstall, which is fine: the platform binary ships via @esbuild/*
// optional deps). Fallbacks: the `convex` package, then the root.
const require0 = createRequire(import.meta.url);
function resolveEsbuild() {
  const store = path.join(REPO, "node_modules/.pnpm");
  if (fs.existsSync(store)) {
    const candidates = fs
      .readdirSync(store)
      .filter((d) => /^esbuild@\d/.test(d))
      .sort()
      .reverse();
    for (const d of candidates) {
      const p = path.join(store, d, "node_modules/esbuild");
      if (fs.existsSync(path.join(p, "package.json"))) return require0(p);
    }
  }
  throw new Error("esbuild not resolvable from .pnpm store — is the install complete?");
}
const esbuild = resolveEsbuild();

// ------------------------------------------------------------------ entries
const CONVEX_DIR = path.join(REPO, "convex");
const SKIP_DIR_NAMES = new Set(["_generated", "test", "__tests__", "node_modules"]);

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listEntries(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      out.push(...listEntries(p));
    } else if (e.isFile()) {
      if (!/\.tsx?$/.test(e.name)) continue;
      if (/\.d\.ts$/.test(e.name)) continue;
      if (/\.(test|spec)\.(ts|js|tsx)$/.test(e.name)) continue;
      if (/^vitest\.config\./.test(e.name)) continue;
      out.push(p);
    }
  }
  return out;
}
const entries = listEntries(CONVEX_DIR).sort();
const selected = FILTER ? entries.filter((e) => FILTER.test(e)) : entries;

// ------------------------------------------------------------------ helpers
/**
 * @param {string} p
 * @returns {string}
 */
const packageOf = (p) => {
  // "node_modules/.pnpm/openai@6.x/node_modules/openai/index.mjs" -> "openai"
  const parts = p.split("node_modules/");
  const last = parts[parts.length - 1];
  const m = last.match(/^\.pnpm\/([^/]+)/);
  if (m) return m[1].replace(/(\/node_modules)$/,'');
  return last.split("/").slice(0, last.startsWith("@") ? 2 : 1).join("/");
};

/**
 * @param {number[]} xs
 * @returns {number}
 */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
/**
 * @param {number | null} n
 * @returns {string}
 */
const fmt = (n) => (n == null ? "n/a" : Number(n.toFixed(2)).toString());

// Fresh-process timed import runner.
const runnerPath = path.join(OUT, "timed-import.mjs");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  runnerPath,
  `import { pathToFileURL } from "node:url";
const file = process.argv[2];
const t0 = process.hrtime.bigint();
try {
  await import(pathToFileURL(file).href);
} catch (e) {
  console.error("IMPORT_ERROR: " + ((e && e.message) || String(e)));
  process.exit(3);
}
const t1 = process.hrtime.bigint();
process.stdout.write(JSON.stringify({ ms: Number(t1 - t0) / 1e6 }));
process.exit(0);
`,
);

/**
 * @param {string} bundleFile
 * @returns {number}
 */
function timeImport(bundleFile) {
  const stdout = execFileSync(process.execPath, [runnerPath, bundleFile], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    encoding: "utf8",
  });
  return JSON.parse(stdout).ms;
}

// ------------------------------------------------------------------ run
console.log(`[measure] label=${LABEL} runs=${RUNS} node=${process.version} cpus=${os.cpus().length}`);
console.log(`[measure] loadavg start: ${os.loadavg().map((x) => x.toFixed(2)).join(" ")}`);
console.log(`[measure] ${selected.length} module(s) selected`);

const results = [];
let idx = 0;
for (const entry of selected) {
  idx += 1;
  const rel = path.relative(CONVEX_DIR, entry);
  const outDir = path.join(BUNDLES, rel.replace(/[^a-zA-Z0-9._-]+/g, "__"));
  /** @type {{module: string, label: string, runs: number[], error: string | null, bytes: number | null, closureBytes: number | null, contributors: {pkg: string, bytes: number}[]}} */
  const mod = { module: rel, label: LABEL, runs: [], error: null, bytes: null, closureBytes: null, contributors: [] };

  try {
    const r = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "esm",
      splitting: true,
      outdir: outDir,
      outExtension: { ".js": ".mjs" },
      tsconfig: path.join(REPO, "tsconfig.json"),
      target: "es2022",
      metafile: true,
      sourcemap: false,
      logLevel: "silent",
      absWorkingDir: REPO,
    });

    const entryBase = path.basename(entry).replace(/\.tsx?$/, "");
    const entryBundle = path.join(outDir, `${entryBase}.mjs`);
    if (!fs.existsSync(entryBundle)) throw new Error(`entry bundle missing: ${entryBundle}`);

    const outFiles = Object.entries(r.metafile.outputs);
    mod.bytes = fs.existsSync(entryBundle) ? fs.statSync(entryBundle).size : null;
    mod.closureBytes = outFiles.reduce((s, [, o]) => s + (o.bytes || 0), 0);

    const byPkg = new Map();
    for (const [file, input] of Object.entries(r.metafile.inputs)) {
      if (!file.includes("node_modules")) continue;
      const pkg = packageOf(file);
      byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + (input.bytes || 0));
    }
    mod.contributors = [...byPkg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pkg, bytes]) => ({ pkg, bytes }));

    for (let i = 0; i < RUNS; i++) {
      mod.runs.push(timeImport(entryBundle));
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 6).join(" | ");
    mod.error = `ERROR: ${msg}`;
  }

  results.push(mod);
  const med = mod.runs.length ? median(mod.runs) : null;
  console.log(
    `[measure] ${String(idx).padStart(3)}/${selected.length} ${rel.padEnd(52)} ` +
      (mod.error
        ? `ERROR ${mod.error.slice(0, 90)}`
        : `median ${fmt(med)}ms  runs [${mod.runs.map(fmt).join(", ")}]  closure ${((mod.closureBytes ?? 0) / 1024).toFixed(0)}KiB`),
  );
  if (!KEEP) fs.rmSync(outDir, { recursive: true, force: true });
}

// ------------------------------------------------------------------ report
const loadEnd = os.loadavg();
const summary = {
  label: LABEL,
  recordedAt: new Date().toISOString(),
  node: process.version,
  cpus: os.cpus().length,
  platform: `${os.platform()} ${os.arch()}`,
  loadavgStart: os.loadavg(),
  loadavgEnd: loadEnd,
  runsPerModule: RUNS,
  esbuild: esbuild.version,
  moduleCount: results.length,
  results,
};
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(summary, null, 2));

const ok = results.filter((r) => !r.error && r.runs.length);
const rows = ok
  .map((r) => ({ ...r, med: median(r.runs) }))
  .sort((a, b) => b.med - a.med);
const errs = results.filter((r) => r.error);

const md = [];
md.push(`# Convex per-module import-load times — \`${LABEL}\``);
md.push("");
md.push(`Recorded ${summary.recordedAt} by \`tools/call-eval/verification/measure-module-loads.mjs\` (esbuild ${esbuild.version}).`);
md.push("");
md.push(`- node \`${summary.node}\`, ${summary.cpus} cpus, \`${summary.platform}\``);
md.push(`- loadavg 1m/5m/15m: start \`${summary.loadavgStart.map((x) => x.toFixed(2)).join(" / ")}\`, end \`${summary.loadavgEnd.map((x) => x.toFixed(2)).join(" / ")}\``);
md.push(`- ${summary.runsPerModule} runs per module, fresh node process per run; values below are medians of \`await import()\` of the esbuild bundle (node startup excluded).`);
md.push(`- ${results.length} modules; ${errs.length} with bundle/import errors${errs.length ? ` (see results.json — packages that will not evaluate under the node platform are expected to appear here)` : ""}.`);
md.push(`- Sum of medians over error-free modules: **${(rows.reduce((s, r) => s + r.med, 0) / 1000).toFixed(2)} s** (upper bound on serial whole-tree load).`);
md.push("");
md.push(`| module | median ms | min | max | entry KiB | closure KiB | top npm contributors (KiB) |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const r of rows) {
  const contrib = r.contributors.map((c) => `${c.pkg} ${((c.bytes ?? 0) / 1024).toFixed(0)}`).join(", ") || "—";
  md.push(
    `| ${r.module} | ${fmt(r.med)} | ${fmt(Math.min(...r.runs))} | ${fmt(Math.max(...r.runs))} | ${((r.bytes ?? 0) / 1024).toFixed(0)} | ${((r.closureBytes ?? 0) / 1024).toFixed(0)} | ${contrib} |`,
  );
}
if (errs.length) {
  md.push("");
  md.push("### Modules with bundle/import errors");
  for (const e of errs) md.push(`- \`${e.module}\`: ${e.error}`);
}
md.push("");
md.push(`Slowest 10: ${rows.slice(0, 10).map((r) => `${r.module} ${fmt(r.med)}ms`).join(", ")}`);
fs.writeFileSync(path.join(OUT, "table.md"), md.join("\n"));

console.log(`[measure] wrote ${path.join(OUT, "results.json")} and ${path.join(OUT, "table.md")}`);
console.log(`[measure] loadavg end: ${loadEnd.map((x) => x.toFixed(2)).join(" ")}`);
console.log(`[measure] slowest 10:\n${rows.slice(0, 10).map((r, i) => `  ${i + 1}. ${r.module} median ${fmt(r.med)}ms (${((r.closureBytes ?? 0) / 1024).toFixed(0)} KiB closure)`).join("\n")}`);
