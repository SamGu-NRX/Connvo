/**
 * Setup for the in-call vitest project (jsdom + testing-library + jest-axe).
 * Registered as setupFiles for the additive "in-call" project only — the
 * convex and frontend projects are untouched (docs/notes-ledger-f1 §5).
 */

import "@testing-library/jest-dom/vitest";
import { expect } from "vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import {
  installMatchMediaDouble,
  restoreMatchMedia,
  setPrefersReducedMotion,
} from "./matchMediaDouble";

// jest-axe exports the matcher map itself ({ toHaveNoViolations: fn }) —
// extend with it directly, not wrapped in another object.
expect.extend(toHaveNoViolations);

installMatchMediaDouble();

afterEach(() => {
  cleanup();
  setPrefersReducedMotion(false);
  restoreMatchMedia();
});
