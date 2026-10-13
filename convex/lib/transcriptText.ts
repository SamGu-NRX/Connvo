/**
 * Transcript text join utilities
 *
 * Shared by transcript coalescing (ingestion) and aggregation, which merge
 * consecutive same-speaker chunks into a single text blob.
 */

/**
 * Joins two transcript text fragments with exactly one space, normalizing any
 * boundary whitespace either side already carries. Prevents double spaces like
 * "Hello  world" when merging same-speaker chunks whose texts are not trimmed.
 *
 * @example
 * joinTranscriptText("Hello", "world") // "Hello world"
 * joinTranscriptText("Hello ", "world") // "Hello world"
 * joinTranscriptText("Hello", " world") // "Hello world"
 * joinTranscriptText("Hello ", " world") // "Hello world"
 */
export function joinTranscriptText(left: string, right: string): string {
  const trimmedLeft = left.replace(/\s+$/, "");
  const trimmedRight = right.replace(/^\s+/, "");
  if (!trimmedLeft) return right;
  if (!trimmedRight) return left;
  return `${trimmedLeft} ${trimmedRight}`;
}
