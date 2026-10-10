# Connvo matching engine study — allocation contract, exact-reference comparison, load degradation

Branch `obv/products-matching-study-20261009-r1` (base `main` at `8d73d9b`). Observational study: **no file under `convex/` was modified**; suspected defects are reported as findings, never fixed.

**Declared objectives, not ground truth.** All preferences, interests, roles, availability windows, and embeddings in this study are synthetic and seeded. They are *measurement objectives* chosen to exercise the allocator; they are **not** evidence about human match quality, and no real profile data appears anywhere. Whenever a number below is called "better" or "worse", it means closer to / further from these declared objectives on the engine's own score matrix — nothing more.

---

## 1. Scope and method

- **Execution**: the study drives the *real registered Convex functions* through `convex-test` 0.0.38 in-memory execution — same schema and module map the vitest suite uses (`experiments/matching-study/src/modules.ts` builds the module map by an fs walk + dynamic `import()` because `test/convex/setup.ts` relies on Vite-only `import.meta.glob`, unavailable under plain tsx).
- **Runner**: `experiments/matching-study/run.ts --manifest experiments/matching-study/manifest.json` (also `--replay <resultsDir>`); thin vitest bridge at `test/convex/matching-study.bridge.test.ts` runs the invariant suite and smoke-tier scenarios inside the repo's existing `convex` vitest project settings.
- **Clock**: `Date.now` is patched to a seeded logical clock (`src/clock.ts`); vitest fake timers are *not* used, so real wall time stays measurable via `performance.now`. Logical waiting times and wall times are reported separately and never mixed.
- **Data**: synthetic seeded populations (`src/generator.ts`, mulberry32 RNG), synthetic embeddings written as rows in the `embeddings` table (`vector` bytes, model `synthetic-hashed-v1`, 64 dims) so `calculateCompatibilityScoreInternal` picks them up exactly as production would. Rows are omitted when the plan says a user has no embedding — this exercises the weights-renormalization path (and avoids a real `NaN` hazard: production cosine has no zero-vector guard).
- **Independent reference**: `src/exactReference.ts` is a hand-written recursive enumerator over the engine's own cached score matrix (`calculateCompatibilityScoreInternal` for every eligible pair) — deliberately *not* reusing engine allocation logic. It reports maximum cardinality and maximum total weight (both unconstrained and at maximum cardinality) for n ≤ 8 under the same eligibility rules (window overlap, strict `score > minScore`).
- **Baselines** (`src/baselines.ts`): greedy-by-score-desc, greedy-FIFO, and 20 seeded random-order greedy runs, all on the same matrix without shard constraints.

## 2. The eligibility/pairing contract, as established by the suite

All 26 checks pass (25 pass outright; 1 is a labeled finding-demonstration, see §3.3 item 5). Bridge test: `test/convex/matching-study.bridge.test.ts`; scenario implementations: `experiments/matching-study/src/invariantScenarios.ts`.

**Entry/eligibility (queue.ts):**
- `entry requires at least one interest and one role` — empty constraints rejected.
- `availableFrom in the past is rejected`; `availableTo > availableFrom` enforced.
- `second waiting entry per user is rejected`; `re-entry after match is allowed`.
- Stale entries: `cleanup expires stale waiting entries` (expired=2), `expiry writes one auditLog per entry` (action `queue_expired`), `expired entries cannot be matched by a cycle`.

