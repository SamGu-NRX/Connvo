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
  const isAuthenticated = !!user && !!accessToken && convexAuthenticated;

  // Skip Convex user query until authenticated to avoid UNAUTHORIZED errors
  const convexUser = useQuery(
    api.users.queries.getCurrentUser,
    isAuthenticated ? {} : undefined,
  );

  // Sync WorkOS user with Convex database
  useEffect(() => {
    if (isAuthenticated && user && !convexUser) {
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
        } catch (error) {
          console.error("Failed to sync user:", error);
        }
      };

      syncUser();
    }
  }, [isAuthenticated, user, convexUser, createOrUpdateUser]);

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
