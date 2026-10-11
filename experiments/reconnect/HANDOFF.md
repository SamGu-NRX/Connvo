# Handoff — reconnect study (hooks + real handlers)

Follow-up round on draft PR #18. Everything below was added AFTER commit
`d388be8` (the original fake-transport study) in the isolated worktree
`/home/user/work/Connvo-reconnect` (branch
`obv/products-l2-reconnect-study-20261010`). Production code untouched.

## What's new in this round

1. **PRODUCTION-OBSERVED duplicate-delivery receipts.**
   `experiments/reconnect/production-handlers.ts` invokes the REAL
   registered handlers — `notes.applyNoteOperation`,
   `meetings/lifecycle.startMeeting` / `endMeeting`, and the GetStream
   `dispatchWebhook` — through `convex-test` against the production
   schema, with `withIdentity` auth and no fake transport. Results in
   `results/production-handlers.json`, pinned by
   `production-handlers.test.ts` (6 tests). Headline:

   - exact re-send of a note op → **409 CONFLICT** (version guard),
     applied once;
   - version-aware re-send → **accepted, applied twice** (no idempotency
     key on this path);
   - start/end duplicates → **rejected** by state guards;
   - webhook redelivery → **deduped** by `withIdempotency` (keys 0→1→1,
     result replayed).

2. **Evidence tiers made explicit.** REPORT.md now separates
   SIMULATED-TRANSPORT findings (fake transport, worst-case bound) from
   PRODUCTION-OBSERVED receipts. Finding 5 (lifecycle duplicates) is
   corrected: real handlers reject duplicates. Finding 1 is refined: the
   production failure mode for a blind re-send is a spurious 409 plus a
   stale saved-cache value, not a silent duplicate; duplication needs a
   version refetch.

3. **Entry point.** `npx tsx experiments/reconnect/run.ts` runs all three
   sections (handlers / vitest / walk) and exits 0; `--section=` for one.
   Final full run: 20/20 tests, 8-step walk, zero harness warnings,
   exit 0 in ~10s.

4. **Walk accessibility.** `prototype/walk.mjs` is now keyboard-only
   (focus + Enter/Type; no mouse coordinates) and launches with
   `reducedMotion: "reduce"`. `walk.json` records
   `interaction: {keyboardOnly, reducedMotion}`; zero console errors.

## Integration round (third pass, same branch)

The two production-handler evidence layers were unified after landing in
parallel commits (`4b91cfb` + `3310dea`, reconciled in `80cfb54`):

- **Two complementary [production-handler] suites, one receipt.**
  `scenarios/productionHandlers.test.ts` (9 vitest scenarios, per-scenario
  receipts under `results/vitest/production-*.json`) covers
  batchApplyNoteOperations, the offline queue/sync/retry flow, lifecycle
  create, and the hook-shaped-args validator rejection;
  `production-handlers.ts` (6 observations pinned by
  `production-handlers.test.ts`) covers the direct apply/lifecycle
  verdicts plus the GetStream `dispatchWebhook` redelivery. Merged into
  `results/productionHandlers.json`; the two suites AGREE on every
  overlapping verdict.
- **Idempotency conclusion corrected.** `withIdempotency` IS used on one
  path — the GetStream webhook (`dispatchWebhook`), which dedupes
  redelivery (keys 0→1→1, first result replayed). It is the notes/offline
  and lifecycle mutations that never invoke it. The mechanism exists and
  works; it is just unwired where duplicates corrupt notes.
- **run.ts owns aggregation + replay.** The merged entry point runs the
  three sections, aggregates EVERY manifest scenario (29, each tagged
  `[simulated-transport]` or `[production-handler]`) into
  `results/counts.json`, writes the combined production receipt, and with
  `--replay` diffs against `results/counts.prev.json` into
  `results/replay.json`. Section routing accepts both `--section=vitest`
  and `--section vitest`.
- **Walk is keyboard-only in the strong sense.** The prototype exposes
  letter shortcuts (c=cut, a=arm ack loss, r=restore, s=start, e=end;
  handler ignores keys typed inside the editor), always-visible focus
  outlines (`:focus-visible` + `:focus` CSS), and a rendered legend row
  (`kbd-legend`). The walk verifies Tab order (btn-cut → btn-arm-ackloss →
  btn-restore → editor), activates restore via Shift+Tab+Enter, uses
  focus+Enter once, types only via keyboard.type, and records per-step
  state snapshots (`results/walk/NN-*.json`) next to the PNGs.
  `walk.json` now records `interaction: {keyboardOnly, reducedMotion,
  mouseUsed: false, letterShortcuts, mechanisms}`. 9 steps, zero console
  errors, identical state evolution across runs.
- **Scheduled side effects are stubbed, honestly.** startMeeting/endMeeting
  schedule three internal actions (GetStream room creation, transcription
  init, post-processing) whose real modules call EXTERNAL services and
  fire on zero-delay timers during teardown (flaky unhandled errors). The
  vitest production suite registers experiment-owned no-op stubs for those
  three SCHEDULED functions only; every handler under observation stays
  fully real.
- **build.sh is layout-robust.** It picks the first esbuild JS wrapper
  (`node_modules/esbuild/bin/esbuild` or the .pnpm path) and refuses to run
  the platform ELF shim that `.bin/esbuild` may symlink to.

Current totals: 4 vitest suites, 29 tests, all passing; replay AGREES;
run.ts full run exits 0.

## Known limitations / gotchas

- `convex-test` needs the modules map (see `production-handlers.ts`):
  a `"convex/_generated/api"` anchor plus every module reachable via
  `ctx.runMutation` / `ctx.scheduler` — we register the real modules.
  Missing entries are harmless stderr noise, but we now register the full
  transitive chain so the run is warning-free.
- Nested scheduled functions executed during the receipts can hit
  convex-test's nested-identity limitation (issue #50) — none of the
  pinned receipts depends on nested-auth propagation.
- The worktree's `node_modules` is a symlink to the main checkout's;
  recreate it after any worktree rebuild
  (`ln -sfn /home/user/work/Connvo/node_modules node_modules`).
- The prototype bundle (`prototype/dist/`) is gitignored; rebuild via
  `run.ts --section=walk` or `build.sh`.

## Verify (from the worktree)

```bash
corepack pnpm exec tsx experiments/reconnect/run.ts --replay  # everything, exit 0
corepack pnpm exec vitest run \
  --config experiments/reconnect/vitest.config.ts   # 29/29 (4 suites)
```

Evidence files: `results/production-handlers.json`,
`results/walk.json`, `results/walk/*.png`, `results/counts.json`,
`results/replay.json`.
