"use client";

/**
 * Subtle entrance animation (opacity + 6px rise, 200ms) built with `animate`
 * from the `motion` package (docs/notes-ledger-f1/design.md §4).
 *
 * Reduced motion: the animation is opt-in. When the user asks for
 * `prefers-reduced-motion: reduce`, FadeRise renders a plain static div —
 * no motion props, no transform, no opacity ramp. State changes stay visible
 * through text and color instead (see the better-accessibility skill,
 * motion-and-zoom.md). useSyncExternalStore keeps SSR and hydration honest
 * (server snapshot = no motion) without a flash of animation on hydration.
 */

import { motion } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Server render never animates; the client snapshot takes over on hydration. */
function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function FadeRise({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      data-motion="fade-rise"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
