# Convex per-module import-load tables

Evidence snapshots for the local-Convex "module load exceeded 2 s" work, produced by
`../measure-module-loads.mjs`:

- `before.md` / `before.json` — pristine base `df2f6e4` (obv/connvo-local-convex-f1a branchpoint), recorded 2026-10-11. PRE-FIX script.
- `after.md` / `after.json` — after the lazy-import fix (same script, same box, same settings). PRE-FIX script.
- `paired-before.*` / `paired-after.*` — PRE-FIX paired comparison (pristine convex/ at `c9551d4` vs refactored tree,
  2026-10-11). Superseded by the umbrella re-measurement in the Result section below; kept as recorded history.
  Their loadavg headers are post-run samples from the pre-fix script (start == end).
- The umbrella re-measurement run (2026-10-12) produced no committed files: its raw per-module JSON and
  table output were lost in a platform session wipe before commit. The medians, load traces and environment
  recorded in the Result section below are quoted from the run's extracted record; a gate-strict rerun on a
  quiet box remains open.

## Method (one line per fact)

Each `convex/` module (`.convexignore` rules applied; `_generated`, tests and `*.d.ts` excluded as
entries) is bundled as a standalone esbuild entry — `platform=node`, `format=esm`, single-file output,
tsconfig paths honored, npm deps bundled (the repo `convex.json` carries no
`node.externalDependencies`). A fresh `node` process then times `await import()` of that bundle with
`process.hrtime` around the import only, so the number is parse + top-level evaluation of the whole
closure — the same shape of cost the Convex backend pays when loading a module at push time.
`--runs` fresh processes per module; tables report medians. This script bundles with
`splitting: false` + `format: "esm"`, mirroring the Convex CLI bundler (verified at
`node_modules/convex/dist/cjs/cli/lib/components/definition/bundle.js:195` in both the original
1.28.0 and the umbrella's 1.46.0: `splitting: false`): a dynamic `import()` of an
npm dep keeps its bytes in the single output file — they PARSE at module load — while its
top-level initialization is deferred to the first call that awaits it
(`Promise.resolve().then(() => init())`). Entry `bytes`/`closureBytes` therefore include the
deferred bytes; only their initialization is excluded from the timed import.

## Result (corrected-proxy re-measurement, 2026-10-12) — PROXY

**The numbers below are corrected-proxy evidence (fixed script, `splitting: false`), not facts
about the backend — a real deployment push must still confirm them.**

Tree under test: umbrella `obv/connvo-local-convex-f1`, measured at `8adfa23`; `convex/` is
byte-identical at the current head `f3e53a7` (verified: `git diff 8adfa23 f3e53a7 -- convex/`
is empty). Before side: the same checkout with `convex/` swapped to the pristine base `df2f6e4`
(`05ea49f^1`); after side: the umbrella tree as checked out. Both runs back-to-back
(01:51:27–01:52:58Z), same script (esbuild 0.27.0), node v20.20.2, 3 runs/module. The raw
per-module JSON/table files for this pair were lost in a platform session wipe before commit;
the medians and load traces below are quoted from the run's extracted record.

Load context (2-CPU shared box; launch gated on 1-minute loadavg below 3 by our own reading —
passed at 2.74; co-tenant probes were running): before-run start `2.74 / 5.07 / 4.81`, end
`3.06 / 4.97 / 4.78`; after-run start `3.06 / 4.80 / 4.73`, end `3.69 / 4.73 / 4.71` — the
after sweep started marginally above the below-3 threshold (3.06) and the window got busier
mid-run, so deltas are read against the untouched controls (control drift +6.91 / +40.41 /
+21.96 ms). Two gate-strict rerun attempts on the rebuilt tree were discarded when co-tenant
bursts (1-minute loadavg 7.06 and 4.40) violated the start gate; a rerun on a quiet box remains
open.

| module | before `df2f6e4` | after umbrella | delta |
|---|---|---|---|
| lib/getstreamServer.ts (treated) | 79.41 ms | 55.70 ms | −23.71 ms |
| meetings/webrtc/rooms.ts (treated) | 75.30 ms | 64.44 ms | −10.86 ms |
| meetings/webrtc/index.ts (treated) | 69.83 ms | 66.00 ms | −3.83 ms |
| meetings/stream/index.ts (treated) | 66.83 ms | 60.34 ms | −6.49 ms |
| lib/videoProviders.ts (treated) | 56.53 ms | 60.77 ms | +4.24 ms |
| embeddings/actions.ts (treated) | 16.09 ms | 15.88 ms | −0.21 ms |
| types/_template.ts (control) | 25.70 ms | 32.61 ms | +6.91 ms |
| types/index.ts (control) | 25.47 ms | 65.88 ms | +40.41 ms (one of three runs hit 79.62 ms) |
| types/validators/index.ts (control) | 24.55 ms | 46.51 ms | +21.96 ms |

**Finding — the corrected proxy shows NO measurable module-load benefit from the lazy imports.**
Treated bundles are the same size before and after (getstreamServer 2833 KiB, videoProviders
2839 KiB, stream/index 2947→2948 KiB, webrtc/rooms 2980→2981 KiB, webrtc/index 2992 KiB): under
`splitting: false` the SDK bytes inline into the single-file bundle and parse at module load
whether or not initialization is deferred. Treated medians moved within the band the untouched
controls drifted; the sum of medians over error-free modules went 1.03 s → 1.10 s (+7%, same
direction as the controls). The two import errors are the documented baseline ones
(`auth.config.ts`, `convex.config.ts`), identical on both sides. What actually removes
module-load bytes is resolving the SDKs from node_modules (`node.externalDependencies` /
externalPackages — sub-thread (c)'s fix, already on this umbrella) or otherwise shrinking what
the bundler inlines; a real deployment push remains the confirming test.

## Historical: pre-fix paired run (2026-10-11) — superseded proxy

The paired tables below (and the committed `paired-before.*` / `paired-after.*` files) were
produced by the pre-fix script, whose esbuild `splitting: true` accounting put deferred-import
bytes in side chunks the timed entry never parsed — they measured initialization deferral
without the parse cost the real single-bundle bundler (`splitting: false`) retains. Kept as
recorded history, not as a claim about the backend.

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

Sum of medians over all 143 modules: 1502.5 ms → 1152.8 ms. The two import errors are the
documented baseline ones (`auth.config.ts`, `convex.config.ts`), identical in both runs.

## Known proxy limitations (script fixed after operator review; tables below predate the fix)

- The pre-fix script bundled with `splitting: true`, so a dynamic import()'s bytes landed in a
  side chunk the timed entry never parsed: the `bytes` column under-reported what the Convex
  backend (splitting:false) would load, and the timed medians excluded deferred-chunk parse cost.
- The pre-fix script sampled `loadavgStart` after the run, so committed tables show start == end
  and cannot show load drift during measurement. The fixed script samples loadavg before any
  heavy work.
- All committed table files (before/after/paired-before/paired-after) were produced by the
  pre-fix script and remain as recorded history. The corrected-proxy re-measurement (Result
  section above) found no measurable lazy-import benefit under `splitting: false`; a
  gate-strict rerun on a quiet box and a real deployment push remain open.

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
