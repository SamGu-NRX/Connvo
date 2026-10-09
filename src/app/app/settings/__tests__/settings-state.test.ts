// @vitest-environment node
// Pure logic tests — no DOM needed. The jsdom default environment cannot boot
// on Node 20.20.2 (jsdom's bundled undici requires a newer Node), so this file
// opts into the node environment explicitly.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_SETTINGS,
  backendToLocalSettings,
  deriveSettingsLoading,
  isReadyForSettingsQuery,
} from "../settings-state";
import type { LocalSettings, SettingsDocument } from "../settings-state";

// ---------------------------------------------------------------------------
// FROZEN ORIGINALS — copied verbatim from settings/page.tsx on the base
// branch, before extraction. The helpers must match these exactly.
// ---------------------------------------------------------------------------

// The `useState` initializer object.
const originalDefaultLocalSettings = {
  emailNotifications: true,
  pushNotifications: true,
  smsNotifications: false,
  profileVisibility: true,
  dataSharing: false,
  activityTracking: true,
};

// The sync `useEffect` mapping (six fields copied).
const originalBackendToLocalSettings = (settings: {
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  profileVisibility: boolean;
  dataSharing: boolean;
  activityTracking: boolean;
}) => ({
  emailNotifications: settings.emailNotifications,
  pushNotifications: settings.pushNotifications,
  smsNotifications: settings.smsNotifications,
  profileVisibility: settings.profileVisibility,
  dataSharing: settings.dataSharing,
  activityTracking: settings.activityTracking,
});

// The inline `readyForSettingsQuery` expression, parametrized over the two
// auth hooks exactly as the page read them:
//   isAuthenticated && !authLoading &&
//   convexAuthState.isAuthenticated && !convexAuthState.isLoading
const originalReadyForSettingsQuery = (
  workos: { isAuthenticated: boolean; loading: boolean },
  convex: { isAuthenticated: boolean; isLoading: boolean },
) =>
  workos.isAuthenticated &&
  !workos.loading &&
  convex.isAuthenticated &&
  !convex.isLoading;

// The inline `loading` expression:
//   authLoading || convexAuthState.isLoading ||
//   (readyForSettingsQuery && settings === undefined)
const originalDeriveSettingsLoading = (
  authLoading: boolean,
  convexLoading: boolean,
  ready: boolean,
  settings: LocalSettings | null | undefined,
) => authLoading || convexLoading || (ready && settings === undefined);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A realistic backend document: every field the query returns, with extra
// fields (`_id`, `userId`, timestamps) the mapping must ignore.
interface BackendDoc extends SettingsDocument {
  _id: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
}

const REALISTIC_DOC: BackendDoc = {
  _id: "j57settings000000000doc",
  userId: "j57user000000000000",
  emailNotifications: false,
  pushNotifications: true,
  smsNotifications: false,
  profileVisibility: true,
  dataSharing: false,
  activityTracking: true,
  createdAt: 1750000000000,
  updatedAt: 1759999999999,
};

const loadedStates: Array<LocalSettings | null | undefined> = [
  undefined,
  null,
  {
    emailNotifications: false,
    pushNotifications: false,
    smsNotifications: false,
    profileVisibility: false,
    dataSharing: false,
    activityTracking: false,
  },
  {
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: true,
    profileVisibility: true,
    dataSharing: true,
    activityTracking: true,
  },
];

// ---------------------------------------------------------------------------
// Equivalence tests
// ---------------------------------------------------------------------------

describe("DEFAULT_LOCAL_SETTINGS", () => {
  it("matches the page's useState initializer exactly", () => {
    expect(DEFAULT_LOCAL_SETTINGS).toEqual(originalDefaultLocalSettings);
  });

  it("preserves the initializer's key order (JSON-identical)", () => {
    expect(JSON.stringify(DEFAULT_LOCAL_SETTINGS)).toBe(
      JSON.stringify(originalDefaultLocalSettings),
    );
  });
});

describe("backendToLocalSettings", () => {
  it("matches the original mapping for the realistic document", () => {
    const result = backendToLocalSettings(REALISTIC_DOC);
    expect(result).toEqual(originalBackendToLocalSettings(REALISTIC_DOC));
  });

  it("copies exactly the six preference fields and ignores the rest", () => {
    expect(backendToLocalSettings(REALISTIC_DOC)).toEqual({
      emailNotifications: false,
      pushNotifications: true,
      smsNotifications: false,
      profileVisibility: true,
      dataSharing: false,
      activityTracking: true,
    });
  });

  it("returns a fresh object, like the original literal", () => {
    expect(backendToLocalSettings(REALISTIC_DOC)).not.toBe(REALISTIC_DOC);
  });

  it("matches the original for all-true and all-false documents", () => {
    const allValues = [false, true] as const;
    for (const value of allValues) {
      const doc: BackendDoc = {
        _id: "doc",
        userId: "user",
        emailNotifications: value,
        pushNotifications: value,
        smsNotifications: value,
        profileVisibility: value,
        dataSharing: value,
        activityTracking: value,
        createdAt: 0,
        updatedAt: 0,
      };
      expect(backendToLocalSettings(doc)).toEqual(
        originalBackendToLocalSettings(doc),
      );
    }
  });
});

describe("isReadyForSettingsQuery", () => {
  it("matches the original for all 16 auth-state combinations", () => {
    for (const workosAuthenticated of [false, true]) {
      for (const workosLoading of [false, true]) {
        for (const convexAuthenticated of [false, true]) {
          for (const convexLoading of [false, true]) {
            const workos = {
              isAuthenticated: workosAuthenticated,
              loading: workosLoading,
            };
            const convex = {
              isAuthenticated: convexAuthenticated,
              isLoading: convexLoading,
            };
            expect(isReadyForSettingsQuery(workos, convex)).toBe(
              originalReadyForSettingsQuery(workos, convex),
            );
          }
        }
      }
    }
  });
});

describe("deriveSettingsLoading", () => {
  it("matches the original across the full loading matrix", () => {
    for (const authLoading of [false, true]) {
      for (const convexLoading of [false, true]) {
        for (const ready of [false, true]) {
          for (const settings of loadedStates) {
            expect(
              deriveSettingsLoading(
                authLoading,
                convexLoading,
                ready,
                settings,
              ),
            ).toBe(
              originalDeriveSettingsLoading(
                authLoading,
                convexLoading,
                ready,
                settings,
              ),
            );
          }
        }
      }
    }
  });

  it("treats null (first-time user) as loaded and undefined as loading", () => {
    // Original semantics: only `undefined` means "still loading".
    expect(deriveSettingsLoading(false, false, true, null)).toBe(false);
    expect(deriveSettingsLoading(false, false, true, undefined)).toBe(true);
  });
});
