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
npx tsx experiments/reconnect/run.ts            # everything, exit 0
corepack pnpm exec vitest run \
  --config experiments/reconnect/vitest.config.ts   # 20/20
```

Evidence files: `results/production-handlers.json`,
`results/walk.json`, `results/walk/*.png`, `results/counts.json`,
`results/replay.json`.
