# Handoff — match-explanations reviewer rework (PR #19)

**Status:** delivered — draft PR, human review outstanding. Commit `ac62dc4` on
`obv/products-l2-match-explanations-20261010` (base `obv/products-connvo-hardening-20261009-r1`).
PR: SamGu-NRX/Connvo#19 (draft, not merged, nothing deployed). Sibling study style:
see `experiments/postcall-evidence/HANDOFF.md`.

## What changed and why

Reviewer feedback on the first round rejected two counterfactuals as things no user
can do: `CF_ORG` set `scoringData.user.orgId` directly (orgId is assigned by the
organization) and `CF_EMBEDDING` spliced `embedding.vector` bytes (the vector is
computed by an embedder, not authored). This rework makes every counterfactual vary
an input a user can legitimately edit through their profile or matching preferences,
adds real tied-match cases, and adds a negative control proving the canary privacy
scan is not vacuous. Everything stays inside `experiments/match-explanations/`;
production code is untouched.

## Final counterfactual set (all user-controlled, rerun through the real handler)

Every case varies ONE permitted input and re-scores through the real production
`calculateCompatibilityScore` `_handler` (stubbed `ctx.runQuery`, synthetic
`UserScoringData` fixtures). Outcomes are recorded in `results/counterfactuals.json`
(`allExpectationsMet: true`) as the affected sentence's classification and computed
feature value:

| Case               | Varied input (why it is permitted)                                                                                                                                                                                                                                                                            | Sentence                                          | Before → After                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| CF_INTERESTS       | `scoringData.interests` — user-selected interest tags                                                                                                                                                                                                                                                         | "Strong interest alignment"                       | supported_contribution 0.7667 → false_reason 0.3    |
| CF_EXPERIENCE      | `scoringData.profile.experience` — editable via `updateProfile`                                                                                                                                                                                                                                               | "Ideal experience gap for mentorship"             | supported_contribution 1.0 → false_reason 0.7       |
| CF_FIELD_REEMBED   | `scoringData.profile.field` (editable via `updateProfile`), with the embedding recomputed via `deriveEmbedding` — the experiment's deterministic stand-in for re-embedding the changed profile content. The vector is NEVER edited directly; the case is labeled as a derived/simulated re-embed in its note. | "High semantic profile similarity"                | supported_contribution 0.9950 → false_reason 0.6581 |
| CF_ROLE_PREFERENCE | `constraints.roles` — the user's matching preferences (match-settings editor)                                                                                                                                                                                                                                 | "Complementary professional roles"                | supported_contribution 1.0 → false_reason 0.7       |
| CF_ORG_PREFERENCE  | `constraints.orgConstraints` same_org → different_org — the user's org matching preference; `orgId` itself is never varied. With the constraint strings no longer identical, the orgConstraintMatch short-circuit dissolves and the differing orgs resolve to 0.0.                                            | "You are in the same organization as this match." | eligibility_rule (rule-fired) → false_reason 0.0    |

A vitest guard pins the policy: describe block "counterfactual inputs are
user-permitted" → "never varies system-assigned identity or derived vectors
directly".

## Tied-match cases

`mentee-twin-a` and `mentee-twin-b` are scoring-identical fixtures (junior,
field Technology, languages [English], interests [ai, technology], constraint
interests [ai], seeking mentee, no embeddings) that differ ONLY in experiment id
and PRIVATE identity fields (displayName, orgId) — fields outside the score's
input surface. Each is paired against the same senior mentor fixture, giving two
candidate pairs:

- `twin-a-x-mentor` and `twin-b-x-mentor` both score exactly **0.875** with
  identical feature objects and identical explanation arrays, asserted
  exact-equal via the real handler in the test "twin pairs tie exactly on
  composite score with identical features and explanations".

`results/stability.json` records the tied group
(`scoreTies: [{score: 0.875, pairIds: ["twin-a-x-mentor", "twin-b-x-mentor"]}]`)
plus `tieExplanationsStable: true` and `scoringDeterministic: true` — tied pairs
produce deterministic, reproducible explanations (the replay compares them against
a fresh handler run).

## Negative control (the canary scan is not vacuous)

- Fixture `leaky-mentee-control` is never part of PAIRS; it exists only as a
  sentinel source for the control.
- Replay (`run.ts --replay`) builds a **fabricated** leak corpus — a real
  `mentee-x-mentor` explanation sentence with the control profile's private
  displayName sentinel `Canary Name Leaky` interpolated — and runs it through the
  SAME leak-detection code used for the real artifacts.
- Receipt in `results/stability.json`:
  `canaryControl: {sentinelPlanted: "Canary Name Leaky", detectedLeaks: ["Canary Name Leaky"], detected: true}`
  — the scan FAILS the planted leak, as required.
- The real committed artifacts stay clean: `canaryLeaks: []`. The real-artifact
  scan corpus covers the baseline/classification/counterfactual files; the
  fabricated control corpus is separate and never writes a leak into them.
- `allPassed` requires `canaryControl.detected` — a planted leak the scan MISSES
  fails the replay (non-zero exit), i.e. the negative control exits non-zero
  exactly when the scan stops working. Design note: the control receipt is
  committed in `stability.json` and gated into `allPassed`, a deliberate
  strengthening over keeping the control in tests only; the fabricated leak
  itself never enters the real artifact corpus.
- Vitest mirror: describe "canary scanner" → "passes a clean explanation corpus",
  "flags a deliberately leaked sentence (negative control)", "the control pair
  scores cleanly through the real handler (no leak)".

## Registered-function binding check (retained)

`binding.test.ts` → describe "entrypoint binding (real production handler,
offline)" → **"binds to the real registered Convex action handler"** still asserts
the experiment binds the registered production action via
`calculateCompatibilityScore._handler` (convex 1.28 exposes `_handler`). Unchanged
in intent.

## Checks performed (2026-10-11, worktree /home/user/work/Connvo-matchexp)

- Scoped vitest: `corepack pnpm exec vitest run --config
experiments/match-explanations/vitest.config.ts` → **21/21 pass** (1 file:
  binding.test.ts, which hosts the binding, references, tie, canary, and
  permitted-inputs suites).
- tsx runs (`corepack pnpm exec tsx`): `emit-baseline.ts` (8 profiles, 6 pairs,
  missing-user case "User data not found for scoring"); `run.ts --manifest
manifest.json` (6 classifications, both twins at 0.6 traceable share); `run.ts
--counterfactual` (allExpectationsMet=true); `run.ts --replay` → **Replay +
  stability: allPassed=true**.
- Replay agreement: byte-identical — working tree clean after replay
  (source-hashes, fixture-inventory, contribution-references,
  eligibility-references all matches=true; classificationReplayMatches,
  counterfactualReplayMatches true).
- Commit `ac62dc4` verified: author `Sam Gu
<127461594+SamGu-NRX@users.noreply.github.com>`, trailer `Co-authored-by:
obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>`,
  pushed (branch in sync with origin).

## Remaining work

Human review only. PR #19 remains draft; nothing merged, nothing deployed.
A preserved parallel draft implementation (hand-solved ties 83/96 and 11/32,
extracted `canary.ts`) lives on branch `obv/products-l2-matchexp-parallel-wip`
(`acef6d9`) for reference; it was not shipped because its counterfactuals still
varied the embedding vector and orgId directly.
