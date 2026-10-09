import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorState from "../ErrorState";
import TopBar from "../top-bar";

describe("smoke: test harness works on mvp components", () => {
  it("renders ErrorState and fires onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="kaboom" onRetry={onRetry} />);
    expect(screen.getByText("kaboom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("formats TopBar countdown for normal values", () => {
    render(<TopBar prompt="Say hello" timeLeft={125} />);
    expect(screen.getByText("Say hello")).toBeTruthy();
    expect(screen.getByText("2:05")).toBeTruthy();
  });
});
