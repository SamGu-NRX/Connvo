"use client";

import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { useConvexAuth } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useEffect } from "react";
import { useTestAuth } from "@/lib/test-auth";

// CALL-PLAN.md D3: with NEXT_PUBLIC_CONNVO_TEST_AUTH=1 the Convex client already
// authenticates through the test adapter (ConvexClientProvider), and the
// proxy-exempt pages render without AuthKitProvider, so AuthKit's useAuth would
// throw. The flag is a build-time constant, so each build calls one hook pair.
const TEST_AUTH_ENABLED = process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH === "1";

function useAuthKitIdentity() {
  const { user, loading: authLoading } = useAuth();
  const { accessToken, loading: tokenLoading } = useAccessToken();
  return { user, authLoading, accessToken, tokenLoading };
}

function useTestIdentity() {
  const { user, isLoading } = useTestAuth();
  return {
    user: user ? { id: user.id, email: user.email, firstName: user.name } : null,
    authLoading: isLoading,
    accessToken: user ? "connvo-local-test" : undefined,
    tokenLoading: isLoading,
  };
}

const useIdentity = TEST_AUTH_ENABLED ? useTestIdentity : useAuthKitIdentity;

export interface WorkOSUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profilePictureUrl?: string;
  organizationId?: string;
  role?: string;
}

export function useWorkOSAuth() {
  const { user, authLoading, accessToken, tokenLoading } = useIdentity();
  const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } =
    useConvexAuth();

  const loading = authLoading || tokenLoading || convexLoading;
  
  // Use WorkOS auth state directly - token presence indicates authentication
  const hasWorkOSAuth = !!user && !!accessToken && !authLoading && !tokenLoading;
  const isAuthenticated = hasWorkOSAuth;

  // Query Convex user - always try if we have WorkOS auth
  // Don't wait for convexAuthenticated as it may lag behind
  const convexUser = useQuery(
    api.users.queries.getCurrentUser,
    hasWorkOSAuth ? {} : undefined,
  );

  // Debug logging - track authentication state
  useEffect(() => {
    console.log('[useWorkOSAuth] Auth State:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length,
      authLoading,
      tokenLoading,
      convexLoading,
      convexAuthenticated,
      isAuthenticated,
      hasConvexUser: !!convexUser,
      convexUserId: convexUser?._id,
    });
  }, [user, accessToken, authLoading, tokenLoading, convexLoading, convexAuthenticated, isAuthenticated, convexUser]);

  // NOTE: User sync is handled by ConvexClientProvider's UpsertUserOnAuth component
  // We don't duplicate it here to avoid race conditions

  return {
    // Authentication state
    loading,
    isAuthenticated,

    // WorkOS user data
    user: user as unknown as WorkOSUser | null,
    accessToken,

    // Convex user data
    convexUser,

    // Organization info
    organizationId: (user as Partial<WorkOSUser>)?.organizationId,
    role: (user as Partial<WorkOSUser>)?.role,
  };
}
