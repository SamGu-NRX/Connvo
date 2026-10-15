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

export interface CachedToken {
  token: string;
  expiresAtMs: number;
  user: TestAuthUser;
}

// Token cache keyed by the seeded identity (?as=A|B|C|O). Two harness peers
// can mount from one SPA session (client-side navigation between ?as=A and
// ?as=B pages shares this module), so a single-slot cache would hand A's
// token to B's mount.
const tokenCache = new Map<string, CachedToken>();

export function cacheTestAuthToken(
  userParam: string,
  cached: CachedToken,
): void {
  tokenCache.set(userParam, cached);
}

export function clearTestAuthCache(userParam?: string): void {
  if (userParam === undefined) tokenCache.clear();
  else tokenCache.delete(userParam);
}

function readFreshCache(userParam: string): CachedToken | null {
  const cached = tokenCache.get(userParam) ?? null;
  return cached && Date.now() < cached.expiresAtMs ? cached : null;
}

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
 * Hook body for a fixed identity param. Exported so the eval driver and the
 * tests can mount an explicit identity; the URL reading lives in useTestAuth.
 */
export function useTestAuthState(userParam: string): UseTestAuthResult {
  assertTestAuthAllowed();
  const [state, setState] = useState<{
    user: TestAuthUser | null;
    isLoading: boolean;
  }>(() => {
    // Derive from the identity's own cache, don't default to true: a remount
    // with a fresh cached token must resolve immediately — and to ITS OWN
    // identity, never another peer's cached token. A STALE entry keeps the
    // identity visible while the refetch is pending (isLoading true).
    const cached = tokenCache.get(userParam) ?? null;
    return {
      user: cached?.user ?? null,
      isLoading: !(cached && Date.now() < cached.expiresAtMs),
    };
  });

  // Always publish, including on the cache-hit path — a mount whose initial
  // render saw an empty or expired cache must still resolve once the token
  // is in hand. The no-op when already resolved keeps the Convex client's
  // frequent getAccessToken calls from re-rendering the page.
  const publish = useCallback(
    (user: TestAuthUser) =>
      setState((prev) =>
        prev.user?.id === user.id && !prev.isLoading
          ? prev
          : { user, isLoading: false },
      ),
    [],
  );

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    assertTestAuthAllowed();
    const cached = readFreshCache(userParam);
    const token = cached ? Promise.resolve(cached) : fetchTestToken(userParam);
    return token.then((resolved) => {
      cacheTestAuthToken(userParam, resolved);
      publish(resolved.user);
      return resolved.token;
    });
  }, [userParam, publish]);

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

/**
 * Same hook shape ConvexProviderWithAuthKit expects from the WorkOS hook,
 * so the provider swap in ConvexClientProvider stays a one-branch change.
 * The identity is fixed per page load (`?as=A` on the URL, default A); each
 * harness peer loads its URL fresh, so reading it once per mount is correct.
 */
export function useTestAuth(): UseTestAuthResult {
  const [userParam] = useState(() => testAuthUserParam());
  return useTestAuthState(userParam);
}
