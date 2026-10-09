/**
 * Pure state helpers extracted from `src/app/app/settings/page.tsx`.
 *
 * Protocol: see `src/app/app/_lib/README.md`. Every helper is
 * equivalence-tested in `__tests__/settings-state.test.ts` against the
 * frozen original inline code, and `backendToLocalSettings` is measured
 * in `_lib/bench/suites/03-settings-page.bench.ts`.
 */

/** The six preference toggles the settings page keeps in local state. */
export interface LocalSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  profileVisibility: boolean;
  dataSharing: boolean;
  activityTracking: boolean;
}

/**
 * Backend settings document as the page consumes it from
 * `api.settings.queries.getCurrentUserSettings`. The mapping only reads the
 * six preference fields, so the rest of the document (`_id`, `userId`,
 * timestamps) is intentionally not part of this structural contract.
 */
export interface SettingsDocument {
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  profileVisibility: boolean;
  dataSharing: boolean;
  activityTracking: boolean;
}

/**
 * Initial local settings — the exact object the page's `useState`
 * initializer produced. Safe to share as a module constant: every state
 * update replaces the object, nothing mutates it in place.
 */
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  emailNotifications: true,
  pushNotifications: true,
  smsNotifications: false,
  profileVisibility: true,
  dataSharing: false,
  activityTracking: true,
};

/**
 * Copy the six preference fields from a backend settings document.
 * Was the object literal in the page's sync `useEffect`; copies the same
 * fields in the same order and produces a fresh object every call.
 */
export function backendToLocalSettings(
  settings: SettingsDocument,
): LocalSettings {
  return {
    emailNotifications: settings.emailNotifications,
    pushNotifications: settings.pushNotifications,
    smsNotifications: settings.smsNotifications,
    profileVisibility: settings.profileVisibility,
    dataSharing: settings.dataSharing,
    activityTracking: settings.activityTracking,
  };
}

/**
 * True when both auth layers have settled and the settings query may run.
 * Was the inline `readyForSettingsQuery` expression.
 */
export function isReadyForSettingsQuery(
  workos: { isAuthenticated: boolean; loading: boolean },
  convex: { isAuthenticated: boolean; isLoading: boolean },
): boolean {
  return (
    workos.isAuthenticated &&
    !workos.loading &&
    convex.isAuthenticated &&
    !convex.isLoading
  );
}

/**
 * The page's loading decision: either auth layer is still resolving, or the
 * settings query is allowed to run but has not produced a value yet. Was the
 * inline `loading` expression.
 *
 * `settings` may be `null` (the query returns null for first-time users) —
 * only `undefined` counts as "still loading", matching the original
 * `settings === undefined` check exactly.
 */
export function deriveSettingsLoading(
  authLoading: boolean,
  convexLoading: boolean,
  ready: boolean,
  settings: LocalSettings | null | undefined,
): boolean {
  return authLoading || convexLoading || (ready && settings === undefined);
}
