"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { ConvexReactClient, useMutation } from "convex/react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { AuthKitProvider, useAuth as useWorkOSAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { api } from "@convex/_generated/api";
import { useTestAuth } from "@/lib/test-auth";

// CALL-PLAN.md D3 (eval-only): test auth is opt-in via env and refuses to
// start in production — see src/lib/test-auth.tsx.
const TEST_AUTH_ENABLED = process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH === "1";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// The Convex client is constructed lazily at first render instead of at
// module evaluation: a top-level throw here crashes every route the moment
// this module is imported — including the eval-only call bench, which must
// boot with no Convex deployment at all (tools/call-eval/CONTRACT.md).
// Normal routes still fail loudly: the provider throws the same error when
// it renders without the env.
let convexClient: ConvexReactClient | null = null;
function getConvexClient(): ConvexReactClient {
  if (!convexUrl) {
    throw new Error(
      "ConvexClientProvider requires NEXT_PUBLIC_CONVEX_URL to be defined. " +
        "Set this environment variable to your Convex deployment URL (e.g. https://your-app.convex.cloud).",
    );
  }
  convexClient ??= new ConvexReactClient(convexUrl);
  return convexClient;
}

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
  const content = (
    <ConvexProviderWithAuthKit
      client={getConvexClient()}
      useAuth={TEST_AUTH_ENABLED ? useTestAuth : useAuth}
    >
      {TEST_AUTH_ENABLED ? null : <UpsertUserOnAuth />}
      {children}
    </ConvexProviderWithAuthKit>
  );
  // Local test auth bypasses AuthKit middleware; mounting its provider would
  // still invoke withAuth server actions and report 500s on every eval page.
  return TEST_AUTH_ENABLED ? content : <AuthKitProvider>{content}</AuthKitProvider>;
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
