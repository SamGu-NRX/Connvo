import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LandingPage from "@/app/page";

vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  // jsdom has no layout observers; theme tests do not drive scroll animations.
  class LayoutObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", LayoutObserver);
  vi.stubGlobal("ResizeObserver", LayoutObserver);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    clear: () => values.clear(),
  } satisfies Pick<Storage, "getItem" | "setItem" | "clear">);
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

test("keeps the light default and persists both theme toggles", () => {
  render(<LandingPage />);
  expect(screen.getAllByAltText("Connvo logo")[0]).toHaveAttribute(
    "src",
    expect.stringContaining("Connvo-black.png"),
  );
  expect(screen.getByText(/Connvo opens the door/)).toHaveTextContent(
    '"coffee-chat" conversations',
  );

  fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(document.documentElement).toHaveClass("dark");
  expect(screen.getAllByAltText("Connvo logo")[0]).toHaveAttribute(
    "src",
    expect.stringContaining("Connvo-white.png"),
  );

  fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
  expect(localStorage.getItem("theme")).toBe("light");
  expect(document.documentElement).not.toHaveClass("dark");
  expect(screen.getAllByAltText("Connvo logo")[0]).toHaveAttribute(
    "src",
    expect.stringContaining("Connvo-black.png"),
  );
});

test("hydrates the light server markup into the saved dark theme without a mismatch", async () => {
  localStorage.setItem("theme", "dark");
  const container = document.createElement("div");
  container.innerHTML = renderToString(<LandingPage />);
  document.body.append(container);
  expect(container.querySelector('img[alt="Connvo logo"]')).toHaveAttribute(
    "src",
    expect.stringContaining("Connvo-black.png"),
  );
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <LandingPage />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(container.querySelector('img[alt="Connvo logo"]')).toHaveAttribute(
      "src",
      expect.stringContaining("Connvo-white.png"),
    );
    expect(document.documentElement).toHaveClass("dark");
    expect(errors).toEqual([]);
  } finally {
    if (root) act(() => root.unmount());
    container.remove();
  }
});
