// Teaches vitest's Assertion interface about jest-axe's matcher. This file is
// intentionally a module (top-level import) so the "vitest" block is a module
// augmentation; the ambient "jest-axe" declaration lives in jest-axe.d.ts.

import "vitest";

declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
  interface Matchers<T> {
    toHaveNoViolations(): T;
  }
}
