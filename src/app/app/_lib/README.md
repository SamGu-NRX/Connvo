# `src/app/app/_lib` — shared helpers, benchmark harness, and protocol

This folder is a Next.js **private folder** (leading underscore): it is never
routed. It holds pure, testable logic extracted from the pages in
`src/app/app/`, plus the benchmark harness that measures hot paths.

## Why

The pages in `src/app/app/` used to compute everything inline on every
render: display-name fallback chains, initials, avatar view models, error
classification, URL building. To optimize those paths *without changing
behavior*, each piece of logic is extracted into a pure helper that is:

1. **Equivalence-tested** — every helper is tested against a frozen copy of
   the original inline code (`// FROZEN ORIGINAL` in the test file) across
   normal and edge-case inputs, so output is provably unchanged.
2. **Benchmarked** — a suite under `bench/suites/` measures the frozen
   original against the optimized helper on the same machine.

## Running the benchmarks

```bash
npm run bench:app            # human-readable table + load average
npm run bench:app -- --json  # machine-readable JSON
```

Each suite measures a before/after pair interleaved, takes the median over
repeated samples, and the runner prints the machine load average
(`os.loadavg()`) at start and end. Benchmark code is never imported by
pages; it only runs through this command.

## Adding a suite

1. Create `bench/suites/<part>.bench.ts` exporting a default `Suite`.
2. Fill in the pre-created stub for your part (each part owns exactly one
   stub file; the runner already imports every stub).
3. Use `benchPair({ suite, name, before, after, iterations, samples, note })`
   from `../harness`. `before` must be a FROZEN verbatim copy of the original
   inline code; `after` is the helper the page now uses.

Sketch:

```ts
import { benchPair } from "../harness";
import type { Suite } from "../types";
import { initialsFromName } from "../../profile/identity";

const suite: Suite = {
  name: "02-profile-helpers",
  run: () => {
    const names = ["Ada Lovelace", "Grace B. Hopper", "Yi", "  "];
    const before = (n: string): string =>
      // FROZEN ORIGINAL — was inline in profile/page.tsx
      n.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
    benchPair({
      suite: "02-profile-helpers",
      name: "initials for 100 names",
      note: "n=100",
      iterations: 2_000,
      before: () => {
        for (const n of names) before(n);
      },
      after: () => {
        for (const n of names) initialsFromName(n);
      },
    });
  },
};

export default suite;
```

## Equivalence tests

Tests live next to the code they cover, e.g.
`src/app/app/profile/__tests__/identity.test.ts`, and run in the vitest
`frontend` project (`src/**/*.test.ts`, jsdom environment).

The pattern that proves behavior did not change:

```ts
// FROZEN ORIGINAL — copied verbatim from profile/page.tsx before the change
const originalDisplayName = (...) => ...;

it("matches the original for every input", () => {
  for (const input of cases) {
    expect(resolveDisplayName(input)).toBe(originalDisplayName(input));
  }
});
```

## Robustness fixes: fail-first rule

Every robustness fix (timeouts, retries, oversized input, malformed input,
concurrent calls) ships with a test that **fails against the original
behavior and passes with the fix**. The fix intentionally changes behavior
only for pathological inputs; normal-path behavior stays identical
(covered by the equivalence tests above).

## Layout

```
_lib/
  bench/
    types.ts        # BenchMeasurement, Suite
    harness.ts      # benchPair, medians, keepAlive, machineInfo
    run-bench.ts    # one-command runner (npm run bench:app)
    suites/         # one file per part; filled by that part's worker
```
