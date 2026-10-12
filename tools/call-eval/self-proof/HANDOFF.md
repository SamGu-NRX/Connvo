# Handoff — Connvo call-eval self-proof matrix (child lane 36)

Written at the operator's preservation order (2026-10-12, ~09:15Z). This lane is
stopped; the local implementer owns `obv/connvo-harness-core-f1`. Do not push
here again without the operator.

## Base / head

- **Base (the commit actually used):** `92def94` — `origin/obv/connvo-harness-core-f1`
  (umbrella merge: ICE-restart fix ef7f9bf, scenario diagnostics e5940a3,
  5-seed proofs 62049b0, 1262dd6).
- **Work commit (pushed and verified on the remote):**
  `3f81847aa7ec3334c624f0f3f2b34d11920decb9` — `obv/connvo-36-child-handoff`,
  verified via `git ls-remote` immediately after push.
- **This handoff commit** sits directly on top of `3f81847`; its SHA is in the
  lane's final task report. Two commits only: the table fix (`8fe10a6`) and
  this preservation set (`3f81847` + handoff).

## What is DONE (verified this session)

1. **Full 20-seed self-proof matrix on 92def94** — all 299 cells
   (260 reference + 39 variant) checkpointed and complete:
   - **reference: 260/260 cells pass** (H-01..H-13 × 20 seeds, zero failures).
   - **no-audio fails exactly H-02, H-03** — matches the table.
   - **no-reconnect fails exactly H-07** — matches the table.
   - **never-close fails H-11 AND H-13** — deterministic across three runs
     (7004f7a partial, 92def94 first pass, 92def94 final). Mechanism: with
     `leave()` closing nothing and one identity scheme (bench-minted subjects
     ARE the harness ids A/B), the server-side stale session blocks A's own
     cycle-2 rejoin. Expectation table updated in `8fe10a6` with rationale.
   - Old-code-fails proof: the old table rejected this exact checkpoint
     (first full run `EXIT=1`; all eight per-scenario resume slices exited
     nonzero on the never-close mismatch). New-code-passes proof: full-scope
     regeneration exits 0, all four sections PASS (`logs/regen-92def94.log`).
2. **Results committed** under `tools/call-eval/self-proof/`:
   `results.json` (299 records, regenerated with the corrected table),
   `summary.md`, `checkpoint.jsonl` (299 rows, force-added despite the
   usual gitignore so the run is replayable).
3. **Infra event documented**: the first full pass's signaling server died at
   ~08:04Z; every join from H-06 seed 2 on failed with `join failed (phases
   failed/failed)` / H-06 20 s deadline misses. Those 152 rows were purged
   (backup: `logs/checkpoint-92def94-poisoned.jsonl`) and re-run per-scenario
   with fresh signaling servers — all clean, zero failures. Logs:
   `logs/connvo-matrix-run-92def94.log` (truncated mirror of the first pass),
   `logs/connvo-matrix-slices-92def94.log` (the slice re-runs),
   `logs/regen-92def94.log`.

## NOT DONE / NOT RUN (honest gaps)

1. **H-15 getStats evidence is NOT valid.** `capture-h15-stats.mjs` ran, but
   every window recorded `received=0 lost=0 lossPct=null` while ~30 fps
   decoded — the page-side inbound filter matched no reports on the current
   probe globals. Marked **`h15-getstats/INVALID.txt`**. Fix direction (do NOT
   rerun as-is): align the sampler with `tools/call-eval/runner/page-helpers.mjs`
   `readRtpStats` / `collectRtpStatsWindow` (the scenarios' own working path).
   Consequently **NOTES-h15-loss-method.md:29-41 remains unbacked** by
   committed evidence on this branch.
2. **Evidence captures never taken** (bench after-screenshots, before/after
   state pair, short join→tile→leave recording under
   `tools/call-eval/self-proof/evidence/`).
3. **P-01..P-05 were not part of this matrix run** (H-01..H-13 + variants
   only, per the run command recorded in `summary.md`).
4. **Nothing from this lane is on the umbrella.** `8fe10a6` (never-close
   table fix) and `3f81847` (results) are on this side branch only; the
   coordinator/local implementer owns the join decision.
5. Wall-time context: first live pass 1329.1 s (~22 min, 07:53–08:15Z) +
   slice re-runs ~08:20–09:04Z + surgery ≈ 71 min end-to-end on the shared
   2-core box, including the infra-death window. Per-cell `ms` values are in
   `results.json`.

## Checkpoint / resume command

```sh
# inside a clone of https://github.com/SamGu-NRX/Connvo.git, on this branch:
node tools/call-eval/scripts/self-proof.mjs --base-url=http://localhost:3311 --seeds=1..20
```
The 299 checkpointed rows are restored and skipped; add `--fresh` to discard
them, `--scenarios=H-07 --seeds=2..20` to slice, `--variants=…` to restrict
variant arms. The bench dev server must be up on the base URL
(`NEXT_PUBLIC_CONNVO_CALL_BENCH=1 next dev`).

## File map

- `tools/call-eval/self-proof/results.json`, `summary.md`, `checkpoint.jsonl`
- `tools/call-eval/self-proof/h15-getstats/` (INVALID — see `INVALID.txt`)
- `tools/call-eval/self-proof/logs/` (run logs, poisoned-checkpoint backup,
  superseded 7004f7a comparison checkpoint, crashed capture log)
- `tools/call-eval/scripts/self-proof.mjs` (expectation table at :41-46)
- `tools/call-eval/scripts/capture-h15-stats.mjs` (import fixed; sampler
  still broken as described above)
