import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useWorkOSAuth", () => ({
  useWorkOSAuth: () => {
    throw new Error("AuthKit must not mount without a Stream key");
  },
}));
vi.mock("@/actions/stream.actions", () => ({ tokenProvider: vi.fn() }));

it("renders queue children without Stream or WorkOS when Stream is unconfigured", async () => {
  vi.stubEnv("NEXT_PUBLIC_STREAM_API_KEY", "");
  try {
    const { default: StreamVideoProvider } = await import(
      "@/providers/StreamClientProvider"
    );
    render(
      <StreamVideoProvider>
        <p>Queue content</p>
      </StreamVideoProvider>,
    );
    expect(screen.getByText("Queue content")).toBeVisible();
  } finally {
    vi.unstubAllEnvs();
  }
});
