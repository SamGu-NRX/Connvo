"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { ConvexReactClient, useMutation } from "convex/react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { AuthKitProvider, useAuth as useWorkOSAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { api } from "@convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "ConvexClientProvider requires NEXT_PUBLIC_CONVEX_URL to be defined. " +
      "Set this environment variable to your Convex deployment URL (e.g. https://your-app.convex.cloud).",
  );
}

const convex = new ConvexReactClient(convexUrl);

// Wrapper hook that matches ConvexProviderWithAuthKit's expected interface
function useAuth() {
  const { user, loading: authLoading } = useWorkOSAuth();
  const {
    accessToken,
    loading: tokenLoading,
    error: tokenError,
    getAccessToken,
  } = useAccessToken();

  const loading = (authLoading ?? false) || (tokenLoading ?? false);

  const fetchAccessToken = useCallback(async () => {
    console.log("[ConvexAuth] getAccessToken invoked", {
      hasUser: !!user,
      authLoading,
      tokenLoading,
      tokenError: tokenError?.message,
    });

    if (tokenError) {
      console.error("[ConvexAuth] Access token error detected", tokenError);
      return null;
    }

    try {
      const token = await getAccessToken();
      if (!token) {
        console.warn("[ConvexAuth] WorkOS returned no access token");
        return null;
      }
      return token;
    } catch (err) {
      console.error("[ConvexAuth] Failed to retrieve access token", err);
      return null;
    }
  }, [authLoading, getAccessToken, tokenError, tokenLoading, user]);

  useEffect(() => {
    console.log("[ConvexAuth] Auth state changed:", {
      hasUser: !!user,
      hasAccessToken: !!accessToken,
      authLoading,
      tokenLoading,
      tokenError: tokenError?.message,
    });
  }, [user, accessToken, authLoading, tokenLoading, tokenError]);

  return useMemo(
    () => ({
      isLoading: loading,
      user,
      getAccessToken: fetchAccessToken,
    }),
    [loading, user, fetchAccessToken],
  );
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
  const currentToken = useRef<string | null>(null);
  const hasShownConfigError = useRef(false);

  const ready = useMemo(() => {
    return (
      !!user &&
      !!accessToken &&
      !authLoading &&
      !tokenLoading &&
      !error
    );
  }, [user, accessToken, authLoading, tokenLoading, error]);

  useEffect(() => {
    const tokenChanged = currentToken.current !== accessToken;

    if (tokenChanged) {
      currentToken.current = accessToken ?? null;
      didRun.current = false;
      retryCount.current = 0;
      hasShownConfigError.current = false;
    }

    console.log('[UpsertUserOnAuth] Effect triggered:', {
      ready,
      didRun: didRun.current,
      hasUser: !!user,
      userId: user?.id,
      hasAccessToken: !!accessToken,
      authLoading,
      tokenLoading,
      error,
    });

    if (!ready || didRun.current) return;
    if (!accessToken) return;
    
    // Add a small delay to ensure Convex auth context is fully initialized
    const timer = setTimeout(async () => {
      if (didRun.current) return;
      didRun.current = true;
      
      const displayName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      console.log('[UpsertUserOnAuth] Attempting to upsert user:', {
        workosUserId: String(user?.id),
        email: String(user?.email ?? ""),
        displayName,
      });

      const attemptUpsert = async (): Promise<void> => {
        try {
          await upsertUser({
            workosUserId: String(user?.id),
            email: String(user?.email ?? ""),
            displayName: displayName || undefined,
            orgId: undefined,
            orgRole: undefined,
          });
          console.log("[UpsertUserOnAuth] ✅ User upserted successfully");
          hasShownConfigError.current = false; // Reset error flag on success
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error("[UpsertUserOnAuth] User upsert failed:", err);
          
          // Check if this is a Convex auth configuration error
          const isConfigError = errorMessage.includes("Server Error") ||
                               errorMessage.includes("WORKOS_CLIENT_ID");
          
          if (isConfigError && !hasShownConfigError.current) {
            hasShownConfigError.current = true;
            console.error(
              "\n" +
              "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
              "❌ CONVEX AUTHENTICATION CONFIGURATION ERROR\n" +
              "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
              "\n" +
              "The Convex backend cannot validate authentication tokens.\n" +
              "This typically means WORKOS_CLIENT_ID is not set in Convex.\n" +
              "\n" +
              "📖 SOLUTION: See CONVEX_DEPLOYMENT_SETUP.md for instructions\n" +
              "\n" +
              "Quick fix:\n" +
              "1. Go to https://dashboard.convex.dev\n" +
              "2. Settings → Environment Variables\n" +
              "3. Add WORKOS_CLIENT_ID with your WorkOS client ID\n" +
              "4. Redeploy: pnpm convex deploy --prod\n" +
              "\n" +
              "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            );
            // Don't retry config errors - they need manual intervention
            return;
          }
          
          // Retry with exponential backoff for transient errors
          if (retryCount.current < maxRetries && !isConfigError) {
            retryCount.current += 1;
            const delay = Math.pow(2, retryCount.current) * 500; // 1s, 2s, 4s
            console.log(`[UpsertUserOnAuth] Retrying user upsert in ${delay}ms (attempt ${retryCount.current}/${maxRetries})`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            didRun.current = false; // Allow retry
            return attemptUpsert();
          } else if (isConfigError) {
            console.error(
              "[UpsertUserOnAuth] ⚠️  Skipping retries - configuration error requires manual fix"
            );
          } else {
            console.error(
              "[UpsertUserOnAuth] ❌ User upsert failed after max retries. " +
              "User may need to refresh the page or check console for details."
            );
          }
        }
      };

      await attemptUpsert();
    }, 500); // 500ms delay to let Convex auth initialize

    return () => clearTimeout(timer);
  }, [ready, upsertUser, user, accessToken]);

  return null;
}
