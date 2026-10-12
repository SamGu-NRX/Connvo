import type { NextFetchEvent, NextRequest } from "next/server";
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

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return handleAuth(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
