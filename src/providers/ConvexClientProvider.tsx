"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { ConvexReactClient, useMutation } from "convex/react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { AuthKitProvider, useAuth as useWorkOSAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { api } from "@convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Wrapper hook that matches ConvexProviderWithAuthKit's expected interface
function useAuth() {
  const { user, loading: isLoading } = useWorkOSAuth();
  const { accessToken, loading: tokenLoading, error: tokenError } = useAccessToken();
  
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

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
        <UpsertUserOnAuth />
        {children}
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  );
}

function UpsertUserOnAuth() {
  const { user, loading: authLoading } = useWorkOSAuth();
  const { accessToken, loading: tokenLoading, error } = useAccessToken();
  const upsertUser = useMutation(api.users.mutations.upsertUser);
  const didRun = useRef(false);
  const retryCount = useRef(0);
  const maxRetries = 3;

  const ready = useMemo(() => {
    return !!user && !!accessToken && !authLoading && !tokenLoading && !error;
  }, [user, accessToken, authLoading, tokenLoading, error]);

  useEffect(() => {
    if (!ready || didRun.current) return;
    
    // Add a small delay to ensure Convex auth context is fully initialized
    const timer = setTimeout(async () => {
      if (didRun.current) return;
      didRun.current = true;
      
      const displayName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      const attemptUpsert = async (): Promise<void> => {
        try {
          await upsertUser({
            workosUserId: String(user?.id),
            email: String(user?.email ?? ""),
            displayName: displayName || undefined,
            orgId: undefined,
            orgRole: undefined,
          });
          console.log("User upserted successfully");
        } catch (err) {
          console.warn("User upsert failed:", err);
          
          // Retry with exponential backoff for auth errors
          if (retryCount.current < maxRetries) {
            retryCount.current += 1;
            const delay = Math.pow(2, retryCount.current) * 500; // 1s, 2s, 4s
            console.log(`Retrying user upsert in ${delay}ms (attempt ${retryCount.current}/${maxRetries})`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            didRun.current = false; // Allow retry
            return attemptUpsert();
          } else {
            console.error("User upsert failed after max retries. User may need to refresh.");
          }
        }
      };

      await attemptUpsert();
    }, 500); // 500ms delay to let Convex auth initialize

    return () => clearTimeout(timer);
  }, [ready, upsertUser, user]);

  return null;
}
