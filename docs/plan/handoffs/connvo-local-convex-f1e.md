# Handoff — obv/connvo-local-convex-f1e (one-command local-backend browser proof)

State at cutoff 04:55Z 2026-10-12: tip `c9f0e24` (merged umbrella `2c0c4fa` at `9fc2b68`).

## What is done (pushed)
- `750f759` one-command orchestrator `tools/call-eval/scripts/run-proof.mjs` + `pnpm call-eval:proof` (backend → verify → next-dev → browser A/B/O → summary), `16f4001` recovery driver `recovery-proof.mjs` (completes next-dev + browser against an already-provisioned deployment; reads `.env.local`; fixed tmux single-string quoting + convex-1.28 shape syntax `--meetingId=<json>`).
- `895b8ba` failing witness: fresh-deployment provisioning (port 3210) + guard ok, then stage-4 re-push timed out at 540 s under load 42 (full backend + convex-dev logs in `tools/call-eval/verification/2026-10-12-f1e-rebuild-witness/`).
- `c9f0e24` cutoff witness: run 4 from merged tip reached stage 4/6 (slim harness re-push + seed) in flight at 04:50Z; env vars (`NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `WORKOS_API_KEY`, test-auth flags) verified present in run 4's own log and `.env.local` (`env-verification.txt`).

## Proof that already exists (prior sandbox, cited in repo docs)
- Push + seed + shape read-back proven at f1c `119f29f` (`tools/call-eval/verification/2026-10-12-local-push-witness.md`): meeting `m97b6bv3j4p6gmmbzhem83wtws8g5dqn`, organizer local-test-a, A host, B/C joined, O without participant row. (c)'s run-4 equivalent: `m97avnrxsgwys54askp2bsf9398g5e10`.

## What is left
- The A/B/O real-browser run against the seeded meeting (screenshots + recording + run log committed). Run 4 (log in `tools/call-eval/out/proof-2026-10-12T04-43-4*/run.log`, untracked — out/ is gitignored) may finish after cutoff; check its log, `state.json`, and any screenshots before rerunning.

## How to continue
1. Fresh clone; merge umbrella; `pnpm install --frozen-lockfile`; write `.env.local` (NEXT_PUBLIC_WORKOS_REDIRECT_URI, 32+ char WORKOS_COOKIE_PASSWORD, dummy WORKOS_API_KEY) — the updated script also writes the latter two itself; verify both in YOUR run log.
2. `pnpm call-eval:proof` — needs the push-complete marker from your own log before trusting later stages. If stage 4 408s/times out, `recovery-proof.mjs` completes next-dev + browser from a provisioned deployment (kill stray conn-eval sessions first; deployment URL comes from `.env.local`).
3. Known traps: co-tenant port/tmux collisions (use a private tmux socket shim); `out/` is gitignored (evidence goes to `tools/call-eval/verification/`); convex 1.28 CLI has no `--args-json`; authkit-nextjs reads NEXT_PUBLIC_WORKOS_REDIRECT_URI. GitHub API rate limit hit at 04:55Z — PR-body edits go through the lead.
