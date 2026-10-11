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
  const Probe = () => {
    latest = useTestAuth();
    return null;
  };
  renderToString(createElement(Probe));
}

function tokenResponse(expiresInMs: number): Response {
  return new Response(
    JSON.stringify({
      token: "tok-1",
      workosUserId: "local-test-a",
      email: "a@connvo-local.test",
      name: "User A",
      expiresAt: Date.now() + expiresInMs,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
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
