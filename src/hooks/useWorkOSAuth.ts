"use client";

import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { useConvexAuth } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
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

  const createOrUpdateUser = useMutation(
    api.users.mutations.createOrUpdateUser,
  );
  const getCurrentUser = useQuery(api.users.queries.getCurrentUser);

  const loading = authLoading || tokenLoading || convexLoading;
  const isAuthenticated = !!user && !!accessToken && convexAuthenticated;

  // Sync WorkOS user with Convex database
  useEffect(() => {
    if (isAuthenticated && user && !getCurrentUser) {
      const syncUser = async () => {
        try {
          await createOrUpdateUser({
            workosUserId: user.id,
            email: user.email,
            displayName:
              user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.firstName || user.email,
            avatarUrl: user.profilePictureUrl,
            orgId: user.organizationId,
            orgRole: user.role,
          });
        } catch (error) {
          console.error("Failed to sync user:", error);
        }
      };

      syncUser();
    }
  }, [isAuthenticated, user, getCurrentUser, createOrUpdateUser]);

  return {
    // Authentication state
    loading,
    isAuthenticated,

    // WorkOS user data
    user: user as WorkOSUser | null,
    accessToken,

    // Convex user data
    convexUser: getCurrentUser,

    // Organization info
    organizationId: user?.organizationId,
    role: user?.role,
  };
}
