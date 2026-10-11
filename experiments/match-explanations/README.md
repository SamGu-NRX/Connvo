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

## Counterfactuals and negative controls (review rework)

- **Permitted inputs only.** Every counterfactual varies an input a user can
  legitimately change: profile content through the profile editor
  (`interests`, `experience`, `field`, languages) or matching preferences
  through match settings (`constraints.roles`, `constraints.orgConstraints`).
  `orgId` is system-assigned and is never varied; embedding vectors are never
  edited directly — the `CF_FIELD_REEMBED` case changes the profile *field*
  and the synthetic embedder (`deriveEmbedding`, standing in for the
  production model) recomputes the vector, exactly as the production pipeline
  would. A test pins this invariant against the case definitions.
- **Tied matches.** The twin fixtures `mentee-twin-a` / `mentee-twin-b` are
  scoring-identical by construction; `twin-a-x-mentor` and `twin-b-x-mentor`
  tie at composite 0.875 with identical features and identical explanations.
  The stability check fails any tie group whose identically-featured pairs
  receive different explanations.
- **Negative control for the canary scan.** `leaky-mentee-control` (never part
  of the main run or the results page) feeds the scanner a fabricated
  explanation sentence with its private `displayName` sentinel interpolated;
  the scan MUST flag it (`results/stability.json` → `canaryControl.detected`),
  proving the privacy check fails when a leak exists. The real handler's own
  explanations remain leak-free (`canaryLeaks: []`).
- **Classifier hardening.** Eligibility-backed sentences are now
  feature-contradiction-aware: when the rule outcome equals a known
  contradicting value (e.g. `orgConstraintMatch === 0` against a
  "same organization" claim), the sentence is classified a false reason, not
  an eligibility rule.

## Handoff

**Complete:** handler binding with registered-function checks (`_handler`
guards, runQuery audit trail), fixtures (8 profiles / 6 pairs + missing-user
case), 21-test suite, baseline artifacts, classification manifest v2,
permitted-input counterfactuals (5/5 met), replay + stability (byte-identical
replay of all artifacts, deterministic scoring, twin tie stable, canary
negative control detected), and the read-only results page with a phone-width
keyboard walk in `evidence/`.

**If `convex/matching/scoring.ts` changes:** the committed-hashes test fails —
re-run `pnpm exec tsx experiments/match-explanations/emit-baseline.ts`, then
`run.ts --manifest manifest.json`, `run.ts --counterfactual`, and
`run.ts --replay`, and commit the regenerated `results/`. To add pairs,
extend `fixtures.ts` and `manifest.json` the same way and re-run all four.

**Open deliverable:** draft PR SamGu-NRX/Connvo#19 (base
`obv/products-connvo-hardening-20261009-r1`) — not merged.

**Pre-existing repo breakage (not this experiment's):** `pnpm run lint`
(`next lint` invocation error + legacy `.eslintrc` chain) and root
`pnpm run type-check` (`test/test.setup.mts` missing `vite/client` types).
