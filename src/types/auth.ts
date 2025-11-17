/**
 * WorkOS AuthKit Type Definitions
 * 
 * These types help enforce correct usage of WorkOS AuthKit functions
 * and prevent common mistakes like passing the 'provider' parameter
 * when using hosted AuthKit.
 */

/**
 * Options for getSignInUrl() and getSignUpUrl()
 * 
 * IMPORTANT: For hosted AuthKit, DO NOT use 'provider' or 'connection' parameters.
 * These would bypass the hosted sign-in/sign-up page and cause errors.
 * 
 * @see https://workos.com/docs/user-management/authenticate-users
 */
export interface WorkOSAuthUrlOptions {
  /**
   * Organization ID for organization-specific sign-in/sign-up
   * Users will be prompted to authenticate within this organization
   */
  organizationId?: string;

  /**
   * Pre-fill the email address field
   * Useful for returning users or specific workflows
   */
  loginHint?: string;

  /**
   * Custom redirect URI after authentication
   * Defaults to the callback route
   */
  redirectUri?: string;

  /**
   * OAuth state parameter for security
   * Automatically managed by WorkOS SDK
   */
  state?: string;

  /**
   * Prompt for user consent
   * Set to 'consent' to force re-authentication
   */
  prompt?: 'consent';
}

/**
 * ⚠️ RESTRICTED: Options that should NOT be used with hosted AuthKit
 * 
 * These options bypass the hosted sign-in page and cause the error:
 * "Provider parameter not allowed for hosted AuthKit"
 * 
 * Only use these for direct provider-specific flows (not recommended).
 */
export interface WorkOSDirectAuthOptions extends WorkOSAuthUrlOptions {
  /**
   * ⚠️ DO NOT USE with hosted AuthKit
   * 
   * Specifying a provider (e.g., 'GoogleOAuth', 'MicrosoftOAuth') skips
   * the hosted AuthKit page and goes directly to that provider.
   * 
   * This causes: "Provider parameter not allowed for hosted AuthKit"
   */
  provider?: string;

  /**
   * ⚠️ DO NOT USE with hosted AuthKit
   * 
   * Connection ID for organization-specific SSO connections.
   * Should only be used for direct SSO flows.
   */
  connection?: string;
}

/**
 * Options for handleAuth() callback handler
 */
export interface WorkOSCallbackOptions {
  /**
   * Path to redirect to after successful authentication
   * 
   * Examples:
   * - '/': Default homepage
   * - '/dashboard': User dashboard
   * - '/onboarding': New user onboarding flow
   * 
   * Default: '/'
   */
  returnPathname?: string;
}

/**
 * WorkOS User object returned from useAuth()
 */
export interface WorkOSUser {
  /** Unique user identifier */
  id: string;

  /** User's email address */
  email: string;

  /** User's first name (if provided) */
  firstName?: string;

  /** User's last name (if provided) */
  lastName?: string;

  /** URL to user's profile picture */
  profilePictureUrl?: string;

  /** Organization ID (if user belongs to an organization) */
  organizationId?: string;

  /** User's role within the organization */
  role?: string;

  /** When the user was created */
  createdAt?: string;

  /** When the user was last updated */
  updatedAt?: string;
}

/**
 * Authentication state from useAuth() hook
 */
export interface WorkOSAuthState {
  /** Whether authentication state is loading */
  loading: boolean;

  /** Whether user is authenticated */
  isAuthenticated: boolean;

  /** Authenticated user object (null if not authenticated) */
  user: WorkOSUser | null;

  /** Access token for API requests */
  accessToken: string | null;

  /** Organization ID (if applicable) */
  organizationId?: string;

  /** User's role (if applicable) */
  role?: string;
}

/**
 * Type guard to check if user is authenticated
 */
export function isAuthenticated(
  state: WorkOSAuthState
): state is WorkOSAuthState & { user: WorkOSUser; accessToken: string } {
  return state.isAuthenticated && state.user !== null && state.accessToken !== null;
}

/**
 * Helper type for auth route handlers
 */
export type AuthRouteHandler = () => Promise<Response>;

/**
 * Environment variables required for WorkOS AuthKit
 */
export interface WorkOSEnvironment {
  /** WorkOS API Key (starts with 'sk_test_' or 'sk_live_') */
  WORKOS_API_KEY: string;

  /** WorkOS Client ID (starts with 'client_') */
  WORKOS_CLIENT_ID: string;

  /** Cookie encryption password (min 32 characters) */
  WORKOS_COOKIE_PASSWORD: string;

  /** Optional: Redirect URI for auth callback */
  WORKOS_REDIRECT_URI?: string;

  /**
   * ⚠️ DO NOT SET for hosted AuthKit
   * These would cause provider parameter errors
   */
  WORKOS_CONNECTION_ID?: never;
  WORKOS_DEFAULT_PROVIDER?: never;
}