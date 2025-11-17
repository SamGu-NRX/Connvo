import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const handleAuth = authkitMiddleware({
  publicRoutes: [
    "/",
    "/auth/:path*",
    "/api/auth/:path*",
    "/api/convex/:path*",
  ],
});

export default function proxy(request: NextRequest) {
  const response = handleAuth(request);
  return response ?? NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
