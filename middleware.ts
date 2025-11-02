import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  publicRoutes: [
    "/",
    "/auth/:path*",
    "/api/auth/:path*",
    "/api/convex/:path*",
  ],
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
