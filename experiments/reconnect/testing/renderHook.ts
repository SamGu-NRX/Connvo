/**
 * Minimal renderHook for React 19 without a DOM-testing library:
 * renders the hook inside a real react-dom root and exposes a box that is
 * re-filled on every render.
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface HookBox<T> {
  current: T;
}

export interface RenderHookResult<T> {
  box: HookBox<T>;
  rerender: () => void;
  unmount: () => void;
}

export function renderHook<T>(hook: () => T): RenderHookResult<T> {
  const box: HookBox<T> = { current: undefined as unknown as T };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  function Comp(): null {
    box.current = hook();
    return null;
  }

  const renderNow = () => {
    act(() => {
      root.render(createElement(Comp));
    });
  };

  renderNow();

  return {
    box,
    rerender: renderNow,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}
