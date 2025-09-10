/**
 * WorkOS AuthKit Callback Route
 *
 * This API route handles the OAuth callback from WorkOS AuthKit.
 * It processes the authentication response and establishes the user session.
 *
 * Requirements: 2.1, 2.2
 * Compliance: steering/convex_rules.mdc - Uses Next.js API route patterns
 */

import { NextRequest } from "next/server";
import { handleAuth } from "@workos-inc/authkit-nextjs";

export const GET = handleAuth();
