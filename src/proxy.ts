import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

// CALL-PLAN.md D3 (eval-only): with NEXT_PUBLIC_CONNVO_TEST_AUTH=1 the two
// test-auth surfaces must reach their own handlers instead of being routed
// through WorkOS — the local backend's dummy WorkOS config cannot create a
// session, so the authkit redirect makes them unreachable. The exemption is
// env-gated and never applies in a production build: WorkOS middleware stays
// enabled on every /dev path in every environment (the NEXT_PUBLIC_CONNVO_
// LOCAL_BUILD marker governs the token route/adapter, not the proxy). Every
// other path, and every request without the flag, keeps the existing WorkOS
// gating.
const TEST_AUTH_PROXY_PATHS = new Set([
  "/dev/auth-proof",
  "/api/test-auth/token",
]);

export function testAuthProxyExempt(
  pathname: string,
  env: {
    NEXT_PUBLIC_CONNVO_TEST_AUTH?: string;
    VERCEL_ENV?: string;
    NODE_ENV?: string;
  },
): boolean {
  if (env.NEXT_PUBLIC_CONNVO_TEST_AUTH !== "1") return false;
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") {
    return false;
  }
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
