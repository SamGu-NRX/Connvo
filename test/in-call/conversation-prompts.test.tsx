import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import {
  PromptPanel,
  type PromptViewState,
} from "@/components/call/ConversationPrompts";
import type { Id } from "@convex/_generated/dataModel";

const state: PromptViewState = {
  prompt: {
    id: "prompt-test" as Id<"prompts">,
    content: "What's been a small highlight of your week?",
    used: false,
  },
  active: true,
  exhausted: false,
  autoPaused: false,
  nextAutoAt: 90_000,
  nextManualAt: 0,
  pendingUntil: 0,
};
const props = {
  state,
  inCall: true,
  now: 1000,
  busy: false,
  error: null,
  onAnother: vi.fn(),
  onUsed: vi.fn(),
  onPause: vi.fn(),
};
afterEach(cleanup);
describe("conversation prompts panel", () => {
  it("renders loading, lobby and current prompt without invented personalization claims", () => {
    const { rerender } = render(<PromptPanel {...props} state={undefined} />);
    expect(
      screen.getByText("Loading conversation prompts…"),
    ).toBeInTheDocument();
    rerender(
      <PromptPanel
        {...props}
        inCall={false}
        state={{ ...state, prompt: null }}
      />,
    );
    expect(
      screen.getByText("Prompts are ready when you join."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get an idea" })).toBeDisabled();
    rerender(<PromptPanel {...props} />);
    expect(screen.getByTestId("current-prompt")).toHaveTextContent(
      "What's been a small highlight of your week?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Another one" }));
    expect(props.onAnother).toHaveBeenCalledOnce();
  });
  it("keeps the current question through pending and error, and can record use", () => {
    const { rerender } = render(<PromptPanel {...props} busy />);
    expect(
      screen.getByRole("button", { name: "Finding an idea…" }),
    ).toBeDisabled();
    rerender(
      <PromptPanel
        {...props}
        error="Couldn't update the prompt. Your call can continue. Try again."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your call can continue",
    );
    expect(screen.getByTestId("current-prompt")).toHaveTextContent(
      state.prompt!.content,
    );
    fireEvent.click(screen.getByRole("button", { name: "We used this" }));
    expect(props.onUsed).toHaveBeenCalledOnce();
    rerender(
      <PromptPanel
        {...props}
        state={{ ...state, prompt: { ...state.prompt!, used: true } }}
      />,
    );
    expect(
      screen.getByText("Marked as used. Saved to your recap."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Used ✓" })).toBeDisabled();
  });
  it("explains the idle trigger, pause and rate limit", () => {
    const { rerender } = render(
      <PromptPanel {...props} state={{ ...state, nextManualAt: 11_000 }} />,
    );
    expect(screen.getByRole("button", { name: "Another one" })).toBeDisabled();
    expect(screen.getByText("Another idea in 10s.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A fresh idea after 90 seconds without shared-note edits.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Pause automatic prompts" }),
    );
    expect(props.onPause).toHaveBeenCalledOnce();
    rerender(<PromptPanel {...props} state={{ ...state, autoPaused: true }} />);
    expect(
      screen.getByRole("button", { name: "Resume automatic prompts" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("stops controls at the cap and after the call", () => {
    const { rerender } = render(
      <PromptPanel {...props} state={{ ...state, exhausted: true }} />,
    );
    expect(screen.getByRole("button", { name: "Another one" })).toBeDisabled();
    expect(
      screen.getByText(
        "You've reached the last prompt for this call. Enjoy the conversation.",
      ),
    ).toBeInTheDocument();
    rerender(<PromptPanel {...props} state={{ ...state, active: false }} />);
    expect(
      screen.getByText("This call has ended. Your prompts are saved."),
    ).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<PromptPanel {...props} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
