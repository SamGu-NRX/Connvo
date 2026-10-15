import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ModeToggle } from "@/components/mvp/dashboard/ModeToggle";
vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));
it("the shell theme menu labels its open popup with the stable trigger", async () => {
  render(<ModeToggle />);
  const trigger = screen.getByRole("button", { name: "Toggle theme" });
  expect(trigger).toHaveAttribute("id", "app-theme-trigger");
  fireEvent.keyDown(trigger, { key: "Enter" });
  const menu = await screen.findByRole("menu");
  expect(menu).toHaveAttribute("aria-labelledby", "app-theme-trigger");
  expect(menu).toHaveAccessibleName("Toggle theme");
});

it("hydrates the single shell menu despite differing ancestor ID prefixes", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(<ModeToggle />, {
    identifierPrefix: "streamed-",
  });
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const recoverable: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <ModeToggle />, {
        identifierPrefix: "hydrated-",
        onRecoverableError: (error) => recoverable.push(error),
      });
    });
    expect(recoverable).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", { name: "Toggle theme" });
    expect(trigger).toHaveAttribute("id", "app-theme-trigger");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(await screen.findByRole("menu")).toHaveAccessibleName(
      "Toggle theme",
    );
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    errors.mockRestore();
  }
});
