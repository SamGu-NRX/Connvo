/**
 * Benchmark suite for part 11-home-layout.
 *
 * Hot path: the home page CTA URL build, previously inline in
 * `src/app/app/page.tsx` (handleStartQueue), now extracted to
 * `_lib/navigation-urls.ts` (smartConnectionUrl).
 *
 * Expected result: ~1x. The extraction is a pure string-building move, not
 * an algorithmic change — measured, no speed change expected; kept as a
 * tested extraction. Protocol: see `src/app/app/_lib/README.md`.
 */
import { benchPair } from "../harness";
import type { Suite } from "../types";
import { smartConnectionUrl } from "../../navigation-urls";

const suite: Suite = {
  name: "11-home-layout",
  run: () => {
    const queueTypes = ["casual", "professional"] as const;

    // FROZEN ORIGINAL — was inline in src/app/app/page.tsx
    // (handleStartQueue), copied verbatim before the extraction.
    const originalSmartConnectionUrl = (
      queueType: "casual" | "professional",
    ): string => `/app/smart-connection?type=${queueType}`;

    benchPair({
      suite: "11-home-layout",
      name: "smart-connection URL build (casual/professional)",
      note: "measured, no speed change expected; kept as tested extraction",
      iterations: 100_000,
      before: () => {
        for (const queueType of queueTypes) {
          originalSmartConnectionUrl(queueType);
        }
      },
      after: () => {
        for (const queueType of queueTypes) smartConnectionUrl(queueType);
      },
    });
  },
};

export default suite;
