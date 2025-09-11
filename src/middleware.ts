import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

// Enable server-side protection for /app while keeping unauthenticated paths open.
export default authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/", "/api/auth/:path*", "/auth/:path*"],
  },
});

// Apply middleware to root, app, and api routes
export const config = {
  matcher: ["/", "/app/:path*", "/api/:path*", "/auth/:path*"],
};
