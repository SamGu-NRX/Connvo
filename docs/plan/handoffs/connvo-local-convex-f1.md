# Handoff — connvo-local-convex-f1 (local Convex backend on a contended 2-core sandbox)

Task: make Connvo's backend run as a local Convex deployment inside a 2-core sandbox with test identities, and prove an authenticated two-user browser session (S0 Convex half, decisions D1–D3 of `docs/plan/CALL-PLAN.md` @ `ddc94d4`). Draft PR #35 → alpha. Branch base: `df2f6e4` (harness tip incl. its handoff commit).

## Done

- Draft PR #35 open (base `alpha`, head `obv/connvo-local-convex-f1`). CI does not run on alpha PRs — all verification is recorded here and in the PR body's Baseline section.
- Alpha baseline (`ddc94d4`, in PR body): `pnpm install` 57.97s; `pnpm type-check` 42.58s exit 2 (32 pre-existing errors, none in tools/call-eval); `pnpm test:run` 240/240 green + 1 known pre-existing unhandled rejection (convex-test) causing exit 1.
- Recon dossier (7 sections, quotes at `ddc94d4`/`f06669f`/`437f558`): the three flagged `tools/call-eval/scripts/local-backend.mjs` defects (missing `devEval/seed` + allowlist exclusion; `convex.json` modified before its backup exists; `convex env set` without local-deployment verification) are **already fixed** at harness head `f06669f`: seed lives in env-gated `convex/devEval/seed.ts`, `assertLocalDeployment` (anonymous prefix + local port) precedes `env set`, backup written before `convex.json` changes with `out/` created first. Clean-checkout verification tests are queued (sub-thread c).
- Sub-thread (a) merged here from `obv/connvo-local-convex-f1a` (head `bcee3af`; milestones `2bda9dc`, `c9551d4`, `bcee3af`): measurement script `tools/call-eval/verification/measure-module-loads.mjs` + before/after/paired tables (md+json); lazy imports — Stream Video (`convex/lib/getstreamServer.ts` `loadStreamCtor` + async client memo) and OpenAI (`convex/embeddings/actions.ts` `loadOpenAIClient`), 9 call sites awaited in already-async contexts, no API change.
  - Paired same-window medians (before→after): `meetings/webrtc/rooms.ts` 118.02→16.08 ms; `meetings/webrtc/index.ts` 111.63→20.00; `lib/videoProviders.ts` 107.67→1.83; `lib/getstreamServer.ts` 102.32→1.63; `meetings/stream/index.ts` 101.21→15.06; `embeddings/actions.ts` 27.46→13.01; Σ medians over 143 modules 1502.5→1152.8 ms (−23.3%).
  - (a)'s verification at `bcee3af`: `pnpm type-check` 45 pre-existing errors, zero new; `pnpm test:run` 268/269 with the known pre-existing unhandled rejection (transcripts ingestion) plus one load-sensitive performanceValidation micro-benchmark (0.115 vs 0.1 ms budget) that passes 14/14 in isolation.
  - Mechanism note: Convex 1.28.0 bundles with esbuild `splitting:false`, so deferred SDK bytes still parse at module load; the ~100 ms/module top-level init moves off module load. If push failures persist under contention, next lever is `convex.json` externalization via `node.externalPackages`. Correction (f1c review fixes): the harness originally set `node.externalDependencies`, which the 1.28.0 CLI does not read, so externalization was ineffective until the key was fixed on `obv/connvo-local-convex-f1c`.
- Contention witness (pre-fix tree): sub-thread (a) observed a flag-on root probe return HTTP 500 after 918 s — the failure mode this task attacks.

## Not done / next

1. **Live-push confirmation (the join).** Re-run the harness local-backend push (`pnpm call-eval:backend`) on this merged tree and record exact timings/exit codes — does `module load exceeded 2 s` / 408 / 500 still reproduce? Planned: sub-thread (c) captures this witness during its seed e2e.
2. **Sub-thread (c)** — clean-checkout verification tests for the three guards (allowlist accepts `devEval/seed`; backup exists before first `convex.json` modification incl. absent `out/`; refusal of non-local deployment before `env set`), fix whatever verification shows broken, and confirm the seed produces the proof shape (users A, B, O + meeting + participants).
3. **Sub-thread (b)** — staged push / harness function tree (schema + auth, users, meetings, webrtc, notes first, then the rest) if the single push still fails under contention; typecheck disabled during push; nothing else running.
4. **Sub-thread (d)** — two-user browser proof: A and B sign in via the env-gated test JWT provider (`CONNVO_LOCAL_TEST_JWKS`, issuer `connvo-local-test.invalid`; `/api/test-auth/token` behind `NEXT_PUBLIC_CONNVO_TEST_AUTH=1`; `useTestAuth ?as=A|B|C|O`) and read the seeded meeting; outsider O refused with a named error. Implement H-14 (`CALL-PLAN.md` line 83: participant guard + pass bar; data-testid convention per `tools/call-eval/CONTRACT.md`) for harness use.
5. **Integration** — merge f1a/f1b/f1c/f1d here, run type-check + tests, then prove done: one command brings up the backend on a 2-core budget within recorded time, seeds, and passes the browser proof; update the PR body (Proof + Handoff) at the pushed SHA.

## State at this commit

- Merged `f1a @ bcee3af` as a partial checkpoint per operator push-now directive; the merge result itself is not yet re-verified (verification continues in sub-threads; the bar is type-check zero-new-errors + tests no-new-failures vs the recorded baselines).
- Staged-push/harness-tree script: not started (waits on the live-push witness).
- PR body copy is maintained in this file and copied into PR #35 at review, per the established Connvo handoff pattern.

## Environment notes

- Default 2-CPU sandbox only (repo-sandbox request cancelled by operator). Heavy steps serialized with recorded timings; long steps under tmux. pnpm 10.34.5 at `/home/user/work/connvo-setup/tools/npm-global` (export bin per call; sandbox resets lose globals and Convex state).
- Token rules (operator decision 586): `GITHUB_TOKEN` is the fleet push credential — git fetch/push to SamGu-NRX repos only; no API/scope probes; never print, store, or embed the value (credential helper or GIT_ASKPASS reading the env var only); on push failure record the exact git error here and report blocked; no workarounds.
- Commits: author Sam Gu <127461594+SamGu-NRX@users.noreply.github.com>; every message ends with `Co-authored-by: obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>`.
