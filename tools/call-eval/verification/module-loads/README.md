# Convex per-module import-load tables

Evidence snapshots for the local-Convex "module load exceeded 2 s" work, produced by
`../measure-module-loads.mjs`:

- `before.md` / `before.json` — pristine base `df2f6e4` (obv/connvo-local-convex-f1a branchpoint), recorded 2026-10-11.
- `after.md` / `after.json` — after the lazy-import fix (same script, same box, same settings).
- `paired-before.*` / `paired-after.*` — the decisive comparison: pristine convex/ tree from a
  worktree at `c9551d4` and the refactored tree, run back-to-back in one matched load window
  (loadavg 4.66–5.60 on 2 cpus), so box-load drift cannot pollute the delta.

## Method (one line per fact)

Each `convex/` module (`.convexignore` rules applied; `_generated`, tests and `*.d.ts` excluded as
entries) is bundled as a standalone esbuild entry — `platform=node`, `format=esm`, code-splitting on,
tsconfig paths honored, npm deps bundled (the repo `convex.json` carries no
`node.externalDependencies`). A fresh `node` process then times `await import()` of that bundle with
`process.hrtime` around the import only, so the number is parse + top-level evaluation of the whole
closure — the same shape of cost the Convex backend pays when loading a module at push time.
`--runs` fresh processes per module; tables report medians. This script bundles with
`splitting: true`: a dynamic `import()` becomes a separate chunk the entry does NOT evaluate at
load. The Convex 1.28.0 bundler pins `splitting: false` with `format: "esm"`
(node_modules/convex/dist/cjs/cli/lib/components/definition/bundle.js): there a dynamic `import()`
is inlined into the same single file but rewritten to `Promise.resolve().then(() => init())`, so
its top-level initialization is likewise deferred off module load. Both configs move the SDK's
top-level init out of module load — the effect being measured — and differ only in whether the
deferred bytes live in a side chunk or the main file (a parse-only cost on the backend).

## Result (paired same-window run, 2026-10-11)

| module | before median | after median | delta |
|---|---|---|---|
| meetings/webrtc/rooms.ts | 118.02 ms | 16.08 ms | −101.94 ms (−86%) |
| meetings/webrtc/index.ts | 111.63 ms | 20.00 ms | −91.63 ms (−82%) |
| lib/videoProviders.ts | 107.67 ms | 1.83 ms | −105.84 ms (−98%) |
| lib/getstreamServer.ts | 102.32 ms | 1.63 ms | −100.69 ms (−98%) |
| meetings/stream/index.ts | 101.21 ms | 15.06 ms | −86.15 ms (−85%) |
| embeddings/actions.ts | 27.46 ms | 13.01 ms | −14.45 ms (−53%) |
| types/_template.ts (control) | 49.65 ms | 43.57 ms | −6.08 ms |
| types/index.ts (control) | 45.60 ms | 44.36 ms | −1.24 ms |

Sum of medians over all 143 modules: 1502.5 ms → 1152.8 ms (−23.3%). The two import errors are
the documented baseline ones (`auth.config.ts`, `convex.config.ts`), identical in both runs.
Untouched convex-package-floor controls (`types/*`) moved ≤ 6 ms, so the 82–98% collapses on the
treated modules are attributable to the lazy imports, not box load. With the treated modules
deferred, the heaviest import in the tree is now the convex-package floor itself
(`types/index.ts`, ~44 ms).

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
