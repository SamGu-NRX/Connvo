import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScheduleModal } from "@/components/mvp/user-card/schedule-modal";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("scheduling availability stays fixed while the topic changes", () => {
  let call = 0;
  vi.spyOn(Math, "random").mockImplementation(() => (++call % 2 ? 0.1 : 0.9));
  render(
    <ScheduleModal
      isOpen
      onClose={() => {}}
      name="Peer"
      avatar={null}
      onSchedule={() => {}}
    />,
  );
  const slots = () =>
    screen
      .getAllByRole("button")
      .filter((button): button is HTMLButtonElement =>
        button instanceof HTMLButtonElement &&
        /\d:\d\d [AP]M/.test(button.textContent ?? ""),
      );
  const initial = slots().map((button) => button.disabled);
  expect(initial).toHaveLength(8);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Project" },
  });
  expect(slots().map((button) => button.disabled)).toEqual(initial);
});
