# Handoff — Connvo S1 loss-proof in-call notes, r2 (`obv/connvo-notes-ledger-r2`)

*(r2 checkpoint at this doc's commit; branch base recorded below. Supersedes the branch of PR #31 `obv/connvo-notes-ledger-f1` — that branch is read-only and must never be pushed to or modified.)*

## What this branch is

The replacement integration branch for the S1 "loss-proof in-call notes" milestone. It starts at PR #31's newest head and carries alpha. The superseding draft PR targets `alpha`.

## Base SHAs (recorded 2026-10-12 UTC)

| What | SHA |
|---|---|
| PR #31 head used (branch point of r2) | `1c9bcebad82de0bbfdef50a5fd5bc7c29fd0739e` |
| alpha tip at merge time | `c10a84e78b7ad361ddc0e32421c7109fb8bb2a83` |
| alpha gate commit (verified contained) | `32c7c7f` — ancestor of alpha tip: yes |
| f1 head ancestry gates | `1c9bceb` is the f1 head; `57b95ce` and `4bd4261` are ancestors (both yes) |
| Old M4 checkpoint `7293ceb` | ancestor of the f1 head: yes — carried into r2 |

### Alpha merge record

`git merge --no-ff origin/alpha` on r2 at `1c9bceb` returned **"Already up to date"**: the f1 head `1c9bceb` is itself a merge commit of alpha tip `c10a84e` (parents `3d3cf1e` + `c10a84e`), so alpha's tip was already contained and git created no merge commit. **Conflicted paths: none.** The scoped conflict rules (notes-branch side for `src/hooks/notes/**`, `src/components/meeting-notes/**`, `convex/notes/**`, `test/in-call/**`, `test/notes/**`, `src/proxy.ts`; alpha side for everything else) were not needed on this pass but remain the rule for any future alpha re-merge.

## Environment (shared Obvious sandbox, 2 workers' load visible)

- `nproc` = 2; `free -h` = 7.8 GiB total, ~1.3 GiB available at probe time
- node v20.20.2; pnpm 9.15.9 (corepack present; no install needed)
- Sandbox incident: the shared sandbox session reset mid-task (between install and type-check), wiping the first clone, first install, and a first type-check attempt. Recovery: re-clone (3 s), re-verify head (unchanged `1c9bceb`), re-push, re-run. Lesson re-confirmed from the f1 handoff: push checkpoints before long verification steps.

## Baseline (on r2 at `1c9bceb`, each under `flock /home/user/work/heavy.lock`)

| Command | Log | Exit | Duration | Result |
|---|---|---|---|---|
| `pnpm install --frozen-lockfile` | `/home/user/work/baseline/install.log` | 0 | 73 s (first pass 156 s, wiped by sandbox reset) | 1106 packages, no lock drift; no fallback to plain install needed |
| `pnpm type-check` | `/home/user/work/baseline/type-check.log` | 2 | 41 s | **32 errors** — exactly the documented baseline; none in notes paths (`src/hooks/notes/**`, `src/components/meeting-notes/**`, `convex/notes/**`, `src/proxy.ts`) |
| `pnpm test:run` | `/home/user/work/baseline/test-run.log` | 1 | 53 s | **333 passed / 3 failed (336)**; 25/26 files passed |
| `NOTES_PROPERTY_RUNS=25 pnpm exec vitest run test/in-call` (diagnostic, not part of the bar) | `/home/user/work/baseline/in-call-override.log` | 0 | 20 s | **36/36 passed** — proves the three failures below are timeouts, not logic regressions |

### Failure list (3)

All three in `test/in-call/property/notesLedger.property.test.ts`, each `Error: Test timed out in 5000ms.`:

1. `notes ledger property — P1 single client > random edits × faults → exact server convergence, ≤2 identical sends` (5008 ms)
2. `notes ledger property — P2 two clients > interleaved edits × faults → exact convergence + discipline` (5001 ms)
3. `notes ledger property — mounted seam (real hook) > 200 mounted runs → same invariants through React` (5006 ms)

Root cause (observed, not speculated): the `in-call` vitest project sets no `testTimeout`, so it gets vitest's 5 s default, while the property suite defaults to `NUM_RUNS = 10_000` (mounted 200) at hardcoded seed `20261011`. Any full `pnpm test:run` therefore times these out regardless of machine. The M5 milestone owns the 10,000-case run and must pair it with an explicit timeout/runs override; until then the honest baseline is "3 timeout failures at default runs; 36/36 green at the M4-documented `NOTES_PROPERTY_RUNS=25` override."

Known pre-existing (recorded by f1, unchanged): `pnpm lint` is not runnable in this repo state (`next lint` misparsed by the installed Next CLI); type-check + suites remain the enforced gates. Type-check error count on r2: 32 (holds).

## Milestone plan (r2 numbering; each milestone = passing commit + push after attribution/scope checks)

- **M2 — server duplicate-batch fix:** fix the server-side duplicate-batch behavior so a retried batch cannot double-apply; prove with a targeted test on the ledger path.
- **M3 — ledger/hook rebuild + proxy revert:** rebuild the ledger/hook join and revert the `src/proxy.ts` dev-route exclusion so the demo route no longer needs middleware carve-outs.
- **M4 — mounted fault matrix + named #24 regressions:** run the mounted fault matrix (offline, drop-ack, slow-network, conflict, remount) and add named regressions from PR #24 (commit `b9b4c5a2`, evidence only — never merge/cherry-pick it).
- **M5 — property run ≥ 10,000 cases:** full property run at the recorded seed (`20261011`) with `NOTES_PROPERTY_RUNS >= 10000` and an explicit test timeout; record the seed, runs, and verdict in the PR Proof.
- **M6 — panel states + screenshots + a11y proof:** all seven panel states mounted, committed 1440×900 / 390×844 screenshots as PR evidence, keyboard walkthrough and jest-axe proof, reduced-motion honored.

## Constraints (carried forward)

- Never push to or modify `obv/connvo-notes-ledger-f1`; never force-push; never rewrite history.
- Every commit: author `Sam Gu <127461594+SamGu-NRX@users.noreply.github.com>` + trailer `Co-authored-by: obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>`.
- Do not base on/merge/cherry-pick PRs #16, #22, #24, #25; PRs #14–#28 are read-only inputs.
- Do not modify `convex/meetings/**`, `convex/auth/**`, `tools/call-eval/`, `src/app/app/call/**`.
- Shared sandbox: take `flock /home/user/work/heavy.lock` around long steps; sandbox session resets lose unpushed work — push after every passing check.
