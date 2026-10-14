import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3210";
});
vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useMutation: vi.fn(),
}));
vi.mock("@convex-dev/workos", () => ({
  ConvexProviderWithAuthKit: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  AuthKitProvider: () => {
    throw new Error("Test auth must not mount AuthKit");
  },
  useAuth: vi.fn(),
  useAccessToken: vi.fn(),
}));
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";
it("local test auth renders through Convex without invoking WorkOS middleware actions", () => {
  render(
    <ConvexClientProvider>
      <p>Local fixture ready</p>
    </ConvexClientProvider>,
  );
  expect(screen.getByText("Local fixture ready")).toBeVisible();
});
