import { describe, expect, it } from "vitest";
import {
  buildProfessionalQueueUrl,
  MAX_DESCRIPTION_LENGTH,
  MAX_PURPOSE_LENGTH,
  type ProfessionalConnectionType,
} from "../queue-navigation";

// FROZEN ORIGINAL — copied verbatim from professional/page.tsx
// (handleStartQueue) before the change: the URL was built inline with
// encodeURIComponent and completely unbounded user input.
const originalBuildQueueUrl = (
  type: string,
  purpose: string,
  description: string,
): string =>
  `/app/professional/${type}?purpose=${encodeURIComponent(purpose)}&description=${encodeURIComponent(description)}`;

const TYPES: ProfessionalConnectionType[] = [
  "b2b",
  "collaboration",
  "mentorship",
  "investment",
];

/** Pull the decoded `purpose` query param back out of a built URL. */
function purposeParamOf(url: string): string {
  const start = url.indexOf("purpose=") + "purpose=".length;
  const end = url.indexOf("&description=");
  return decodeURIComponent(url.slice(start, end));
}

describe("buildProfessionalQueueUrl — equivalence with the original", () => {
  const cases: Array<[ProfessionalConnectionType, string, string]> = [
    ["b2b", "", ""],
    ["b2b", "Seeking advice on startup funding", "Early-stage SaaS team"],
    ["mentorship", "need a mentor", ""],
    ["investment", "pitch & demo day prep", "R&D heavy product — 100% remote"],
    ["collaboration", "a=b?c=d#e", "spaces   and    tabs"],
    ["investment", "already%20encoded%20text", "100% done !~*'()"],
    ["b2b", "café résumé", "naïve coöperation"],
    ["collaboration", "中文查询", "日本語の説明"],
    ["mentorship", "شكرا", "שלום"],
    ["b2b", "rocket 🚀 launch", "family 👨‍👩‍👧‍👦 plan"],
    ["investment", `quote's "tricky" <tags>`, "slash/backslash\\pipe|"],
  ];

  it("is byte-identical to the original for inputs within the caps", () => {
    for (const [type, purpose, description] of cases) {
      expect(buildProfessionalQueueUrl(type, purpose, description)).toBe(
        originalBuildQueueUrl(type, purpose, description),
      );
    }
  });

  it("is byte-identical for every connection type", () => {
    for (const type of TYPES) {
      expect(buildProfessionalQueueUrl(type, "weekly sync", "intro call")).toBe(
        originalBuildQueueUrl(type, "weekly sync", "intro call"),
      );
    }
  });

  it("is byte-identical at exactly the caps", () => {
    const purposeAtCap = "p".repeat(MAX_PURPOSE_LENGTH);
    const descriptionAtCap = "d".repeat(MAX_DESCRIPTION_LENGTH);
    expect(
      buildProfessionalQueueUrl("b2b", purposeAtCap, descriptionAtCap),
    ).toBe(originalBuildQueueUrl("b2b", purposeAtCap, descriptionAtCap));
  });

  it("is byte-identical with an emoji ending exactly at the cap", () => {
    // 998 x's + a 2-code-unit emoji = exactly MAX_PURPOSE_LENGTH code units.
    const purpose = `${"x".repeat(MAX_PURPOSE_LENGTH - 2)}🚀`;
    expect(purpose.length).toBe(MAX_PURPOSE_LENGTH);
    expect(buildProfessionalQueueUrl("b2b", purpose, "")).toBe(
      originalBuildQueueUrl("b2b", purpose, ""),
    );
  });
});

describe("fail-first: oversized inputs (original ships them in full)", () => {
  it("caps a 100,000-char purpose that the original URL ships in full", () => {
    const huge = "a".repeat(100_000);

    // Original behavior: the URL exceeds 100KB. This assertion documents
    // the bug — run against the original builder, the cap assertions below
    // fail.
    const originalUrl = originalBuildQueueUrl("b2b", huge, "");
    expect(originalUrl.length).toBeGreaterThan(100_000);

    // Fixed behavior: purpose truncated to MAX_PURPOSE_LENGTH before encoding.
    const built = buildProfessionalQueueUrl("b2b", huge, "");
    expect(built).not.toBe(originalUrl);

    // Worst case encoding is 9 chars per code unit (a lone surrogate
    // encodes as U+FFFD = 3 UTF-8 bytes = %XX%XX%XX), so the built URL is
    // bounded by the scaffolding plus 9 × cap.
    const scaffold =
      "/app/professional/b2b?purpose=".length + "&description=".length;
    expect(built.length).toBeLessThanOrEqual(scaffold + MAX_PURPOSE_LENGTH * 9);

    // Both query params are still present, in the original order.
    const purposeStart = built.indexOf("purpose=");
    const descriptionStart = built.indexOf("&description=");
    expect(purposeStart).toBeGreaterThan(0);
    expect(descriptionStart).toBeGreaterThan(purposeStart);
  });

  it("caps a 100,000-char description", () => {
    const huge = "d".repeat(100_000);
    const built = buildProfessionalQueueUrl("investment", "", huge);
    const scaffold =
      "/app/professional/investment?purpose=".length + "&description=".length;
    expect(built.length).toBeLessThanOrEqual(
      scaffold + MAX_DESCRIPTION_LENGTH * 9,
    );
    // The purpose param is still present before the description param.
    expect(built.startsWith("/app/professional/investment?purpose=")).toBe(
      true,
    );
    expect(built).toContain("&description=");
  });

  it("truncates without splitting a surrogate pair", () => {
    // 999 x's push an emoji across the MAX_PURPOSE_LENGTH cut.
    const filler = "x".repeat(MAX_PURPOSE_LENGTH - 1);
    const purpose = `${filler}🚀${"y".repeat(100)}`;
    const built = buildProfessionalQueueUrl("mentorship", purpose, "");
    const purposeParam = purposeParamOf(built);
    // The emoji is dropped whole (the cut backs off one code unit), never
    // halved into a lone surrogate.
    expect(purposeParam).toBe(filler);
    expect(purposeParam.length).toBe(MAX_PURPOSE_LENGTH - 1);
  });

  it("truncates the description without splitting a surrogate pair", () => {
    const filler = "d".repeat(MAX_DESCRIPTION_LENGTH - 1);
    const description = `${filler}👨‍👩‍👧‍👦tail`;
    const built = buildProfessionalQueueUrl("b2b", "", description);
    const start = built.indexOf("&description=") + "&description=".length;
    const descriptionParam = decodeURIComponent(built.slice(start));
    expect(descriptionParam).toBe(filler);
  });
});
