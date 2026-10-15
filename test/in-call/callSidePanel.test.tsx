import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CallSidePanel } from "@/components/call/CallSidePanel";

let mobile = true;
let onChange: () => void;
beforeEach(() => {
  mobile = true;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return mobile;
    },
    addEventListener: (_: string, fn: () => void) => {
      onChange = fn;
    },
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function Draft() {
  const [draft, setDraft] = useState("");
  return (
    <textarea
      aria-label="Notes draft"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

describe("call side panel", () => {
  it("leaves the mobile call usable when closed and retains the editor across close/reopen", () => {
    render(
      <>
        <button>Call control</button>
        <CallSidePanel>
          <Draft />
        </CallSidePanel>
      </>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const call = screen.getByRole("button", { name: "Call control" });
    expect(call.closest('[aria-hidden="true"]')).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe("none");
    fireEvent.click(screen.getByTestId("toggle-side-panel"));
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Unsaved thought" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close conversation" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("toggle-side-panel")).toHaveFocus();
    expect(document.body.style.pointerEvents).not.toBe("none");
    fireEvent.click(screen.getByTestId("toggle-side-panel"));
    expect(screen.getByRole("textbox")).toHaveValue("Unsaved thought");
  });

  it("uses an inline desktop panel without stealing focus and preserves draft through rotation", () => {
    mobile = false;
    render(
      <>
        <button autoFocus>Call control</button>
        <CallSidePanel>
          <Draft />
        </CallSidePanel>
      </>,
    );
    expect(screen.getByRole("button", { name: "Call control" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Keep after rotation" },
    });
    mobile = true;
    fireEvent(window, new Event("resize"));
    // Fire the browser's media-query notification inside React's event boundary.
    const trigger = screen.getByTestId("toggle-side-panel");
    trigger.addEventListener("rotate-test", () => onChange());
    fireEvent(trigger, new Event("rotate-test"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox")).toHaveValue("Keep after rotation");
  });

  it("dismisses Escape's cancel event and restores focus", () => {
    render(
      <CallSidePanel>
        <Draft />
      </CallSidePanel>,
    );
    fireEvent.click(screen.getByTestId("toggle-side-panel"));
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("toggle-side-panel")).toHaveFocus();
  });
});
