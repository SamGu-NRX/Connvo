/**
 * Controllable matchMedia double for jsdom (shared by the in-call suites).
 *
 * jsdom implements window.matchMedia but its media state never changes and
 * cannot be driven. Tests flip the reduced-motion preference here BEFORE
 * rendering; the panel's useSyncExternalStore reads it on mount.
 */

let prefersReducedMotion = false;

export function setPrefersReducedMotion(reduce: boolean): void {
  prefersReducedMotion = reduce;
}

export function getPrefersReducedMotion(): boolean {
  return prefersReducedMotion;
}

type MatchMediaFn = (query: string) => MediaQueryList;

function stubQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}

const originalMatchMedia: MatchMediaFn | undefined =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia.bind(window)
    : undefined;

export function installMatchMediaDouble(): void {
  const double: MatchMediaFn = (query: string) => {
    if (query.includes("prefers-reduced-motion")) {
      return stubQueryList(query, prefersReducedMotion);
    }
    if (originalMatchMedia) {
      return originalMatchMedia(query);
    }
    return stubQueryList(query, false);
  };
  window.matchMedia = double as typeof window.matchMedia;
}

export function restoreMatchMedia(): void {
  if (originalMatchMedia) {
    window.matchMedia = originalMatchMedia as typeof window.matchMedia;
  }
}
