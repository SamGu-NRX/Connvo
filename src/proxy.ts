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
    // `dev` routes are excluded: the /dev/notes-preview demo route mounts an
    // in-memory backend and has no auth surface, and the WorkOS middleware
    // cannot complete its handshake from a sandboxed local environment.
    // Production behavior is unchanged — the demo page itself refuses to
    // render outside development (see src/app/dev/notes-preview/page.tsx).
    "/((?!_next/static|_next/image|_next/data|favicon.ico|dev(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
