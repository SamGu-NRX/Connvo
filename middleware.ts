import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const middlewareInstance = authkitMiddleware({
  publicRoutes: [
    "/",
    "/auth/:path*",
    "/api/auth/:path*",
    "/api/convex/:path*",
  ],
});

export const middleware = middlewareInstance;
export default middlewareInstance;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
