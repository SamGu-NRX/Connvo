/**
 * Bound URL building for the professional connection queue form.
 *
 * The page previously interpolated raw user input straight into the URL, so
 * a 100KB purpose produced a 100KB+ URL handed to `router.push`. These
 * helpers cap input length before encoding. For inputs within the caps the
 * output is byte-identical to the original inline template.
 */

/** The four connection types offered by the professional page. */
export type ProfessionalConnectionType =
  | "b2b"
  | "collaboration"
  | "mentorship"
  | "investment";

/** Maximum input length (UTF-16 code units) of the purpose, before encoding. */
export const MAX_PURPOSE_LENGTH = 1_000;

/** Maximum input length (UTF-16 code units) of the description, before encoding. */
export const MAX_DESCRIPTION_LENGTH = 2_000;

/**
 * Truncate `value` to at most `cap` UTF-16 code units without splitting a
 * surrogate pair at the cut.
 *
 * Chosen approach: boundary check — inspect the last code unit of the cut
 * and back off one unit when it is a high surrogate (the start of a pair
 * whose low half would land outside the slice). The alternative, slicing
 * over code points via `Array.from(value).slice(0, cap).join("")`, was
 * rejected because it materializes an O(n) array for oversized inputs —
 * exactly the pathological case this fix targets. The boundary check is
 * O(1) beyond the slice itself.
 */
function truncateWithoutSplittingSurrogatePair(
  value: string,
  cap: number,
): string {
  if (value.length <= cap) return value;
  const boundary = value.charCodeAt(cap - 1);
  const backOff = boundary >= 0xd800 && boundary <= 0xdbff ? 1 : 0;
  return value.slice(0, cap - backOff);
}

/**
 * Build the queue URL for the professional connection form.
 *
 * For inputs within the length caps the output is byte-identical to the
 * original inline template in professional/page.tsx (same encoding via
 * `encodeURIComponent`, both query params in the same order):
 *
 *   `/app/professional/${type}?purpose=${encodeURIComponent(purpose)}&description=${encodeURIComponent(description)}`
 *
 * Oversized inputs are truncated to their cap BEFORE encoding; the cut
 * never splits a surrogate pair.
 */
export function buildProfessionalQueueUrl(
  type: ProfessionalConnectionType,
  purpose: string,
  description: string,
): string {
  const cappedPurpose = truncateWithoutSplittingSurrogatePair(
    purpose,
    MAX_PURPOSE_LENGTH,
  );
  const cappedDescription = truncateWithoutSplittingSurrogatePair(
    description,
    MAX_DESCRIPTION_LENGTH,
  );
  return `/app/professional/${type}?purpose=${encodeURIComponent(cappedPurpose)}&description=${encodeURIComponent(cappedDescription)}`;
}
