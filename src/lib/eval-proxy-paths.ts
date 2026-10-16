const BENCH_PREFIX = "/dev/call-bench";

/** Local eval paths share the same middleware and client-provider exemption.
 * A production build never bypasses WorkOS. The real call and history routes
 * additionally refuse every Vercel deployment, including previews.
 */
export function benchPathPassesThrough(
  pathname: string,
  env: {
    benchFlag?: string;
    realCallFlag?: string;
    afterCallFlag?: string;
    nodeEnv?: string;
    vercelEnv?: string;
    /** Vercel sets VERCEL=1 on every deployment, preview included. */
    vercel?: string;
  },
): boolean {
  if (env.benchFlag !== "1") return false;
  if (env.nodeEnv === "production") return false;
  if (env.vercelEnv === "production") return false;
  if (pathname === BENCH_PREFIX || pathname.startsWith(`${BENCH_PREFIX}/`))
    return true;
  // The real call page in its local eval setup (bench identity, reference
  // signaling): only with BOTH flags on, only /app/call/<id>, and never on
  // any Vercel deployment. alpha gets preview deployments, and a preview is
  // not "production", so the production checks alone could expose the page
  // without sign-in if someone set the flags there.
  if (env.vercel) return false;
  if (env.realCallFlag === "1" && /^\/app\/call\/[^/]+$/.test(pathname))
    return true;
  // The after-call pages in the same local eval setup (all three flags on):
  // the harness reaches them signed in with the test identities, which the
  // dummy WorkOS config cannot do. Their data is guarded by Convex itself.
  return (
    env.realCallFlag === "1" &&
    env.afterCallFlag === "1" &&
    /^\/app\/meetings(\/[^/]+)?$/.test(pathname)
  );
}

// CALL-PLAN.md D3 (eval-only): with NEXT_PUBLIC_CONNVO_TEST_AUTH=1 the two
// test-auth surfaces reach their own handlers instead of WorkOS, because the
// local backend's dummy WorkOS config cannot create a session. Never in a
// production build, never on any Vercel deployment (previews included), and
// only these exact paths; every other request keeps WorkOS.
const TEST_AUTH_PROXY_PATHS = new Set([
  "/dev/auth-proof",
  "/api/test-auth/token",
  // Queue-to-call proofs use the same local identities as the call harness.
  "/app/match-queue",
  // The home page is the cv6-proposal-ui verification surface (proposal card,
  // upcoming chat, calm matcher state); its data is guarded by Convex.
  "/app",
  // The Your network page is an after-call surface reached with harness
  // identities (cv6-connect-network); its Convex auth is the test adapter.
  "/app/dashboard",
  // Onboarding (with its availability step), Settings (matching preferences
  // and weekly availability) and Profile, so a local walk can reach the
  // screens that write chat preferences; their data is guarded by Convex.
  "/onboarding",
  "/app/settings",
  "/app/profile",
  "/app/smart-connection",
  "/app/professional/b2b",
  "/app/professional/collaboration",
  "/app/professional/mentorship",
  "/app/professional/investment",
]);

export function testAuthProxyExempt(
  pathname: string,
  env: {
    NEXT_PUBLIC_CONNVO_TEST_AUTH?: string;
    VERCEL_ENV?: string;
    VERCEL?: string;
    NODE_ENV?: string;
  },
): boolean {
  if (env.NEXT_PUBLIC_CONNVO_TEST_AUTH !== "1") return false;
  if (env.VERCEL) return false;
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production")
    return false;
  return TEST_AUTH_PROXY_PATHS.has(pathname);
}
