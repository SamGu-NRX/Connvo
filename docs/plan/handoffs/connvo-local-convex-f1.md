# Handoff — obv/connvo-local-convex-f1 (local Convex backend load fix, draft PR #35)

State at preservation pass 2026-10-12 ~09:2xZ. All coordinated sub-thread work is merged
into this branch and pushed. Nothing is running; nothing new was started after the
operator's stop order. Companion handoff with the integration-run detail:
`docs/plan/handoffs/connvo-local-convex-f1e.md`.

## Pushed SHAs (all authored Sam Gu with the obvious-autobuild[bot] co-author trailer)
- Umbrella `obv/connvo-local-convex-f1` @ `9fa08f3` (merge of f1e `09fc80c` into `2c0c4fa`),
  plus this handoff commit — exact tip SHA is in PR #35's Handoff section.
- `obv/connvo-local-convex-f1e` @ `09fc80c` — orchestrator `750f759`, recovery driver
  `16f4001`, failing witness `895b8ba`, cutoff witness `c9f0e24`, handoff doc.
- `obv/connvo-local-convex-f1c` @ `d26bbf1` — push unlock (`119f29f`: prune test artifacts
  from the materialized tree; a staged run pushed and seeded meeting
  `m97b6bv3j4p6gmmbzhem83wtws8g5dqn` with verified shape) + script hardening (`65d42fa`,
  `7bf5e6a`: push-complete marker required at the provisioning deadline check; eval env set
  before the first required push with fail-fast; `NEXT_PUBLIC_WORKOS_REDIRECT_URI` and dummy
  `WORKOS_API_KEY` written by the script; hardened liveness probe; fatal-only push fail-fast;
  run-4 seed `m97avnrxsgwys54askp2bsf9398g5e10`).
- `obv/connvo-local-convex-f1a` @ `9024328` — README correction: the -23.3% module-load claim
  withdrawn; 2026-10-11 tables labeled "Historical: pre-fix paired run — superseded proxy"
  (esbuild `splitting:true` side-chunk artifact); corrected `splitting:false` measurement
  (no measurable module-load benefit; deltas within untouched-control drift).
- `obv/connvo-local-convex-f1d` @ `1d917e4` — identity-keyed test-auth token cache with
  A-then-B tests; auth-gated meeting query with bounded retry; H-14 contract; 34/34 focused
  tests, no new type errors vs the 32-error baseline.

## DONE (verified)
- The push 408 loop is fixed in practice: two independent push+seed runs with shape
  read-back (f1c `119f29f` and f1e run 4, meeting `m97bh80a3a0avfsqpp1znw4rs18g4s29`,
  organizer local-test-a, A host, B/C joined, O absent from participants).
- The full chain provisioning -> guard -> env set -> push -> seed completed in f1e run 4
  from the merged tip (`9fc2b68`), stage 5/6 (next-dev) at the 05:00Z credit cutoff.
- Script hardening (operator item 1), README correction, token-cache/auth-query fixes
  (operator items 1-2 of the five-item round) — all merged here.

## NOT DONE / NOT RUN (honestly UNVERIFIED — do not claim as passed)
- **A/B/O real-browser proof — UNRUN.** Recorded unrun in `WITNESS.md` and `CUTOFF.md`
  under `tools/call-eval/verification/2026-10-12-f1e-rebuild-witness/`. The orchestrator
  (`run-proof.mjs`) and recovery driver (`recovery-proof.mjs`) are committed and ready.
- **e2e rerun with the `WORKOS_API_KEY` fix — UNRUN.**
- **call-eval suite rerun at the final tip — UNRUN** (47/47 call-eval + 290/290 general was
  measured at `119f29f`, before the addendum commits).
- **PR #35 body completeness — NOT DONE:** running-app screenshots in the PR, interaction
  recording, How-it-works diagram, final Proof section. Existing browser evidence
  (flag-off redirect to WorkOS, flag-on auth-proof page rendering and token issue) lives as
  project files in the Obvious workspace, not yet embedded in the PR.
- **Attribution of the original 408 loop** to materialized test artifacts is a strong lead
  (`119f29f` unlocked pushes; two successes since) but was never proven by isolation.

## Blockers hit during the round (resolved or documented)
- GitHub token write-rejection ~05:00-05:10Z ("Invalid username or token"; fetch
  authenticated, push rejected — write rights). The refreshed workspace token pushes fine
  (this preservation pass, verified via ls-remote-confirmed `2c0c4fa..9fa08f3`).
- GitHub API rate limit at 04:55Z deferred PR-body edits to the lead.
- Shared-sandbox infra: three platform replacements plus one deliberate reset; every
  sub-thread recovered from pushed refs + its thread record. Co-tenant load peaked at 42
  (witnessed in `backend-timed-out-push.log`).

## How to continue (exact commands)
1. `git fetch origin && git checkout obv/connvo-local-convex-f1 && git pull --ff-only`
2. `pnpm install --frozen-lockfile`
3. Write `.env.local`: `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (the dev redirect URI used by
   `run-proof.mjs`) and `WORKOS_COOKIE_PASSWORD` (32+ chars). The script writes the dummy
   `WORKOS_API_KEY` and test-auth vars itself — verify them in YOUR run log, not by trust.
4. `pnpm call-eval:proof` — trust stage 5+ only after the push-complete marker appears in
   your own log (the URL alone is not success; enforced at `local-backend.mjs`'s deadline
   check).
5. If stage 4 408s or times out: kill stray conn-eval tmux sessions, then
   `node tools/call-eval/scripts/recovery-proof.mjs` against the already-provisioned
   deployment (URL from `.env.local`) — it completes next-dev + the A/B/O browser run.
6. Evidence goes in `tools/call-eval/verification/<date-dir>/` (`out/` is gitignored);
   commit with Sam Gu author + the obvious-autobuild[bot] co-author trailer, push, and
   update PR #35's Proof/Handoff at the pushed SHA.

Traps: co-tenant port/tmux collisions (use a private tmux socket shim); convex 1.28 CLI has
no `--args-json` (use the `--meetingId=<json>` shape per `recovery-proof.mjs`);
authkit-nextjs 2.10.0 reads `NEXT_PUBLIC_WORKOS_REDIRECT_URI`; type-check baseline is 32
pre-existing errors, none in `tools/call-eval`.

Scope note: this is a preservation record only. No new work, fixes, or campaigns were
started for it (operator order). The A/B/O proof, e2e rerun, suite rerun, and PR-body
completeness items above remain the entire outstanding surface.
