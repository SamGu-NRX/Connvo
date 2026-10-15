import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { isPublicCallAsset } from "@/lib/call/public-assets";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

import {
  benchPathPassesThrough,
  testAuthProxyExempt,
} from "@/lib/eval-proxy-paths";
export {
  benchPathPassesThrough,
  testAuthProxyExempt,
} from "@/lib/eval-proxy-paths";

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
  if (isPublicCallAsset(request.nextUrl.pathname)) return NextResponse.next();
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
