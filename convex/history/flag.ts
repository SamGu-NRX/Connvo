/**
 * Server-side gate for the after-call history API.
 *
 * CONNVO_AFTER_CALL is a Convex deployment env var, set in real deployments
 * with `npx convex env set CONNVO_AFTER_CALL=1`. It defaults to OFF when
 * unset, so the whole history surface is unavailable unless explicitly
 * enabled.
 *
 * Deployment note: this pairs with the CLIENT flag
 * NEXT_PUBLIC_CONNVO_AFTER_CALL (src/lib/featureFlags.ts). The client flag
 * controls UI visibility; this server flag controls API availability. Both
 * must be set together in a deployment — NEXT_PUBLIC_ vars are never visible
 * inside Convex server functions, so client-side gating alone cannot protect
 * these endpoints.
 *
 * In convex-test the functions run in-process, so tests control this via
 * process.env directly.
 */
export function isAfterCallEnabledServer(): boolean {
  return process.env.CONNVO_AFTER_CALL === "1";
}
