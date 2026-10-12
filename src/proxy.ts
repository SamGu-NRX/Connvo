import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const BENCH_PREFIX = "/dev/call-bench";

/**
 * Eval-only carve-out (S0 call harness, tools/call-eval/CONTRACT.md): the dev
 * call bench is the ONLY path that may skip the WorkOS AuthKit middleware.
 * It does so only while the bench flag is on, in a non-production build
 * (`next build` sets NODE_ENV=production, so a built app never skips), and
 * outside a Vercel production deployment. The bench takes its identity from
 * the URL and its token from the local reference signaling server, so no
 * API route needs the carve-out.
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
  if (pathname === BENCH_PREFIX || pathname.startsWith(`${BENCH_PREFIX}/`)) return true;
  // The real call page in its local eval setup (bench identity, reference
  // signaling): only with BOTH flags on, only /app/call/<id>, and never on
  // any Vercel deployment. alpha gets preview deployments, and a preview is
  // not "production", so the production checks alone could expose the page
  // without sign-in if someone set the flags there.
  if (env.vercel) return false;
  if (env.realCallFlag === "1" && /^\/app\/call\/[^/]+$/.test(pathname)) return true;
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
const TEST_AUTH_PROXY_PATHS = new Set(["/dev/auth-proof", "/api/test-auth/token"]);

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
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") return false;
  return TEST_AUTH_PROXY_PATHS.has(pathname);
}

const handleAuth = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/",
      "/auth/:path*",
      "/api/auth/:path*",
      "/api/convex/:path*",
    ],
  },
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (
    benchPathPassesThrough(request.nextUrl.pathname, {
      benchFlag: process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH,
      realCallFlag: process.env.NEXT_PUBLIC_CONNVO_REAL_CALL,
      afterCallFlag: process.env.NEXT_PUBLIC_CONNVO_AFTER_CALL,
      vercel: process.env.VERCEL,
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    })
  ) {
    return NextResponse.next();
  }
  if (testAuthProxyExempt(request.nextUrl.pathname, process.env)) {
    return NextResponse.next();
  }
  return handleAuth(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
