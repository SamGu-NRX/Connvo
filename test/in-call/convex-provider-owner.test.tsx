import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const client = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3210";
  return {
    notify: null as ((authenticated: boolean) => void) | null,
    setAuth: vi.fn(),
    clearAuth: vi.fn(),
    fetchToken: vi.fn(async () => "local-test-token"),
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/app/match-queue" }));
vi.mock("@/lib/test-auth", () => ({
  useTestAuth: () => ({
    isLoading: false,
    user: { id: "local-test-a" },
    getAccessToken: client.fetchToken,
  }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  ConvexReactClient: class {
    setAuth = (_fetch: unknown, notify: (authenticated: boolean) => void) => {
      client.setAuth();
      // The real client retains one auth callback, even with two providers.
      client.notify = notify;
    };
    clearAuth = client.clearAuth;
  },
}));
import { useConvexAuth } from "convex/react";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

function Status({ name }: { name: string }) {
  const auth = useConvexAuth();
  return (
    <p>
      {name}: {auth.isAuthenticated ? "authenticated" : "loading"}
    </p>
  );
}

it("shares one real auth provider and preserves auth when the inner layout leaves", () => {
  const page = render(
    <ConvexClientProvider>
      <Status name="root" />
      <ConvexClientProvider>
        <Status name="queue" />
      </ConvexClientProvider>
    </ConvexClientProvider>,
  );
  expect(client.setAuth).toHaveBeenCalledOnce();
  act(() => client.notify?.(true));
  expect(screen.getByText("root: authenticated")).toBeVisible();
  expect(screen.getByText("queue: authenticated")).toBeVisible();
  page.rerender(
    <ConvexClientProvider>
      <Status name="root" />
      <Status name="call" />
    </ConvexClientProvider>,
  );
  expect(screen.getByText("call: authenticated")).toBeVisible();
  expect(client.clearAuth).not.toHaveBeenCalled();
  page.unmount();
  expect(client.clearAuth).toHaveBeenCalledOnce();
});
