# Lane 3 verification

The branch includes alpha `6c0ae81045d02bcc9501221e39b00f5591ee93dd`. Convex 1.46 generated the complete combined backend after the merge, preserving live prompts, TURN, queue-created meetings, and the lifecycle helper.

## Current dependency and build checks

Next, eslint-config-next, the explicit SWC package, and their Next-specific dependencies resolve to 16.4.1, npm's newest stable Next 16 release when checked. React and React DOM resolve to the compatible 19.2.9 patch. The upgrade includes the [React2Shell fix missing from 16.0.1, CVE-2025-66478](https://nextjs.org/blog/CVE-2025-66478), and the [October 14 fixes](https://nextjs.org/blog/nextjs-security-update-october-14-2026): GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw / CVE-2026-96889, and GHSA-p3m5-59mp-jv5r. The resolved sharp version is 0.35.5.

- `pnpm type-check` passes both the app and strict JavaScript compilers.
- `pnpm convex:codegen` and `pnpm validate-types` pass, including 101 validator checks.
- `pnpm test:run`: 889/889 tests pass across 86 files.
- `NEXT_PUBLIC_CONNVO_TEST_AUTH=0 NEXT_PUBLIC_CONNVO_LOCAL_BUILD=0 ~/.long-run/bin/heavy pnpm build` passes on Next 16.4.1 after the final source changes. This selects the production auth path; no browser contacted a hosted backend.
- `pnpm exec eslint src convex tools test --format json` still reports 12 errors and 23 warnings in excluded call UI, queue behavior, and Andrew's landing page. Exact locations and each CI job's commands are in `ci-gaps.md`. CI is not green.

Sam explicitly assigned lane 3 the queue-page exception after lane 1 finished. The search-parameter consumer now has Suspense with the queue's existing loading view. All other pages using `useSearchParams` have boundaries. `pnpm test:run test/in-call/match-queue.test.tsx` passes 23/23, including suspended parameters, identical loading markup, and no fallback mutation.

The queue-created meeting regression follows mutual acceptance through staggered call joins and final leave. The meeting stays active before capture, starts its recorded duration at the second call session, and concludes with the exact elapsed time after the final session leaves.

The notes meeting-switch regression failed before the fix: meeting A's content at version 5 leaked into rowless B. The keyed provider session now starts B empty at version 0, writes with `clientSequence: 0`, and preserves A. The focused provider/matrix/replica suite passes 26/26, including all seven deliberate replica defects. An independent read-only review found the correction resolved the original failure.

## Real-page call receipts

On Next 16.4.1, `~/.long-run/bin/heavy pnpm call-eval -- --transport=p2p --page=real --signaling=convex --base-url=http://localhost:3103 --scenarios=H-01 --seeds=1` passes 1/1. Remote video advances at 31.7 and 30.5 fps. Raw results are in `tools/call-eval/verification/2026-10-15-lane3/next1641-h01-results.json`.

The broader transport runs used Next 16.0.11 after alpha `7aabfb8`: H-18 passed seeds 1, 2, and 3 with both peer roles decoding late-enabled video. H-01 through H-14 passed 14/14 on seed 1 after the probe retained its relay override during ICE refresh. H-17 passed with endpoint-issued credentials, both peers selecting relay/relay, decoded video, and received audio peaks of 656.7 and 437.3 Hz. Those receipts, including the earlier failed probe run, are in the same verification directory. They contain no credential values.

## Visual and interaction evidence

`~/.long-run/bin/heavy node tools/call-eval/scripts/lifecycle-proof.mjs --base-url=http://localhost:3103` passed last-leave completion, capture release, ended-link capture refusal, keyboard navigation to recap, stored duration in recap/history, and outsider rejection without capture. `lifecycle-proof.json` records timestamps and 32 normal/reduced-motion accessibility audits with no serious or critical violations. The proof call lasted 742 ms and correctly displayed 0 whole seconds. Other history rows show longer durations. Loading, failed-check, and unavailable responses are scoped browser fixtures.

`~/.long-run/bin/heavy node tools/call-eval/scripts/queue-loading-proof.mjs` passed at both viewport sizes on Next 16.4.1. A temporary local route holds the search consumer suspended, then changes to the query-loading view; their measured rectangles match exactly. The script removes that route in `finally`. Its scoped history-response fixture checks five automatic empty pages, an honest continuation message, and one additional query from the manual Load more button. `queue-loading-proof.json` and `history-pagination-proof.json` record the results, including zero serious/critical accessibility violations.

All 20 screenshots were inspected at their original sizes. Each state has 1440x900 and 390x844 captures: checking, failed check, unavailable call, ended notice, ended reload, recap, history, outsider rejection, queue Suspense fallback, and history continuation. No pre-change visual baseline or interaction recording is included.

These runs use seeded identities and fake browser media against this checkout's anonymous backend. They do not establish hosted WorkOS or physical-device acceptance. The earlier development-server Lighthouse run scored accessibility 100 and performance 60; `lighthouse.json` records its source and metrics. It is not a production performance result.

Owned Next/backend processes were stopped after verification. Generated `.next`, media fixtures, and the untracked validation report were removed. No production deployment or merge into alpha/main was performed.
