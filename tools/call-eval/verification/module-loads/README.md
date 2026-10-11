# Convex per-module import-load tables

Evidence snapshots for the local-Convex "module load exceeded 2 s" work, produced by
`../measure-module-loads.mjs`:

- `before.md` / `before.json` — pristine base `df2f6e4` (obv/connvo-local-convex-f1a branchpoint), recorded 2026-10-11.
- `after.md` / `after.json` — after the lazy-import fix (same script, same box, same settings).

## Method (one line per fact)

Each `convex/` module (`.convexignore` rules applied; `_generated`, tests and `*.d.ts` excluded as
entries) is bundled as a standalone esbuild entry — `platform=node`, `format=esm`, code-splitting on,
tsconfig paths honored, npm deps bundled (the repo `convex.json` carries no
`node.externalDependencies`). A fresh `node` process then times `await import()` of that bundle with
`process.hrtime` around the import only, so the number is parse + top-level evaluation of the whole
closure — the same shape of cost the Convex backend pays when loading a module at push time.
`--runs` fresh processes per module; tables report medians. Single-entry esbuild builds inline
static imports into the entry and give a dynamic `import()` its own chunk that is NOT evaluated at
entry load — which is exactly the before/after semantics being measured.

## Caveats

- Wall-time proxy on a shared 2-CPU sandbox: before/after must come from the same script version on
  the same box, run serially; loadavg is recorded in each table header and raw runs are in the JSON.
- Two modules deliberately fail to evaluate in a bare node process and are listed as errors rather
  than silently dropped: `auth.config.ts` (throws without `WORKOS_CLIENT_ID` at import time) and
  `convex.config.ts` (component definitions only work inside the Convex runtime). Both load fine on
  a real deployment.
- Validator-heavy modules (`types/*`) cannot benefit from lazy imports: Convex validators run at
  function-definition time. Their cost is the floor, not a fix target.

## Re-run

```bash
node tools/call-eval/verification/measure-module-loads.mjs --runs=3 --label=after \
  --out=/tmp/module-loads-after
```
