# Handoff — post-call evidence study

**Status: offline study COMPLETE. Draft PR #17, NOT merged. Nothing in this
study touches production behavior.**

Draft PR: https://github.com/SamGu-NRX/Connvo/pull/17
Branch: `obv/products-l2-postcall-evidence-20261010`, base
`obv/products-connvo-hardening-20261009-r1` (retargeted from `main` on
2026-10-10 so inherited production changes stay out of the study diff; the
hardening branch contains the study base `d86620c`, and the PR diff is
exclusively `experiments/postcall-evidence/`).

## What exists

- `manifest.json` + `fixtures/meetings.json` — frozen inputs: 7 groups /
  7 meetings / 13 labeled cases; `labelStatus: provisional-interpretive`.
- `adapter.ts` — loads the real production generator
  (`convex/insights/generation.ts`, pinned SHA-256 `30d31850…`), slices the
  pure-heuristic region, compiles it with the repo's TS config. Any
  production drift fails closed (`FROZEN-SOURCE VIOLATION`).
- `policy.ts` — per-emission provenance (transcript segment / notes line /
  fabricated) and the study-side conservative refusal policy (negation,
  stale-plan, question, hypothetical, no-source).
- `study.ts` — shared executor; `run.ts` — `--manifest` (run) and
  `--replay` (regenerate + compare, exit 1 on drift).
- `results/` — `run.json` (canonical), `replay.json` (agreement: true),
  `recap-data.json`, `recap.html` (standalone page).
- `walk.mjs` + `results/walk/` — keyboard-walk evidence for the recap page
  (Playwright Chromium, 8/8 steps, screenshots + `walk.json`).

## Canonical results (deterministic)

17 raw → 15 unique emissions; 6 supported / 9 unsupported (negation 3,
unlabeled-emission 3, correction 1, hypothetical 1, question 1); 1 missed
supported commitment (the g6 item the generator never emitted). Conservative
arm: 6 kept / 9 refused (negation 4, no-source 2, stale-plan 1,
hypothetical 1, question 1).

## Verify / resume

```sh
cd /home/user/work/Connvo-postcall   # dedicated worktree; do not switch the shared checkout's branch
pnpm exec vitest run --config experiments/postcall-evidence/vitest.config.ts   # 28 tests
pnpm exec tsx experiments/postcall-evidence/run.ts --replay experiments/postcall-evidence/results
node experiments/postcall-evidence/walk.mjs   # keyboard-walk evidence, needs playwright from /home/user/work/connvo-testdeps
```

If `run.ts --replay` disagrees, do NOT edit `results/run.json` by hand —
re-run `--manifest` and diff; any disagreement means the production source,
fixtures, or manifest drifted, and the hash pins will say which.

## Caveats / open items

- Labels are provisional and interpretive; they pin intent, not ground truth.
- The conservative policy is a study-side comparator, not a shipped change.
- Model arm: NOT RUN — Connvo has no model parser for insight generation
  (only OpenAI embeddings exist in the Convex backend). Any future model arm
  needs its own manifest entry and explicit not-run markers until executed.
- `results/recap.html` must be served over HTTP (`python3 -m http.server -d
  experiments/postcall-evidence/results 8412`); `file://` fetch is blocked
  by browsers.
- Commit-trailer rule (2026-10-10): every commit message ends with
  `Co-authored-by: obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>`;
  author identity stays Sam Gu.
