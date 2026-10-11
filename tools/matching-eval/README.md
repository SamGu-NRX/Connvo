# Connvo Matching Eval

Evaluation harness for one-on-one match quality. It answers one question with
numbers: **is a match worth showing up for, and can we prove which matcher is
better?** It is a pure offline harness — it never reads production data, never
calls a paid API, and runs from a single command.

Run it:

```bash
pnpm tools:matching-eval          # runs every matcher × every seed, writes out/
```

Outputs land in `tools/matching-eval/out/`: `results.json` (one record per
matcher × seed, with every metric), `summary.md` (the comparison table and
pass-bar verdicts).

## Design

### Synthetic population (`src/population.ts`)

A seeded generator produces N=2,000 profiles whose fields follow the
documented distributions below. "Seeded" means the entire population is a
pure function of one integer seed; changing the seed gives a new but
statistically identical world. Distributions are stated, not tuned to make
any matcher look good.

| Field | Distribution |
| --- | --- |
| interests | 36-item taxonomy; per-user 3–8 interests sampled with Zipf popularity (few mainstream, many niche) |
| role | 12 roles in 4 families (build / product / go-to-market / operate); role probabilities follow the taxonomy weights |
| experience | years ~ lognormal(µ=1.7, σ=0.9) clamped to [0, 30], bucketed entry/junior/mid/senior/lead/executive |
| industry | 10 industries with fixed popularity weights |
| timezone | 9 UTC offsets with hub-mass (Americas −8/−5, Europe 0/+1, India +5.5, SE Asia +8, Australia +10) |
| languages | 8 languages; English 70% as primary; 1–3 languages per user |
| organization | 40 synthetic orgs, Zipf sizes; orgPreference ∈ {same, different, none} at 10/30/60 |
| bio | 2–4 sentence free text assembled from templates whose synonym pools are keyed to latent taste dims (see below) |
| permittedFields | each user permits or withholds `experience`, `organization`, `timezone` (permission rate 80/85/90%) |

### Hidden ground truth (`src/ground-truth.ts`)

Each user gets latent factors the matcher never sees:

- `taste ∈ R^8` — drives which interests they list **and** which synonym
  pools their bio draws from, so both discrete features and embeddings carry
  partial, correlated views of the same latent structure;
- `sociability ∈ [0,1]` — response propensity;
- a per-pair irreducible preference ε ~ logistic noise.

Ground-truth utility of a pair is a fixed weighted function of latent
quantities (latent taste similarity, true interest alignment, experience
complementarity, timezone overlap, language overlap, role complementarity,
org fit) **plus** the pair noise. "Worth showing up for" = ground truth
utility at or above a threshold set so ~12–15% of viable pairs qualify.

The matcher sees only profile fields. It never sees taste, sociability, the
noise, or the ground-truth weights.

### Outcome simulator (`src/outcomes.ts`)

Given a proposed match, samples what actually happens:

- **decline** — probability falls as ground-truth utility rises and as the
  user's recent ignored-invite count rises (fatigue), modulated by
  sociability;
- **no-show** — accepted chats with low utility or big timezone pain;
- **complete** — otherwise; completion strength follows utility.

The fatigue term is deliberate: a learning matcher that proposes eagerly to
everyone can talk itself into bias. Directions that learn from outcomes must
stay accurate under it.

### Matchers under test (`src/matchers/`)

- `baseline-main.ts` — main's engine logic as of ddc94d4 (its timezone
  feature is a constant 1.0; explanations are threshold strings), so every
  win is measured against the real thing, not a caricature.
- `feature-weighted.ts` — direction (a): Sam's eight features at his stated
  weights, then locally tuned on validation seeds only.
- `embedding-first.ts` — direction (b): retrieve top-K by bio-embedding
  cosine, rerank with features.
- `learned-weights.ts` — direction (c): logistic weights trained on
  simulated outcomes with feedback-loop guards.

### Embeddings (`src/embeddings/`)

`EmbeddingProvider` interface; the local implementation runs
**all-MiniLM-L6-v2** (license Apache-2.0, model card
sentence-transformers/all-MiniLM-L6-v2) through `@huggingface/transformers`
(ONNX, in-process, no API key, no network at runtime after the one-time
model fetch). Embeddings are cached to disk per seed. A hosted provider can
be added later without touching call sites.

### Metrics and pass bars (`src/metrics.ts`)

Every bar is justified by the noise ceiling: the harness computes the best
NDCG any matcher can achieve on observables (an oracle that knows the true
data-generating weights but not the pair noise) and the bar sits below it.

| Metric | Bar | Justification |
| --- | --- | --- |
| NDCG@5 vs ground truth | ≥ noise-ceiling − 0.05, and ≥ baseline-main + stated margin | ceiling = oracle-on-observables; we must be within a sliver of what is knowable |
| Precision@5 "worth showing up" | ≥ 0.60 | base rate of qualifying pairs is ~13%; a random matcher scores ~0.13, main scores near ~0.3 in pilot runs — 0.60 demands the matcher actually find good pairs |
| Explanation faithfulness | 100% of cited top reasons are contribution-verified; removing the cited top reason must drop the score for ≥ 95% of matches | a reason is a claim about the score; leave-one-out is the only honest test |
| Stability across seeds | NDCG std ≤ 0.03; top-5 Kendall tau ≥ 0.7 | a match worth showing up for should not be a coin flip of the RNG |
| Exposure fairness | no waiting user with a viable pair starves; Gini of top-5 exposure ≤ 0.45; worst-group mean ≥ 60% of best-group | starved users churn, and the product is one-on-one coffee chats |
| Permission compliance | 100% — differential test: flipping a non-permitted field never changes a score | consent is a hard constraint, not a metric |
| Queue latency @10,000 waiting | full build ≤ 60 s on 2-core CI-class hardware; p99 per-user ≤ 100 ms | main's O(n²) per-pair action calls cannot come close; the bar must be real at fleet scale |
| Learning | held-out completion rate improves ≥ 10% relative vs static weights; partner diversity drops ≤ 10%; exposure Gini does not worsen | learning that overfits the simulator's biases or funnels everyone to the same partners is a loss, not a win |

### Seeds

Every direction runs over seeds ≥ 5 (`SEEDS = 101..105` by default). The
results committed in `out/` are the actual run outputs, regenerated by the
single command above.

## Layout

```
src/
  population.ts      seeded profile generator (distributions documented above)
  ground-truth.ts    hidden compatibility model
  outcomes.ts        accept / decline / no-show / complete simulator
  metrics.ts         all metrics + pass-bar checks
  embeddings/        provider interface + local MiniLM provider + cache
  matchers/          baseline-main, feature-weighted, embedding-first, learned-weights
  run.ts             the one command
  types.ts           shared types
out/                 committed run results
```

## What this directory must never do

No network calls at eval time (embeddings fetch their open-licensed weights
once at setup), no real people's data, no reading of `tools/call-eval/`.
