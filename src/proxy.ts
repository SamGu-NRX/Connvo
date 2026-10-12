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
  env: { benchFlag?: string; nodeEnv?: string; vercelEnv?: string },
): boolean {
  if (env.benchFlag !== "1") return false;
  if (env.nodeEnv === "production") return false;
  if (env.vercelEnv === "production") return false;
  return pathname === BENCH_PREFIX || pathname.startsWith(`${BENCH_PREFIX}/`);
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
      nodeEnv: process.env.NODE_ENV,
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
