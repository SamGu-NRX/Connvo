import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const BENCH_PREFIX = "/dev/call-bench";
// The bench page fetches call tokens from the eval-only test-auth endpoint
// (CONTRACT.md), and the bench browser has no WorkOS session — this one path
// rides the same carve-out as the bench route itself.

/**
 * Eval-only carve-out (S0 call harness, tools/call-eval/CONTRACT.md): the dev
 * call bench is the ONLY /dev path that may skip the WorkOS AuthKit
 * middleware, and only while the bench env flag is on outside production
 * (VERCEL_ENV absent, "development" or "preview"). The bench renders peers
 * from the URL query with no sign-in; everywhere else — and the bench itself
 * when the flag is off or in production — the middleware stays on.
 */
export function benchPathPassesThrough(
  pathname: string,
  env: { benchFlag?: string; vercelEnv?: string },
): boolean {
  if (env.benchFlag !== "1") return false;
  if (env.vercelEnv === "production") return false;
  return (
    pathname === BENCH_PREFIX ||
    pathname.startsWith(`${BENCH_PREFIX}/`) ||
    pathname === "/api/test-auth/token"
  );
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
      vercelEnv: process.env.VERCEL_ENV,
    })
  ) {
    return NextResponse.next();
  }
  return handleAuth(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
