/**
 * Setup for the notes ledger vitest project ("notes" in vitest.config.ts).
 *
 * - jest-dom matchers for the mounted fault matrix (same idiom as the
 *   in-call project's setup, additive only);
 * - testing-library cleanup between tests;
 * - the ledger's default recovery store is `window.sessionStorage`; clearing
 *   it between tests keeps recovery state keyed by meetingId+clientId from
 *   leaking across cases.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  try {
    window.sessionStorage.clear();
  } catch {
    // jsdom always provides storage; nothing to do if it ever throws.
  }
});
