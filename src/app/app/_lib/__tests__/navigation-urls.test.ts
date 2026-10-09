import { describe, expect, it } from "vitest";
import { smartConnectionUrl } from "../navigation-urls";

// FROZEN ORIGINAL — copied verbatim from src/app/app/page.tsx
// (handleStartQueue) before the extraction:
//   router.push(`/app/smart-connection?type=${queueType}`);
const originalSmartConnectionUrl = (queueType: string): string =>
  `/app/smart-connection?type=${queueType}`;

describe("smartConnectionUrl", () => {
  it("matches the original for both queue types", () => {
    for (const queueType of ["casual", "professional"] as const) {
      expect(smartConnectionUrl(queueType)).toBe(
        originalSmartConnectionUrl(queueType),
      );
    }
  });

  it("returns the exact expected URLs", () => {
    expect(smartConnectionUrl("casual")).toBe(
      "/app/smart-connection?type=casual",
    );
    expect(smartConnectionUrl("professional")).toBe(
      "/app/smart-connection?type=professional",
    );
  });

  it("is total — any string input matches the original template result", () => {
    // The helper performs no validation, so out-of-contract string inputs
    // must still concatenate exactly like the original template literal.
    const inputs = [
      "",
      "casual",
      "Casual",
      " casual",
      "casual ",
      "a b",
      "a&b=1#frag",
      "%20",
      "0",
      "100",
      "null",
      "undefined",
      "café",
      "Queue 🎉",
      "<script>alert(1)</script>",
    ];
    for (const input of inputs) {
      expect(smartConnectionUrl(input as "casual" | "professional")).toBe(
        originalSmartConnectionUrl(input),
      );
    }
  });
});
