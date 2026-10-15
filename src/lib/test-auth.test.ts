/** @vitest-environment node */
// Tests for the useTestAuth loading-state derivation (CALL-PLAN D3 adapter).
// Runs under the node environment with renderToString: the frontend vitest
// project has no jsdom installed, and the behavior under test is the
// useState initializer's derivation from the module token cache, which a
// server render exercises directly.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

interface LatestState {
  isLoading: boolean;
  user: { id: string; email: string; name: string } | null;
  getAccessToken: () => Promise<string | null>;
}

let latest: LatestState | null = null;

function render(useTestAuth: () => LatestState): void {
  const Probe = ({ observe }: { observe: (state: LatestState) => void }) => {
    observe(useTestAuth());
    return null;
  };
  renderToString(
    createElement(Probe, {
      observe: (state) => {
        latest = state;
      },
    }),
  );
}

function tokenResponseFor(
  id: string,
  email: string,
  name: string,
  expiresInMs: number,
): Response {
  return new Response(
    JSON.stringify({
      token: "tok-1",
      workosUserId: id,
      email,
      name,
      expiresAt: Date.now() + expiresInMs,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function tokenResponse(expiresInMs: number): Response {
  return tokenResponseFor(
    "local-test-a",
    "a@connvo-local.test",
    "User A",
    expiresInMs,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTestAuth loading state (cached-token derivation)", () => {
  it("renders loading before any token, then not-loading on a re-render with a fresh cache", async () => {
    vi.resetModules();
    const { useTestAuth } = await import("./test-auth");
    const fetchMock = vi.fn(async () => tokenResponse(10 * 60_000));
    vi.stubGlobal("fetch", fetchMock);

    // First render, no cache: loading with no user.
    render(useTestAuth);
    expect(latest?.isLoading).toBe(true);
    expect(latest?.user).toBe(null);

    // getAccessToken is what the Convex client calls; it populates the
    // module token cache.
    const token = await latest!.getAccessToken();
    expect(token).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-render of the same module instance (the remount path): the derived
    // loading state must resolve immediately from the fresh cache — the old
    // code hardcoded isLoading: true and the cache-hit path never published.
    render(useTestAuth);
    expect(latest?.isLoading).toBe(false);
    expect(latest?.user?.id).toBe("local-test-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports loading again once the cached token has expired", async () => {
    vi.resetModules();
    const { useTestAuth } = await import("./test-auth");
    const fetchMock = vi.fn(async () => tokenResponse(30_000));
    vi.stubGlobal("fetch", fetchMock);

    render(useTestAuth);
    await latest!.getAccessToken();

    // expiresAtMs is min(expiresAt - 60s, now + 5min): a 30s expiry makes
    // the cache stale immediately, so a re-render must go back to loading
    // while the identity stays known, and must not fetch until asked.
    render(useTestAuth);
    expect(latest?.isLoading).toBe(true);
    expect(latest?.user?.id).toBe("local-test-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useTestAuth identity-keyed cache (mounts A then B)", () => {
  it("resolves B from B's own cache and never inherits A's token", async () => {
    vi.resetModules();
    const { useTestAuthState, cacheTestAuthToken, clearTestAuthCache } =
      await import("./test-auth");
    clearTestAuthCache();

    // A's fetch completed first (cacheTestAuthToken is the call the fetch
    // path itself makes).
    cacheTestAuthToken("A", {
      token: "tok-a",
      expiresAtMs: Date.now() + 10 * 60_000,
      user: {
        id: "local-test-a",
        email: "a@connvo-local.test",
        name: "User A",
      },
    });

    // B mounts with only A cached: no user — never A's — and still loading.
    render(() => useTestAuthState("B"));
    expect(latest?.isLoading).toBe(true);
    expect(latest?.user).toBe(null);

    // B's own token lands: B resolves immediately, isLoading false.
    cacheTestAuthToken("B", {
      token: "tok-b",
      expiresAtMs: Date.now() + 10 * 60_000,
      user: {
        id: "local-test-b",
        email: "b@connvo-local.test",
        name: "User B",
      },
    });
    render(() => useTestAuthState("B"));
    expect(latest?.isLoading).toBe(false);
    expect(latest?.user?.id).toBe("local-test-b");

    // A's remount still resolves from A's own entry.
    render(() => useTestAuthState("A"));
    expect(latest?.isLoading).toBe(false);
    expect(latest?.user?.id).toBe("local-test-a");

    clearTestAuthCache();
  });

  it("refetches B after B's cached token expires and resolves on the cache-hit path", async () => {
    vi.resetModules();
    const { useTestAuthState, cacheTestAuthToken, clearTestAuthCache } =
      await import("./test-auth");
    const fetchMock = vi.fn(async (_url: string) =>
      tokenResponseFor(
        "local-test-b",
        "b@connvo-local.test",
        "User B",
        10 * 60_000,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    cacheTestAuthToken("B", {
      token: "tok-b-stale",
      expiresAtMs: Date.now() - 1,
      user: {
        id: "local-test-b",
        email: "b@connvo-local.test",
        name: "User B",
      },
    });

    // Stale cache: the identity stays known while loading.
    render(() => useTestAuthState("B"));
    expect(latest?.isLoading).toBe(true);
    expect(latest?.user?.id).toBe("local-test-b");

    // getAccessToken refetches for B (identity-scoped URL), then the
    // re-render resolves from the fresh entry.
    await latest!.getAccessToken();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/test-auth/token?user=B");
    render(() => useTestAuthState("B"));
    expect(latest?.isLoading).toBe(false);
    expect(latest?.user?.id).toBe("local-test-b");

    clearTestAuthCache();
  });
});
