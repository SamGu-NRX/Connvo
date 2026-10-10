# Match Explanations — traceability experiment

Experiment-only sandbox for auditing **why the compatibility scorer says what
it says**. Everything lives in this directory; nothing outside
`experiments/match-explanations/` is modified.

## Scope and non-goals

- **Binds, does not change.** The experiment imports the production
  `calculateCompatibilityScore` Convex action (`convex/matching/scoring.ts`) and
  invokes its registered handler (`_handler`) with a stub action context whose
  `runQuery` serves controlled synthetic profiles in place of
  `internal.matching.scoring.getUserScoringData`. `convex/matching/`, the
  weights, production pages, and root test infrastructure are **not edited**.
- **Not a score-quality study.** The running PR15 owns allocation quality. This
  experiment audits *explanation traceability*: which sentences in a proposed
  public explanation are backed by computed features and rules, and which are
  not.
- **Synthetic data only.** Fixtures are invented profiles; every private field
  (`displayName`, `orgId`, `orgRole`, `company`, embedding bytes) carries a
  distinctive "Canary …" sentinel so any leak into a public explanation is
  detectable by string search.

## Milestones

1. **Binding** — synthetic profiles → real scoring/explanation entrypoint.
   `vitest.config.ts` + `binding.test.ts` verify the binding, record
   contribution references (sentence → feature → computed value), eligibility
   references (rule structures with real computed witnesses), source hashes of
   every untouched production file the results depend on, and exact fixture
   counts. Results in `results/`, emitted by `emit-baseline.ts`.
2. **Classification** — `run.ts --manifest manifest.json` classifies each
   sentence of a *proposed public explanation* as supported contribution,
   eligibility rule, missing-data statement, or untraceable assertion; commits
   the traceable share and per-sentence witnesses; counterfactuals vary only
   user-controlled inputs and never promise a match.
3. **Replay and stability** — `run.ts --replay results` re-derives committed
   results; private-field canary and false-reason mutation failures;
   formatting/tie stability counts; keyboard walk of the experiment-only page
   (`page/index.html`) at phone width.

## Method notes

- The offline binding works because the production action reads user data
  exclusively through `ctx.runQuery` (asserted by tests; guarded by the
  committed source hashes). If `convex/matching/scoring.ts` changes, the
  committed-hashes test fails and the experiment must be re-baselined.
- The production validator build (`convex@1.28`) exposes no runtime
  `parse`/`validate` on validator objects, so fixture conformance is enforced
  by the `UserScoringData` TypeScript type plus real-handler execution.
- Witness values in `results/*.json` always come from the real handler's own
  output, never from hand arithmetic. Where the implemented rule differs from
  an idealized rule (e.g. identical org-constraint strings short-circuit to
  1.0 regardless of orgs), the as-implemented semantics are recorded.
- Known as-implemented findings are recorded under `computedButUnsurfaced`:
  `industryMatch`, `timezoneCompatibility` (hardcoded 1.0 placeholder), and
  `orgConstraintMatch` are computed but never cited by any explanation
  sentence.
