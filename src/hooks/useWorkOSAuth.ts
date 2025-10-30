"use client";

import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { useConvexAuth } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useEffect } from "react";

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
  const { user, loading: authLoading } = useAuth();
  const { accessToken, loading: tokenLoading } = useAccessToken();
  const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } =
    useConvexAuth();

  const createOrUpdateUser = useMutation(api.users.mutations.upsertUser);

  const loading = authLoading || tokenLoading || convexLoading;
  
  // FIX: Use WorkOS auth state directly instead of waiting for convexAuthenticated
  // This breaks the circular dependency where queries need auth but auth needs queries
  const hasWorkOSAuth = !!user && !!accessToken && !authLoading && !tokenLoading;
  const isAuthenticated = hasWorkOSAuth;

  // Query Convex user using WorkOS auth state
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
      convexAuthenticated, // ⚠️ THIS IS THE KEY VALUE
      isAuthenticated,
      hasConvexUser: !!convexUser,
      convexUserId: convexUser?._id,
      // Breakdown of isAuthenticated calculation:
      calculation: {
        hasUserCheck: !!user,
        hasAccessTokenCheck: !!accessToken,
        convexAuthenticatedCheck: convexAuthenticated,
        result: !!user && !!accessToken && convexAuthenticated,
      }
    });
  }, [user, accessToken, authLoading, tokenLoading, convexLoading, convexAuthenticated, isAuthenticated, convexUser]);

  // Sync WorkOS user with Convex database
  // Use hasWorkOSAuth instead of isAuthenticated to avoid circular dependency
  useEffect(() => {
    if (hasWorkOSAuth && user && !convexUser) {
      console.log('[useWorkOSAuth] Syncing user to Convex...', {
        workosUserId: user.id,
        email: user.email,
      });
      const syncUser = async () => {
        try {
          const wUser = user as Partial<WorkOSUser>;
          await createOrUpdateUser({
            workosUserId: user.id,
            email: user.email,
            displayName:
              user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.firstName || user.email,
            orgId: wUser.organizationId,
            orgRole: wUser.role,
          });
          console.log('[useWorkOSAuth] User sync completed successfully');
        } catch (error) {
          console.error("[useWorkOSAuth] Failed to sync user:", error);
        }
      };

      syncUser();
    }
  }, [hasWorkOSAuth, user, convexUser, createOrUpdateUser]);

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
