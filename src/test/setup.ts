import "@testing-library/jest-dom/vitest";

/**
 * Shared setup for the jsdom (frontend) vitest project.
 *
 * jsdom does not implement several browser APIs that React 19 / Radix-based
 * components touch during render. Each stub below is only installed when the
 * real API is missing, and individual tests may still spy on and override
 * these to assert behavior.
 */

// Used by auto-scroll behavior (e.g. LiveTranscriptionPanel).
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

// Used by Radix UI primitives and motion components.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: (): void => {},
      removeListener: (): void => {},
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      dispatchEvent: (): boolean => false,
    }),
  });
}

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// Used by "download transcript" style flows that create object URLs.
if (typeof URL !== "undefined" && typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = (): string => "blob:mock-url";
  URL.revokeObjectURL = (): void => {};
}
