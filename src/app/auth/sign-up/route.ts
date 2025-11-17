import { getSignUpUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

/**
 * WorkOS AuthKit Sign-Up Route
 *
 * IMPORTANT: For hosted AuthKit sign-up page, do NOT pass the 'provider' parameter.
 * The hosted page allows users to choose their authentication method (email, Google, etc.)
 *
 * Passing 'provider' would skip the hosted page and go directly to that provider,
 * which causes the error: "Provider parameter not allowed for hosted AuthKit"
 *
 * Available options:
 * - organizationId: For organization-specific sign-up
 * - loginHint: Pre-fill email address
 * - redirectUri: Custom post-auth redirect
 * - state: OAuth state parameter
 *
 * For hosted AuthKit, call without options to get the default sign-up page.
 *
 * @see https://workos.com/docs/user-management/authenticate-users
 */
export const GET = async () => {
  // Get the hosted AuthKit sign-up URL without any provider/connection parameters
  // This ensures users see the hosted sign-up page with all authentication options
  const signUpUrl = await getSignUpUrl();
  
  return redirect(signUpUrl);
};