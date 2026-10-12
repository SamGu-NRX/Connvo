"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Test-only client auth adapter (CALL-PLAN.md D3).
 *
 * Enabled by NEXT_PUBLIC_CONNVO_TEST_AUTH=1. WorkOS stays the default path;
 * this adapter exists so the eval harness can sign into the local backend
 * with tokens minted by the harness (issuer
 * `https://connvo-local-test.invalid`, served by
 * `/api/test-auth/token?user=A`).
 *
 * It must throw at startup if `VERCEL_ENV === "production"` or
 * `NODE_ENV === "production"` without an explicit local-build marker
 * (NEXT_PUBLIC_CONNVO_LOCAL_BUILD=1).
 */

function productionReasons(): string[] {
  const reasons: string[] = [];
  if (process.env.VERCEL_ENV === "production") {
    reasons.push("VERCEL_ENV=production");
  }
  if (process.env.NODE_ENV === "production") {
    reasons.push("NODE_ENV=production");
  }
  return reasons;
}

export function assertTestAuthAllowed(): void {
  const reasons = productionReasons();
  if (reasons.length === 0) return;
  if (process.env.NEXT_PUBLIC_CONNVO_LOCAL_BUILD === "1") return;
  throw new Error(
    `[connvo test-auth] refusing to start: test auth is enabled but this looks like a production environment (${reasons.join(", ")}) and no explicit local-build marker is set. Set NEXT_PUBLIC_CONNVO_LOCAL_BUILD=1 to acknowledge a local production-mode build.`,
  );
}

export interface TestAuthUser {
  id: string;
  email: string;
  name: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
  user: TestAuthUser;
}

let cachedToken: CachedToken | null = null;

async function fetchTestToken(userParam: string): Promise<CachedToken> {
  const res = await fetch(
    `/api/test-auth/token?user=${encodeURIComponent(userParam)}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[connvo test-auth] token endpoint failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    token: string;
    workosUserId: string;
    email: string;
    name: string;
    expiresAt: number;
  };
  return {
    token: data.token,
    // Refetch a minute before actual expiry.
    expiresAtMs: Math.min(data.expiresAt - 60_000, Date.now() + 5 * 60_000),
    user: {
      id: data.workosUserId,
      email: data.email,
      name: data.name,
    },
  };
}

/**
 * Which seeded identity the page is using: `?as=A` on the URL, default A.
 */
export function testAuthUserParam(): string {
  if (typeof window === "undefined") return "A";
  return new URLSearchParams(window.location.search).get("as") ?? "A";
}

export interface UseTestAuthResult {
  isLoading: boolean;
  user: TestAuthUser | null;
  getAccessToken: () => Promise<string | null>;
}

/**
 * Same hook shape ConvexProviderWithAuthKit expects from the WorkOS hook,
 * so the provider swap in ConvexClientProvider stays a one-branch change.
 * The identity is fixed per page load (`?as=A` on the URL, default A); each
 * harness peer loads its URL fresh, so reading it once per mount is correct.
 */
export function useTestAuth(): UseTestAuthResult {
  assertTestAuthAllowed();
  const [userParam] = useState(() => testAuthUserParam());
  const [state, setState] = useState<{
    user: TestAuthUser | null;
    isLoading: boolean;
  }>(() => ({
    user: cachedToken?.user ?? null,
    isLoading: true,
  }));

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    assertTestAuthAllowed();
    if (cachedToken && Date.now() < cachedToken.expiresAtMs) {
      return cachedToken.token;
    }
    const fetched = await fetchTestToken(userParam);
    cachedToken = fetched;
    setState({ user: fetched.user, isLoading: false });
    return fetched.token;
  }, [userParam]);

  useEffect(() => {
    let cancelled = false;
    getAccessToken().catch((err: unknown) => {
      console.error("[connvo test-auth] token fetch failed", err);
      if (!cancelled) setState({ user: null, isLoading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  return { isLoading: state.isLoading, user: state.user, getAccessToken };
}
