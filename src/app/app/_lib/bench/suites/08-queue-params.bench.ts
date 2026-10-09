/**
 * Benchmark suite for part 08-queue-params — FILLED by that part's worker.
 *
 * Convention (see src/app/app/_lib/README.md):
 *  - `before`: FROZEN copy of the original inline code, copied verbatim
 *    from the page on the base branch before editing it.
 *  - `after`: the optimized/extracted helper the page now uses.
 *  - Use benchPair() from "../harness"; medians over interleaved samples.
 */
import { benchPair } from "../harness";
import type { Suite } from "../types";
import { normalizeQueueType } from "../../queue-params";

// FROZEN ORIGINAL — copied verbatim from smart-connection/page.tsx (the
// inline `queueType` derivation) before the extraction.
const inlineTernary = (
  rawQueueType: string | null | undefined,
): "casual" | "professional" =>
  rawQueueType === "professional" ? "professional" : "casual";

const N = 100_000;

// Mixed raw `type` values spanning everything a queue URL can produce:
// both valid values, missing, empty, wrong case, and padded whitespace.
const rawValues: (string | null | undefined)[] = [];
for (let i = 0; i < N; i++) {
  switch (i % 5) {
    case 0:
      rawValues.push("professional");
      break;
    case 1:
      rawValues.push("casual");
      break;
    case 2:
      rawValues.push(null);
      break;
    case 3:
      rawValues.push("PROFESSIONAL");
      break;
    default:
      rawValues.push(" professional");
      break;
  }
}

const suite: Suite = {
  name: "08-queue-params",
  run: () => {
    benchPair({
      suite: "08-queue-params",
      name: `queue-type normalization over ${N} mixed raw values`,
      note:
        "Pure extraction of an inline ternary: ~1x is the expected result — " +
        "measured, no speed change (kept as tested extraction).",
      iterations: 20,
      before: () => {
        for (const raw of rawValues) inlineTernary(raw);
      },
      after: () => {
        for (const raw of rawValues) normalizeQueueType(raw);
      },
    });
  },
};

export default suite;
