/**
 * Setup for the notes ledger test project (isolated vitest.notes.config.mts).
 *
 * The ledger's default recovery store is `window.sessionStorage`; clearing it
 * between tests keeps recovery state keyed by meetingId+clientId from leaking
 * across cases.
 */

import { afterEach } from "vitest";

afterEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    // jsdom always provides storage; nothing to do if it ever throws.
  }
});
