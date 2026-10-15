"use client";

import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { useConvexAuth } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useEffect } from "react";
import {
  TEST_AUTH_ENABLED,
  testAuthUserParam,
  useTestAuthState,
} from "@/lib/test-auth";

/* eslint-disable react-hooks/rules-of-hooks -- the TEST_AUTH_ENABLED branch is
 * selected by a build-constant env flag (NEXT_PUBLIC_CONNVO_TEST_AUTH), so hook
 * order is stable for any given build; each branch is unreachable in the other
 * mode, and the WorkOS branch keeps its pre-adapter shape. */

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
  // Test-auth paths (/onboarding, /app under the eval harness) skip the
  // AuthKitProvider entirely, so the WorkOS context hooks would throw here.
  // Resolve the seeded identity from the test-auth adapter instead; the gate
  // is a build-constant env flag, so hook order is stable per build.
  if (TEST_AUTH_ENABLED) {
    const testAuth = useTestAuthState(testAuthUserParam());
    const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } =
      useConvexAuth();
    const convexUser = useQuery(
      api.users.queries.getCurrentUser,
      convexAuthenticated ? {} : undefined,
    );

    const testUser = testAuth.user;
    const nameParts = (testUser?.name ?? "").split(" ");
    const user = testUser
      ? {
          id: testUser.id,
          email: testUser.email,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(" ") || undefined,
          profilePictureUrl: undefined,
        }
      : null;

    return {
      loading: testAuth.isLoading || convexLoading,
      isAuthenticated: !!testUser && convexAuthenticated,
      user,
      // Convex auth is handled inside the test-auth provider; no raw
      // WorkOS access token exists on this path.
      accessToken: null,
      convexUser,
      organizationId: undefined,
      role: undefined,
    };
  }

  const { user, loading: authLoading } = useAuth();
  const { accessToken, loading: tokenLoading } = useAccessToken();
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
