/**
 * WorkOS AuthKit Sign-Out Route
 *
 * This API route handles user sign-out and session termination.
 * It clears the authentication session and redirects appropriately.
 *
 * Requirements: 2.1, 2.2
 * Compliance: steering/convex_rules.mdc - Uses Next.js API route patterns
 */

import { NextRequest } from "next/server";
import { handleAuth } from "@workos-inc/authkit-nextjs";

export const GET = handleAuth();
