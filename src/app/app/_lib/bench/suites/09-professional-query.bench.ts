/**
 * Benchmark suite for part 09-professional-query — FILLED by that part's worker.
 *
 * Convention (see src/app/app/_lib/README.md):
 *  - `before`: FROZEN copy of the original inline code, copied verbatim
 *    from the page on the base branch before editing it.
 *  - `after`: the optimized/extracted helper the page now uses.
 *  - Use benchPair() from "../harness"; medians over interleaved samples.
 */
import { benchPair } from "../harness";
import type { Suite } from "../types";
import { buildProfessionalQueueUrl } from "../../../professional/queue-navigation";

const suite: Suite = {
  name: "09-professional-query",
  run: () => {
    // FROZEN ORIGINAL — the inline URL template from professional/page.tsx
    // handleStartQueue, verbatim: encodeURIComponent, no length caps.
    const before = (
      type: string,
      purpose: string,
      description: string,
    ): string =>
      `/app/professional/${type}?purpose=${encodeURIComponent(purpose)}&description=${encodeURIComponent(description)}`;

    const typicalPurpose = "Seeking advice on startup funding";
    const typicalDescription = "Early-stage B2B SaaS, seed round";
    const hugePurpose = "a".repeat(100_000);

    // Typical input: the builder adds two length checks on top of the same
    // encode work — expect roughly parity (~1x), reported honestly.
    benchPair({
      suite: "09-professional-query",
      name: "typical queue URL (~33-char purpose)",
      note: "typical input, purpose + description",
      iterations: 2_000,
      before: () => before("b2b", typicalPurpose, typicalDescription),
      after: () =>
        buildProfessionalQueueUrl("b2b", typicalPurpose, typicalDescription),
    });

    // Oversized input: the original encodes all 100,000 chars, the builder
    // truncates to 1,000 first — that skip is the win.
    benchPair({
      suite: "09-professional-query",
      name: "oversized 100,000-char purpose",
      note: "n=100000; before encodes 100KB, after truncates to 1,000 then encodes",
      iterations: 200,
      before: () => before("b2b", hugePurpose, ""),
      after: () => buildProfessionalQueueUrl("b2b", hugePurpose, ""),
    });
  },
};

export default suite;
