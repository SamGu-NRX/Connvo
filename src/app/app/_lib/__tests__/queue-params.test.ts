import { describe, expect, it } from "vitest";
import { normalizeQueueType } from "../queue-params";

// FROZEN ORIGINAL — copied verbatim from src/app/app/smart-connection/page.tsx
// before the extraction (the inline `queueType` derivation).
const frozenOriginalQueueType = (
  rawQueueType: string | null | undefined,
): "casual" | "professional" =>
  rawQueueType === "professional" ? "professional" : "casual";

// Everything the original page could see from `searchParams.get("type")`,
// plus edge cases. Wrong case and surrounding whitespace fall back to
// "casual" — that is the current behavior of the original inline ternary,
// and this extraction intentionally leaves it unchanged.
const cases: (string | null | undefined)[] = [
  null,
  undefined,
  "",
  "professional",
  "casual",
  "PROFESSIONAL",
  " professional",
  "professional ",
  "Pro",
];

describe("normalizeQueueType", () => {
  it("matches the frozen original for every input", () => {
    for (const input of cases) {
      expect(normalizeQueueType(input)).toBe(frozenOriginalQueueType(input));
    }
  });

  it("returns professional only for the exact value 'professional'", () => {
    expect(normalizeQueueType("professional")).toBe("professional");
  });

  it("falls back to casual for missing or empty values", () => {
    expect(normalizeQueueType(null)).toBe("casual");
    expect(normalizeQueueType(undefined)).toBe("casual");
    expect(normalizeQueueType("")).toBe("casual");
  });

  it("falls back to casual on wrong case or whitespace (current behavior, unchanged)", () => {
    expect(normalizeQueueType("PROFESSIONAL")).toBe("casual");
    expect(normalizeQueueType(" professional")).toBe("casual");
    expect(normalizeQueueType("professional ")).toBe("casual");
    expect(normalizeQueueType("Pro")).toBe("casual");
  });
});
