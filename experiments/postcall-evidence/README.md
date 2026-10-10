# Post-call evidence study

Evidence harness for Connvo's post-call insight generation
(`convex/insights/generation.ts`): what the production generator actually
emits, where every emission comes from, and what a conservative refusal
policy would drop.

**Status: offline study complete — labels provisional, model arm NOT RUN.**

## What this is

- **Frozen inputs.** Synthetic meetings, provisional support labels, and the
  production source hash are pinned in `manifest.json` +
  `fixtures/meetings.json` (`labelStatus: provisional-interpretive`).
- **The real generator, not a copy.** `adapter.ts` reads the production
  file, pins it by SHA-256, slices the pure-heuristic region, and evaluates
  it with the repo's TypeScript compiler. Any production drift fails closed
  with a `FROZEN-SOURCE VIOLATION`. Production files are never written.
- **Provenance.** Every emission is resolved to a transcript segment, a
  notes line, or marked fabricated (`policy.ts`).
- **Conservative arm.** A study-side refusal policy (negation, stale plan,
  question, hypothetical, no-source) compared against the permissive
  production output. Provisional — it is a comparator, not a shipped change.
- **Model arm: NOT RUN.** Connvo has no model parser for insight generation
  (the only model usage in the Convex backend is OpenAI embeddings), and no
  live endpoint is contacted. The arm is recorded as not run rather than
  invented.

## Canonical results (`results/run.json`, deterministic)

| Metric | Value |
|---|---|
| Groups / meetings / cases | 7 / 7 / 13 (7 supported, 6 unsupported) |
| Emissions raw → unique | 17 → 15 |
| Supported / unsupported items | 6 / 9 |
| Unsupported by kind | negation 3 · unlabeled-emission 3 · correction 1 · hypothetical 1 · question 1 |
| Missed supported | 1 (the g6 commitment the generator never emitted) |
| Conservative kept / refused | 6 / 9 |
| Refusal reasons | negation 4 · no-source 2 · stale-plan 1 · hypothetical 1 · question 1 |

Reading: the permissive generator fires keyword triggers through negations
("we will not be adding OAuth device flow"), corrections ("Earlier we agreed
we should move…"), hypotheticals and questions; two of its fallback items
have no source at all. The conservative arm refuses 9 of 15 unique
emissions, keeps all 6 supported items, and still misses the one supported
commitment the generator never emitted.

## Run / replay

```sh
# Regenerate results from the frozen inputs (offline, in-process only)
pnpm exec tsx experiments/postcall-evidence/run.ts --manifest experiments/postcall-evidence/manifest.json

# Replay against committed results; exit 1 on any disagreement
pnpm exec tsx experiments/postcall-evidence/run.ts --replay experiments/postcall-evidence/results

# Tests (28)
pnpm exec vitest run --config experiments/postcall-evidence/vitest.config.ts
```

Committed evidence: `results/run.json`, `results/replay.json`
(agreement: true), `results/recap-data.json`.

## Recap page

`results/recap.html` renders `recap-data.json` (no build step). Serve the
folder — browsers block `fetch` on `file://`:

```sh
python3 -m http.server -d experiments/postcall-evidence/results 8412
# open http://localhost:8412/recap.html
```

Keyboard: `j`/`k` move between groups, `r` refused-only, `a` all, `?` help.

## Caveats

- Labels are provisional and interpretive; they pin intent, not ground truth.
- The conservative policy is a study-side comparator, not a production change.
- No model-parser arm was run (none exists); any future model arm needs its
  own manifest entry, hashes, and explicit not-run markers until executed.
