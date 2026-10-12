# Closing-round addendum — local-backend hardening after witness 2026-10-12

Scope: operator closing round item 1 (commit `65d42fa`) plus three robustness
fixes found by rerunning the witness protocol on this tree (commit `7bf5e6a`).
All timestamps UTC 2026-10-12; sandbox is the shared 2-core box.

## Run-4 chain (witness reruns at f1c `65d42fa` + uncommitted fixes)

- **03:26–03:31Z** — Run 4 stages 1–3 green. Provisioning wait hit its 540 s
  deadline because the `provisioning` log line only ever appears on a COLD
  start; the deadline check now accepts the "backend up" line too (committed
  in `65d42fa`).
- **03:32–03:41Z** — First rerun starved for the full 540 s provisioning
  budget while `uptime` showed load 13–22 (co-tenant suites) — yet
  `localBackendAnswers` returned true for the same port in <1 ms. The single
  3 s curl probe is not load-safe. Fix (in `7bf5e6a`): two probes with a
  10 s ceiling each.
- **03:37:36Z** — Second rerun died at the re-push fail-fast:
  `Hit an error while pushing` (start_push, code 0). Backend log at
  `03:37:36` shows the cause was `Environment variables have changed during
  push` — a retryable race with stage-3's `convex env set` — and the CLI
  **self-retried**: `✔ 03:37:40 Convex functions ready! (3.82s)`. The
  fail-fast had treated the generic wrapper line as fatal and killed the
  script four seconds before the retry landed. Fix (in `7bf5e6a`): the
  fail-fast now trips only on fatal module-evaluation patterns
  (`InvalidModules`, `Uncaught …Error`, `process.exit() called`, missing
  `WORKOS_CLIENT_ID`); generic wrapper lines fall through to the marker
  wait, and a genuinely fatal push surfaces as the deadline timeout with
  the log tail.
- **03:39:55Z (run 4 clean)** — with both fixes live, stages 1–4 completed:
  harness tree pruned 7 test artifacts, deployment guard ok
  (`anonymous:anonymous-connvo-guards` on 127.0.0.1:3212), re-push
  completed, **seed produced meeting `m97avnrxsgwys54askp2bsf9398g5e10`**.
  Stage 6 (:3000) then returned **HTTP 500 on every request**:
  `NoApiKeyProvidedException: Missing API key … define it in the
  WORKOS_API_KEY environment variable.` (authkit-nextjs constructs the
  WorkOS client on every middleware hit; the redirect-URI fix in
  `65d42fa` had already moved the failure past the previous 500 cause).
  Fix (in `7bf5e6a`): a dummy `WORKOS_API_KEY` is written into both the
  managed `.env.local` eval block and the next-dev shell env prefix; it is
  inert because the test-auth path never calls WorkOS APIs.

## Pending (unrun — recorded honestly)

- The full clean-checkout e2e rerun with the `WORKOS_API_KEY` fix has **not
  executed**. The shared sandbox was reset again mid-round (second wipe);
  the rebuilt clone's pnpm bootstrap (corepack shim) was still failing
  under sustained co-tenant load and infra latency when the ~05:00Z credit
  cutoff arrived. Expectation, not evidence: stages 1–5 repeat as in run 4
  and stage 6 goes green with the key present.
- The call-eval test suite (50/50 at `65d42fa`) was not re-run after
  `7bf5e6a`; the changes touch only the I/O-wiring wrapper (regex constants
  and env strings), which the core unit tests do not exercise.
- Seed-shape verdict from run 4 stands: users A/B/C + outsider O, one
  active meeting with participants (A host) + meetingState — matches the
  browser-proof shape.
