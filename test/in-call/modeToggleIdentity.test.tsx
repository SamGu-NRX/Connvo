import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
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
