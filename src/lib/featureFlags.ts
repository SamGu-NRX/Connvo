/**
 * Feature flags for candidate capabilities.
 *
 * The after-call surfaces (meeting history, recap, calendar export,
 * stay in touch) are candidates Sam has not confirmed yet, so every part
 * of them ships behind NEXT_PUBLIC_CONNVO_AFTER_CALL and is invisible
 * unless that env var is exactly "1".
 */
export function isAfterCallEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CONNVO_AFTER_CALL === "1";
}
