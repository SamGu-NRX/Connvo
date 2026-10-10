/**
 * Permitted profile projection — fail-closed.
 *
 * Only the contract's permitted public fields are ever copied onto a
 * projection, and a grant without a visibility basis (self / same-org /
 * shared-meeting) yields "not-visible", mirroring production's
 * tenancy-bounded scoping in getProfileByUserIdPublic.
 */
import {
  EXCLUDED_PROFILE_FIELDS,
  PERMITTED_PROFILE_FIELDS,
  type InternalProfile,
  type ProjectedProfile,
  type VisibilityBasis,
} from "./contract";

export type ProjectionGrant = {
  viewerId: string;
  basis: VisibilityBasis;
};

export type ProjectionResult =
  | { ok: true; profile: ProjectedProfile }
  | { ok: false; reason: "not-visible" };

export function projectProfile(
  profile: InternalProfile,
  grant: ProjectionGrant,
): ProjectionResult {
  const isSelf = grant.viewerId === profile.userId;
  const tenancyBounded = grant.basis === "shared-meeting" || grant.basis === "same-org";
  if (!isSelf && !tenancyBounded) {
    return { ok: false, reason: "not-visible" };
  }
  const source = profile as unknown as Record<string, unknown>;
  const projected: Record<string, unknown> = { userId: profile.userId };
  for (const field of PERMITTED_PROFILE_FIELDS) {
    const value = source[field];
    if (value !== undefined) {
      projected[field] = value;
    }
  }
  return { ok: true, profile: projected as unknown as ProjectedProfile };
}

/**
 * Which of the excluded sensitive fields are present on an object.
 * Always empty for a correct projection; used by tests and the UI.
 */
export function excludedFieldLeaks(candidate: Record<string, unknown>): string[] {
  return EXCLUDED_PROFILE_FIELDS.filter((field) => field in candidate);
}
