# Reconnect study — notes & meeting-lifecycle hooks

Question: what happens to unsent, unacknowledged, and re-sent note operations
and meeting lifecycle mutations across connection cuts in the real hooks?

## What is real and what is faked

- **Real, unmodified:** `src/hooks/useCollaborativeNotes.ts`,
  `src/hooks/useMeetingLifecycle.ts`, and all of `convex/`. The hooks are
  imported directly by the scenario suites and by the browser prototype.
- **Faked (experiment-owned):** only the `convex/react` transport. The fake
  client mirrors the real binding surface (`useQuery`, `useMutation`,
  `useAction`) and models: offline replay queue, lost in-flight mutations,
  late original acks, lost-ack re-sends (at-least-once, no idempotency
  keys), navigation-away client destruction, and an accepted-history ledger
  written only by the fake server.
- Optimistic state lives in the consumer exactly as the notes hook's
  documented example prescribes (set local state immediately, then
  `applyOperation`). The fake client does NOT invent client-library
  optimistic cache updates — the real note mutation declares none.

## Running it

Dev dependencies (jsdom, playwright) live OUTSIDE the repo at
`/home/user/work/connvo-testdeps` so package.json and lockfiles are
untouched. Chromium browser + system libs are already installed.

```bash
# 1) vitest scenarios (2 suites, 14 scenarios)
corepack pnpm exec vitest run --config experiments/reconnect/vitest.config.ts

# 2) manifest-driven runner: aggregates results/ into counts.json
node node_modules/.pnpm/esbuild@0.25.11/node_modules/esbuild/bin/esbuild \
  experiments/reconnect/runner.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/reconnect-runner.mjs
node /tmp/reconnect-runner.mjs           # first run (writes counts.prev.json)
node /tmp/reconnect-runner.mjs --replay  # replay check -> results/replay.json

# 3) browser prototype + Playwright walk (screenshots + states)
experiments/reconnect/prototype/build.sh
node experiments/reconnect/prototype/walk.mjs
```

## File map

- `manifest.json` — every scenario with its world and expectation
- `scenarios/notesHook.test.ts`, `scenarios/lifecycleHook.test.ts`
- `fake/fakeConvex.ts` — fake server + client; `fake/acceptedHistory.ts` —
  server-side ledger (the study's source of truth for duplicates)
- `fake/convexReactMock.ts` — `convex/react` replacement
- `env/jsdom-sibling.ts` — custom vitest environment (jsdom from the
  sibling install; avoids vitest's populateGlobal/undici crash)
- `testing/renderHook.ts` — React 19 render helper
- `runner.ts` — manifest-driven aggregation + replay check
- `prototype/` — real hooks in a real browser, driven by `walk.mjs`
- `results/` — per-scenario counts, counts.json, replay.json, walk states
  and screenshots

Findings: see `REPORT.md`.
