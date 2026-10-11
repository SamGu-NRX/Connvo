import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

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

/**
 * The /dev/notes-preview demo route bypasses sign-in ONLY under the local
 * bench conditions: the bench flag is on and this is not a production
 * deployment. Every other /dev path — and every /dev path in production —
 * runs the WorkOS middleware normally. The matcher below keeps middleware
 * enabled on all /dev paths; this gate is the only bypass.
 */
function isBenchPreview(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  if (pathname !== "/dev/notes-preview" && !pathname.startsWith("/dev/notes-preview/")) {
    return false;
  }
  return (
    process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH === "1" &&
    process.env.VERCEL_ENV !== "production"
  );
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isBenchPreview(request)) {
    return NextResponse.next();
  }
  return handleAuth(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
