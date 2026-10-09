/**
 * Shared URL builders for navigation targets under `/app`.
 *
 * Extracted from inline template literals in `src/app/app/page.tsx` so the
 * home page CTA targets are testable and benchmarkable (protocol:
 * `_lib/README.md`). Pure string building — no router, no validation.
 */

/**
 * Builds the smart-connection queue URL: `/app/smart-connection?type=<type>`.
 *
 * FROZEN ORIGINAL behavior: the home page previously built this inline as
 * `` `/app/smart-connection?type=${queueType}` ``. Concatenation with `+`
 * stringifies the operand exactly like a template literal, so the helper is
 * total — any string input returns the same result the original produced.
 */
export function smartConnectionUrl(
  queueType: "casual" | "professional",
): string {
  return "/app/smart-connection?type=" + queueType;
}
