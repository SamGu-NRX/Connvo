import { handleAuth } from '@workos-inc/authkit-nextjs';

/**
 * WorkOS AuthKit Callback Handler
 *
 * This route is called by WorkOS after successful authentication.
 * It processes the auth code, creates a session, and redirects the user.
 *
 * Default behavior: Redirects to '/' after sign in
 * Custom redirect: Pass { returnPathname: '/dashboard' } to change destination
 *
 * The callback handles:
 * - OAuth code exchange
 * - Session cookie creation
 * - User information retrieval
 * - Redirect to application
 *
 * Error handling:
 * - Invalid auth codes are rejected
 * - Expired codes trigger re-authentication
 * - Network errors are logged and displayed to users
 *
 * @see https://workos.com/docs/user-management/nextjs/callback
 */
export const GET = handleAuth({
  // Redirect authenticated users to the app dashboard after sign-in/sign-up
  returnPathname: '/app',
});
