/**
 * Benchmark suite for part 03-settings-page.
 *
 * Protocol: see src/app/app/_lib/README.md.
 *  - `before`: FROZEN copy of the sync-useEffect object literal that was
 *    inline in settings/page.tsx before extraction.
 *  - `after`: the extracted `backendToLocalSettings` helper.
 *  - benchPair() interleaves samples and reports medians.
 */
import { benchPair } from "../harness";
import type { Suite } from "../types";
import { backendToLocalSettings } from "../../../settings/settings-state";

const DOC_COUNT = 10_000;

// Deterministic mix of settings documents; the modular patterns cover every
// combination of the six boolean fields across the corpus.
const docs = Array.from({ length: DOC_COUNT }, (_, i) => ({
  emailNotifications: i % 2 === 0,
  pushNotifications: i % 3 === 0,
  smsNotifications: i % 5 === 0,
  profileVisibility: i % 4 !== 0,
  dataSharing: i % 7 === 0,
  activityTracking: i % 6 !== 0,
}));

const suite: Suite = {
  name: "03-settings-page",
  run: () => {
    benchPair({
      suite: "03-settings-page",
      name: "backendToLocalSettings over 10k settings docs",
      note: "n=10000",
      iterations: 2,
      samples: 9,
      before: () => {
        let last: unknown;
        for (const s of docs) {
          // FROZEN ORIGINAL — the sync useEffect object literal, verbatim.
          last = {
            emailNotifications: s.emailNotifications,
            pushNotifications: s.pushNotifications,
            smsNotifications: s.smsNotifications,
            profileVisibility: s.profileVisibility,
            dataSharing: s.dataSharing,
            activityTracking: s.activityTracking,
          };
        }
        return last;
      },
      after: () => {
        let last: unknown;
        for (const s of docs) last = backendToLocalSettings(s);
        return last;
      },
    });
  },
};

export default suite;
