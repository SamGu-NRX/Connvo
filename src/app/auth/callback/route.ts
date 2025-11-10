import { handleAuth } from "@workos-inc/authkit-nextjs";

// Always drop users onto the main app shell once WorkOS finishes auth.
export const GET = handleAuth({ returnPathname: "/app" });