**Pairing (engine.ts, shardCount ∈ {1,4}):**
- Threshold is **strict**: `pair scoring exactly minScore does not match` (with `minScore` pinned to that pair's measured score of 0.4446465, matches=0); the same pair matches once the threshold drops below it.
- Shard isolation: `compatible cross-shard pair cannot match at shardCount=4` (hashUserId replicated in study code; shards 2,0) vs `same pair can match at shardCount=1`.
- FIFO scan cap: `with cap=2 and e1-e2 incompatible, zero matches (e3,e4 never scanned)`; widened cap → `e3,e4 scanned and matched`. Later arrivals are not scanned until earlier entries leave the head of the shard queue.
- FIFO ordering of `getShardQueueEntries` (by `createdAt`).

**Atomicity/consistency (createMatch + cycles):**
- `no user in two simultaneous matches` — including two **concurrent** `runMatchingCycle` actions; failed race attempts recorded (createMatch returned false, wrote nothing).
- `retry cycle creates zero new matches`; `matches plateau: retry adds nothing` (before=1 after=1).
- `every matchId has exactly two analytics rows with distinct userIds` (23/23 groups at n=46), `matchedWith pointers mutual and paired` (46 rows / 23 pairs), `derived match pairs agree with analytics matchId groups`.
- Concurrency: `queue matched-state agrees ... under concurrent cycles` (queueMatched=46, matches=23), `concurrent cycles: exactly two analytics rows per matchId` (bad=0).

**Pre-existing safeguards that already pass** (recorded in `baseline.json`): `convex/matching/matching.test.ts` — enter/cancel queue, positive score, single-cycle match, feedback rating bounds (4 tests, still green in every run this study performed).

## 3. Findings

### 3.1 Allocation quality: sharding is the dominant avoidable-loss driver on small pools

Engine vs independent exact reference, on the engine's own score matrix (weights = engine scores; `shardCount=4` except where noted):

| scenario | n | engine (card, weight) | exact max-card | exact max-weight @max-card | best baseline | engine vs exact |
|---|---|---|---|---|---|---|
| quality-n4-s101 | 4 | **1**, 0.852 | 2 | 1.306 | random greedy hits optimum (2, 1.306) | −1 match, −0.454 weight |
| quality-n6-s102 | 6 | **1**, 0.762 | 3 | 2.394 | random greedy hits optimum (3, 2.394) | −2 matches, −1.632 weight |
| quality-n8-s103 | 8 | **2**, 1.580 | 3 | 2.359 | greedy-fifo (3, 2.323); random-2 hits optimum | −1 match, −0.779 weight |
| quality-n8-s104-shard1 | 8 | **4**, 3.237 | 4 | 3.237 | all baselines = optimum | **exact optimum** |

Smallest counterexamples (committed, hand-verifiable, full score + overlap matrices): `counterexamples/quality-n4-s101.json`, `counterexamples/quality-n6-s102.json`, `counterexamples/quality-n8-s103.json`. In `quality-n6-s102` the engine commits {0,4} (0.7616) while three disjoint pairs {0,5},{1,3},{2,4} (0.819/0.770/0.805) are available — the engine never scans across shards.

Interpretation (against declared objectives only): with default `shardCount=4`, a queue of 4–8 users loses 1–2 matchable pairs **purely to hash-shard isolation** — unconstrained greedy on the same matrix reaches the optimum on every instance tested, and with `shardCount=1` the engine's greedy *is* the optimum on the one instance tested. These are small-n observations, not asymptotic claims.

### 3.2 Load behavior (bounded workloads; harness wall-time ≠ production cost)

Coverage = share of the population matched before their window expired; waiting times are logical ms (enqueue → match/expiry). "Wall" is the in-memory convex-test harness cost per cycle — it bounds study machinery, not production latency.

| scenario | n | matched | expired | still waiting | cycles | coverage | wait p50 (ms) | wait p90 (ms) | wait p99 (ms) | wall/cycle p50 (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| load-smoke-25 | 25 | 14 | 10 | 1 | 10 | 0.56 | 4,897,000 | 29,377,000 | 80,929,000 | 10.6 |
| load-smoke-50 | 50 | 44 | 5 | 1 | 12 | 0.88 | 1,000 | 7,199,000 | 86,401,000 | 15.8 |
| load-smoke-100 | 100 | 64 | 35 | 1 | 13 | 0.64 | 4,177,000 | 6,985,000 | 34,129,000 | 37.1 |
| load-full-250 | 250 | 172 | 77 | 1 | 18 | 0.688 | 4,033,000 | 6,653,800 | 36,346,600 | 45.8 |
| load-full-500 | 500 | 346 | 153 | 1 | 19 | 0.692 | 4,105,000 | 6,601,000 | 7,244,200 | 48.1 |
| load-full-1000 | 1000 | 748 | 251 | 1 | 19 | 0.748 | 3,968,200 | 6,531,400 | 7,157,800 | 244.2 |

Degradation observations: cardinality per cycle stays bounded by `maxMatches` (50) as designed; coverage at the 0.69–0.75 plateau for n ≥ 250 with p99 waiting dominated by the `daytime` availability class (narrow logical windows queue across days of logical time: e.g. n=250 daytime p99 39.0M ms vs always-on p99 7.2M ms). Expiry, not starvation, is the drain mechanism: expired totals track unmatched entries, and exactly one user per run remains waiting at horizon end.

### 3.3 Negative-space findings (verified against current `main` source; evidence = code citation)

1. **The scheduler's crons are defined but never registered.** `convex/matching/scheduler.ts:110-125` defines `crons.interval("automated matching cycle", {minutes: 5}, ...)` and an hourly "queue maintenance", and `export default crons` — but `convex/crons.ts` (the only registered cron list) contains no matching reference, and nothing imports scheduler's `crons`. The README's "every 5 minutes" automated-cycle claim is **unwired**: cycles only run when a client calls the action.
2. **The `matchingQueue` rate limit is dead configuration.** `convex/lib/rateLimiter.ts:42` defines a `matchingQueue` limit (5/min), but `enterMatchingQueue` (`convex/matching/queue.ts:92-125`) never consults a rate limiter — the only `matchingQueue` string near entry (queue.ts:114) is the `auditLogs.resourceType`. Unbounded queue-entry writes are possible.
3. **The matching system is unwired from the product surface.** No `api.matching`/`internal.matching` reference exists under `src/` (the only "matching" hits are marketing copy at `src/app/page.tsx:539,621` and a transcript-filter label at `LiveTranscriptionPanel.tsx:150`), and `convex/meetings/` has zero matching references. There is no match→meeting pipeline; a match changes queue rows and analytics only.
4. **`runMatchingCycle` is a public action** (`convex/matching/engine.ts:54`) with any-client reachability and no rate limit (see #2) — combined with #1, the entire matching trigger surface is "whoever calls it, as often as they like".
5. **`createMatch` does not revalidate availability at commit** (`convex/matching/engine.ts:413-436`): it rechecks `status !== "waiting"` for both entries but nothing about `availableFrom/availableTo`. Demonstrated deterministically at the mutation boundary — invariant `DOCUMENTS MISSING GUARD: createMatch commits a pair whose availability windows already passed` (detail: `createMatch returned true for expired windows`). This is a finding, deliberately not fixed.
6. **Weights renormalize when embeddings are absent** (`convex/matching/scoring.ts`): `calculateWeightedScore` divides by the sum of *present* feature weights, so the same non-vector features dominate differently depending on whether an embeddings row exists. The harness reproduces both paths (rows present/omitted). Score *levels* between users with and without embeddings are therefore not directly comparable — a semantics gap, not a bug fix candidate here.

## 4. Limitations

- **Synthetic embeddings are not `text-embedding-3-small` vectors**: `synthetic-hashed-v1` is a seeded hashed bag-of-attributes projection with no semantic content. Absolute score levels are not transferable to production; only *allocation* behavior (who gets matched given a matrix) is under test.
- **Synthetic preferences are declared objectives, never social-quality ground truth** — every quality statement is relative to the generator's objectives on the engine's own scoring function.
- **In-memory interleaving differs from production concurrency**: convex-test executes actions/mutations cooperatively in one process. The two-cycle concurrency check is real interleaving *of that kind*; production's distributed action execution can interleave differently.
- **Sharding reproducibility is id-dependent**: `hashUserId` runs on Convex id strings. convex-test allocates ids deterministically per insertion order, so recorded runs reproduce exactly (see replay agreement); production ids would not preserve shard membership across re-runs.
- **The full-tier `wall` columns measure this harness** (single process, 8 vCPU sandbox), not production latency.
- **Pre-existing suite instabilities, unrelated to the study** (both reproduce without any study file present): (a) `convex/transcripts/ingestion.test.ts` "time-bucketed sharding" fails whenever the suite runs in the last ~60 s before a 5-minute boundary (chunk 2 starts at `baseTime+60000` and crosses the bucket — fails when `baseTime mod 300000 ≥ 240000`; passes 9/9 in isolation and at other times of day); (b) one unhandled rejection, `Error: Write outside of transaction ...;_scheduled_functions` from convex-test 0.0.38 bookkeeping, attributed in the log to whichever `convex/types/__tests__` file happens to be running when the stale write fires.
- **Not run (by design, offline-only brief):** any OpenAI/provider/live-model call, any network endpoint, any deployment or cron activation. `text-embedding-3-small` score semantics were not measured against real embeddings.

## 5. Environment and resources

Recorded in `environment.json`: Linux 6.1.158+ x64, Node v20.20.2, 8 × Intel(R) Xeon(R) @ 2.60GHz, 8 GiB RAM; convex 1.28.0, convex-test 0.0.38, vitest 4.0.4, TypeScript 5.9.3 (pinned in package.json / pnpm-lock.yaml). Install: `corepack pnpm install --frozen-lockfile` (pnpm 12.11.2 via corepack; no `packageManager` field). Every run file binds seeds + SHA-256 source hashes (`run-summary.json.sourceHashes`) to the exact code state; `baseline.json` records the pre-study check counts at `8d73d9b` (240/240 vitest pass; `tsc --noEmit` fails with **29 pre-existing errors**, none in study files — unchanged by this study).

## 6. How to run / replay

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run --project convex            # 18 files / 242 tests (see §4 caveats)
corepack pnpm type-check                                  # 29 pre-existing errors, none in study files
corepack pnpm study:run                                   # full manifest (smoke + full tiers, ~20 min; heavy tier is CPU-bound)
corepack pnpm exec tsx experiments/matching-study/run.ts --replay experiments/matching-study/results
```

The runner regenerates every population from frozen seeds, re-executes the invariant suite, and diffs per-scenario outcomes against `run-summary.json`, writing `replay-agreement.json`. Raw per-cycle decisions: `decisions/`; failure traces: `run-summary.json.invariantFailures`; smallest counterexamples: `counterexamples/`.

*(Numbers in §2-3 are from the committed `run-summary.json`; the run that produced them binds to the commit recorded in its `gitSha` and `sourceHashes`.)*
