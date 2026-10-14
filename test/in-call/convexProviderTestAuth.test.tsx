import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3210";
  return { pathname: "/", getAuth: vi.fn(async () => ({ user: null })) };
});
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
// Keep the installed AuthKit provider and hook; replace only server actions.
vi.mock(
  "../../node_modules/@workos-inc/authkit-nextjs/dist/esm/actions.js",
  () => ({
    getAuthAction: route.getAuth,
    checkSessionAction: vi.fn(),
    handleSignOutAction: vi.fn(),
    refreshAuthAction: vi.fn(),
    switchToOrganizationAction: vi.fn(),
    getAccessTokenAction: vi.fn(),
  }),
);
vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useMutation: vi.fn(),
}));
vi.mock("@convex-dev/workos", () => ({
  ConvexProviderWithAuthKit: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";
function LandingAuthConsumer() {
  const { loading } = useAuth();
  return <p>{loading ? "Loading auth" : "Landing page ready"}</p>;
}
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  route.getAuth.mockClear();
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
});
it.each(["/", "/app/profile"])(
  "test auth retains AuthKit for useAuth on %s",
  async (pathname) => {
    route.pathname = pathname;
    render(
      <ConvexClientProvider>
        <LandingAuthConsumer />
      </ConvexClientProvider>,
    );
    expect(await screen.findByText("Landing page ready")).toBeVisible();
    await waitFor(() => expect(route.getAuth).toHaveBeenCalledOnce());
  },
);
it("an exact proxy-exempt eval path does not invoke WorkOS actions", () => {
  route.pathname = "/dev/auth-proof";
  render(
    <ConvexClientProvider>
      <p>Local fixture ready</p>
    </ConvexClientProvider>,
  );
  expect(screen.getByText("Local fixture ready")).toBeVisible();
  expect(route.getAuth).not.toHaveBeenCalled();
});
it("after-call bench flags skip AuthKit only on the matching eval route", () => {
  vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", "1");
  vi.stubEnv("NEXT_PUBLIC_CONNVO_REAL_CALL", "1");
  vi.stubEnv("NEXT_PUBLIC_CONNVO_AFTER_CALL", "1");
  route.pathname = "/app/meetings/synthetic";
  render(
    <ConvexClientProvider>
      <p>Recap ready</p>
    </ConvexClientProvider>,
  );
  expect(screen.getByText("Recap ready")).toBeVisible();
  expect(route.getAuth).not.toHaveBeenCalled();
});
