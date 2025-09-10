/**
 * WorkOS AuthKit Sign-In Route
 *
 * This API route initiates the sign-in flow with WorkOS AuthKit.
 * It redirects users to the appropriate authentication provider.
 *
 * Requirements: 2.1, 2.2
 * Compliance: steering/convex_rules.mdc - Uses Next.js API route patterns
 */

import { NextRequest } from "next/server";
import { handleAuth } from "@workos-inc/authkit-nextjs";

export const GET = handleAuth();
