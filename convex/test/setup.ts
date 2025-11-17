/**
 * Global test setup for Convex Vitest project.
 *
 * Provides a modules glob for tools that expect it and ensures we reset any
 * lingering mocks between suites to keep tests isolated.
 */

import { resetAllMocks, cleanupTestMocks } from "./mocks";

type ViteImportMeta = ImportMeta & {
  glob?: (pattern: string) => Record<string, () => Promise<unknown>>;
};

const isVitestRuntime =
  typeof process !== "undefined" &&
  process?.env?.VITEST;

// Some Convex build steps run in plain Node without Vite-provided helpers.
// Fall back to an empty module map so convex deploy analysis doesn't choke.
export const modules = (() => {
  try {
    return (import.meta as ViteImportMeta).glob("../**/*.{ts,tsx,js,mjs,mts,cts,cjs,jsx}");
  } catch (error) {
    if (isVitestRuntime) {
      if ((error as Error).message?.includes("glob")) {
        throw new Error("import.meta.glob is unavailable in Vitest runtime");
      }
      throw error;
    }
    return {};
  }
})();

type AfterEachHook = (
  fn: () => unknown | Promise<unknown>,
) => void;

const globalAfterEach = (globalThis as {
  afterEach?: AfterEachHook;
}).afterEach;

if (globalAfterEach) {
  globalAfterEach(() => {
    cleanupTestMocks();
    resetAllMocks();
  });
}
