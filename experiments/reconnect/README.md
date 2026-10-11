# Reconnect study — notes & meeting-lifecycle hooks

Question: what happens to unsent, unacknowledged, and re-sent note operations
and meeting lifecycle mutations across connection cuts in the real hooks?

## The two layers (read this before citing any claim)

Every claim in this study carries one of two labels:

- **[simulated-transport]** — the REAL hooks are driven over an
  experiment-owned fake Convex client (`fake/fakeConvex.ts`). The fake
  models at-least-once delivery (lost acks → re-sends). These scenarios
  show what the HOOKS and their consumers do when messages repeat; they do
  NOT establish what the production Convex handlers do with a duplicate.
- **[production-handler]** — the REGISTERED production Convex handlers
  (`convex/notes/mutations.ts`, `convex/notes/offline.ts`,
  `convex/meetings/lifecycle.ts`, and the GetStream
  `convex/meetings/stream/streamHandlers.ts:dispatchWebhook`) are invoked
  directly through `convex-test` against the real schema, real validators,
  and real auth guards. Each operation is delivered TWICE and the recorded
  verdict (accepted / rejected / deduped + resulting server state) is what
  the handler actually did — nothing about the production verdicts is
  scripted in the fake. Two complementary production suites cover this
  layer: `scenarios/productionHandlers.test.ts` (9 scenarios, per-scenario
  receipts under `results/vitest/production-*.json`) and
  `production-handlers.ts` (6 observations pinned by
  `production-handlers.test.ts`, receipt
  `results/production-handlers.json`); both are merged into
  `results/productionHandlers.json`, and they agree on every overlapping
  verdict.

Known harness limit (recorded in the receipts, not hidden):
`convex-test` 0.0.38 does not propagate caller identity into nested
`ctx.runMutation` (get-convex/convex-test#50, open), so
`retryFailedOperations`' nested sync leg rejects UNAUTHORIZED under the
harness and the transaction rolls back; production Convex propagates caller
identity, so that leg is a harness artifact, and the scenario says so.

## What is real and what is faked

- **Real, unmodified:** `src/hooks/useCollaborativeNotes.ts`,
  `src/hooks/useMeetingLifecycle.ts`, and all of `convex/`. The hooks are
  imported directly by the scenario suites and by the browser prototype.
- **Faked (experiment-owned):** only the `convex/react` transport in the
  [simulated-transport] layer. The fake client mirrors the real binding
  surface (`useQuery`, `useMutation`, `useAction`) and models: offline
  replay queue, lost in-flight mutations, late original acks, lost-ack
  re-sends (at-least-once, no idempotency keys), navigation-away client
  destruction, and an accepted-history ledger written only by the fake
  server. In the [production-handler] layer the fake transport is not
  involved at all — convex-test runs the registered handlers.
- Optimistic state lives in the consumer exactly as the notes hook's
  documented example prescribes (set local state immediately, then
  `applyOperation`). The fake client does NOT invent client-library
  optimistic cache updates — the real note mutation declares none.

## Running it

Dev dependencies (jsdom, playwright) live OUTSIDE the repo at
`/home/user/work/connvo-testdeps` so package.json and lockfiles are
untouched. Chromium browser + system libs are already installed.

```bash
# Everything (production-handler receipts + all vitest suites + browser walk):
corepack pnpm exec tsx experiments/reconnect/run.ts

# Or section by section:
corepack pnpm exec tsx experiments/reconnect/run.ts --section=handlers  # [production-handler] script receipts
corepack pnpm exec tsx experiments/reconnect/run.ts --section=vitest    # all suites + aggregation
corepack pnpm exec tsx experiments/reconnect/run.ts --section=walk      # keyboard walk (reduced motion)
corepack pnpm exec tsx experiments/reconnect/run.ts --replay            # + determinism check
#    The vitest section aggregates results/counts.json (every scenario
#    tagged [simulated-transport] or [production-handler]) and
#    results/productionHandlers.json (observed verdicts, both production
#    suites merged); --replay diffs the fresh counts against
#    results/counts.prev.json into results/replay.json.

# The pieces, individually, if you prefer not to use the entry point:
corepack pnpm exec vitest run --config experiments/reconnect/vitest.config.ts

experiments/reconnect/prototype/build.sh
node experiments/reconnect/prototype/walk.mjs   # zero mouse input; reducedMotion: 'reduce'
```

## File map

- `manifest.json` — every scenario (both layers) with its layer, world, and
  expectation
- `scenarios/notesHook.test.ts`, `scenarios/lifecycleHook.test.ts` —
  [simulated-transport] suites (14 scenarios)
- `scenarios/productionHandlers.test.ts` — [production-handler] suite
  (9 scenarios; convex-test against the registered handlers)
- `production-handlers.ts` — standalone [production-handler] script (6
  duplicate-delivery observations, incl. the GetStream webhook redelivery);
  `production-handlers.test.ts` pins them
- `fake/fakeConvex.ts` — fake server + client; `fake/acceptedHistory.ts` —
  server-side ledger (the simulated layer's source of truth for duplicates)
- `fake/convexReactMock.ts` — `convex/react` replacement
- `env/jsdom-sibling.ts` — custom vitest environment (jsdom from the
  sibling install; avoids vitest's populateGlobal/undici crash)
- `testing/renderHook.ts` — React 19 render helper
- `run.ts` — entry point: runs handlers / vitest / walk sections, aggregates
  counts.json + productionHandlers.json, `--replay` determinism check
  (replaces runner.ts)
- `prototype/` — real hooks in a real browser, driven by `walk.mjs`
  (keyboard-only, reduced-motion)
- `HANDOFF.md` — round handoff: what's new, gotchas, verify commands
- `results/` — per-scenario receipts (`vitest/`), counts.json,
  productionHandlers.json, production-handlers.json, replay.json, walk
  states + screenshots

Findings: see `REPORT.md`.
