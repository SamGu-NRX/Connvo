# Local call verification

The real call route passed H-18 on seeds 1, 2, and 3 after merging alpha `7aabfb8`. Both peer roles decoded advancing remote video after joining audio-only. H-01 through H-14 then passed 14/14 on seed 1 after fixing the probe to preserve its relay override during ICE refresh. The raw runs, including the earlier failed probe run, are in `tools/call-eval/verification/2026-10-15-lane3/`.

`~/.long-run/bin/heavy node tools/call-eval/scripts/lifecycle-proof.mjs --base-url=http://localhost:3103` passed on the merged call implementation. It checked last-leave completion, capture release, ended-link capture refusal, keyboard navigation to recap, matching stored duration in recap and history, and outsider rejection without capture. `lifecycle-proof.json` holds the stored timestamps and 32 normal/reduced-motion accessibility audits with no serious or critical violations. Loading, failed-check, and unavailable-call responses are scoped browser fixtures. The proof call lasted 742 ms, correctly displayed as 0 whole seconds. The screenshots also show longer call durations from the regression run.

All 16 files in `screenshots/` were inspected at their original sizes. Each state has 1440×900 and 390×844 captures: checking, failed check, unavailable call, ended notice, ended reload, recap, history, and outsider rejection. The notices and duration fields fit both viewports. No pre-change capture or interaction recording is included.

`pnpm test:run` passed 828 tests in 78 files. `pnpm type-check`, `pnpm convex:codegen`, and `pnpm validate-types` passed, including 101 validator checks. The post-run probe regression tests passed 4/4. The type compatibility and performance core suites passed 28/28. Remaining CI failures and their source locations are in `ci-gaps.md`.

These runs used fake browser media and seeded identities against this worktree's anonymous local backend. They do not verify hosted WorkOS or physical devices. The earlier mobile Lighthouse development-server run scored 100 for accessibility and 60 for performance; `lighthouse.json` records its metrics and source revision. It is not a production performance result.
