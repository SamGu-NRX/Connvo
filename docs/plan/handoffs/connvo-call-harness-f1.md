# Connvo F1 call-harness — handoff (2026-10-11, coordinator thread stopped)

Per the lead's directive this coordinator thread stopped work; the PR #30 Handoff-body edit was abandoned after repeated sandbox-provider deaths. The lead records the final state. Successor tasks: connvo-harness-core-f1 (runner, bench, reference transport, decoder fix, self-proof — no Convex) and connvo-local-convex-f1 (local Convex push, seed, auth proof). Both read these branches directly.

## Pushed state

- obv/connvo-call-harness-f1 at f06669f — S0b merge (bbc62fa: fixtures/decoders/orchestrator) plus PR-review fixes: convex/devEval/seed.ts created (env-gated on CONNVO_LOCAL_TEST_JWKS; idempotent upsert of A/B/C plus outsider O; returns meetingId), devEval added to HARNESS_INCLUDE_DIRS, convex.json backup written before modification, env set guarded to anonymous/local deployments only. Push verified by ls-remote at push time (fast-forward from bbc62fa).
- obv/call-harness/fixtures at 0982993 — M1+M2 complete: fixture-media.mjs, decoders.mjs (pinned 4-function API), 26 decoder tests, self-checking generator (11/11 PASS), eval vitest project, tsconfig. Same content as merged at bbc62fa; remote receipt 47904d6..0982993.
- obv/call-harness/runner at 8af5c4a — lead-verified on GitHub at 20:47Z. Runner waves 1-6b (contracts, probe, relay, shaper, turn lifecycle, peers, mock bench, context, orchestrator, scenarios H-01..H-16 plus P-01..P-05, CLI, NOTES-h15-loss-method.md), harness-dirs.txt (the 16-dir transport import closure: auth users meetings participants messaging realtime transcripts matching interests settings system schema lib types environments _generated), plus the bench-route / reference-transport / broken-variants wave.

## What passes (at last green runs on this content)

- pnpm test:run 266/266
- generator self-check 11/11, exit 0
- type-check: 32 errors, 0 in tools/call-eval
- node --check tools/call-eval/scripts/local-backend.mjs, exit 0
- harness-tree build simulation: 23 entries with devEval materialized

## Review-fix status

- f06669f fixes applied (see Pushed state).
- computeFps observed-advance fix NOT applied anywhere — apply in connvo-harness-core-f1 before the self-proof. Spec: in tools/call-eval/lib/decoders.mjs computeFps, advance when samples[i].counter !== samples[i-1].counter; fps = advances / (t_last - t_first) * 1000; keep the len<2 -> 0, elapsed<=0 -> 0, advances==0 -> 0 guards; no wrap special-casing (4095->0 is just a counter change). Tests: flip the skipped-counter case (t 0/33.33/66.67/100/166.67, c 0/1/2/3/5) from 30 fps to toBeCloseTo(24, 2) with inverted rationale — a dropped frame LOWERS the observed rate, the receiver never saw it; add counters i*3 at t=i*100ms for 7 samples -> toBeCloseTo(10, 2) AND toBeLessThan(15) (the H-01 bar must fail); optionally counters 0,30,...,150 at 1s spacing -> 1 fps (gap-sum would wrongly report 30).

## Convex local-push learnings (for connvo-local-convex-f1)

- 2-core sandbox, load 38-70 during the outage: full-tree pushes stall at deploy2/start_push with 408 retries then 500; a separate run showed InvalidModules from the 2s module-load timeout under load. Tiny-project control pushes succeeded; a 2250-file synthetic push succeeded; 8001 files is over the documented 4096 limit.
- Run the push ALONE and only when 1m load < 4. The backend download (1-3 min) is the long pole; a full attempt needs 4-7 quiet minutes.
- CLI: pin convex@1.28.0 — the npx default 1.46.0 rejects --local. Non-interactive provisioning needs a PTY: script -qec "convex dev --once --local ..." with tmux send-keys feeding the project name anonymous-connvo and Enter gaps 8s/4s/4s.
- The convex binary cache and deployment state die with the sandbox — expect a full re-download every boot.
- auth.config validation requires WORKOS_CLIENT_ID and CONNVO_LOCAL_TEST_JWKS set: a dummy client id plus dummy oct key are fine for the push; use REAL RS256 JWKS (issuer https://connvo-local-test.invalid) for seeding and the auth proof.
- Slim harness tree: COPY convex-harness/ (symlink layout fails with "wrong number of app bundles"); override convex.json with functions=convex-harness, node 18, externalDependencies=[]; back up convex.json to tools/call-eval/out first (fixed at f06669f). The 16-dir manifest is obv/call-harness/runner harness-dirs.txt — keep the tree to the transports' import closure.
- Persist evidence: write the push verdict to tools/call-eval/out/push-verdict.log and commit+push it so it survives boot death. If the push still fails at minimal tree plus typecheck disabled, commit a failing witness with exact timings and mark H-14 and the auth proof NOT DONE.

## Next steps

- connvo-harness-core-f1: start from obv/call-harness/runner; pull in the S0b fixtures content if not present; apply the computeFps fix and tests; add the package.json script 'call-eval' (README line 25: pnpm call-eval -- --transport=reference --suite=all --seeds=20; the script on the harness branch points at tools/call-eval/scripts/run-eval.mjs); run the H-01..H-13 self-proof over 20 seeds against reference. H-14 membership design: the reference signaling server verifies RS256 via --jwks-file and meeting membership via a --members-file manifest derived from state.json users (A/B/C seeded participants, O outsider) — no convex/** changes needed.
- connvo-local-convex-f1: start from obv/connvo-call-harness-f1 (f06669f); follow the provisioning recipe above; complete the push, seed a@connvo.test / b@connvo.test / o@connvo.test per tools/call-eval/scripts/local-backend.mjs phase 4, then the browser proof of the three access-control outcomes (A allowed, B denied-by-role, O outsider refused).
