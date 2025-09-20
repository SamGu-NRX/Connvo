"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { ConvexReactClient, useMutation } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import {
  AuthKitProvider,
  useAuth,
  useAccessToken,
} from "@workos-inc/authkit-nextjs/components";
import { api } from "@convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        <UpsertUserOnAuth />
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function useAuthFromAuthKit() {
  const { user, loading: isLoading } = useAuth();
  const {
    accessToken,
    loading: tokenLoading,
    error: tokenError,
  } = useAccessToken();
  const loading = (isLoading ?? false) || (tokenLoading ?? false);
  const authenticated = !!user && !!accessToken && !loading;

  const stableAccessToken = useRef<string | null>(null);
  if (accessToken && !tokenError) {
    stableAccessToken.current = accessToken;
  }

  const fetchAccessToken = useCallback(async () => {
    if (stableAccessToken.current && !tokenError) {
      return stableAccessToken.current;
    }
    return null;
  }, [tokenError]);

  return {
    isLoading: loading,
    isAuthenticated: authenticated,
    fetchAccessToken,
  };
}

function UpsertUserOnAuth() {
  const { user, loading: authLoading } = useAuth();
  const { accessToken, loading: tokenLoading, error } = useAccessToken();
  const upsertUser = useMutation(api.users.mutations.upsertUser);
  const didRun = useRef(false);

  const ready = useMemo(() => {
    return !!user && !!accessToken && !authLoading && !tokenLoading && !error;
  }, [user, accessToken, authLoading, tokenLoading, error]);

  useEffect(() => {
    if (!ready || didRun.current) return;
    didRun.current = true;
    const displayName = [user?.firstName, user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    // Best-effort upsert; ignore errors (will be retried on next action).
    upsertUser({
      workosUserId: String(user?.id),
      email: String(user?.email ?? ""),
      displayName: displayName || undefined,
      orgId: undefined,
      orgRole: undefined,
    }).catch(() => {
      // No-op: guards will surface if user not provisioned later.
    });
  }, [ready, upsertUser, user]);

  return null;
}
