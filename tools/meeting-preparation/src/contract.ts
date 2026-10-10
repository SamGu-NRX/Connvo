/**
 * Fixture contract for the meeting-preparation tool.
 *
 * Mirrors the production permission model of the hardening base
 * (convex/profiles/queries.ts, `getProfileByUserIdPublic`): only the public
 * projection fields below may be projected to another participant; age,
 * gender and linkedinUrl are "Sensitive fields excluded for privacy".
 * Visibility to another participant's public projection is tenancy-bounded:
 * self, same org, or a shared meeting. Everyone else is rejected.
 *
 * This file is the single shared vocabulary. The export writer
 * (export.ts) and the independent reader (reader.ts) both reference the
 * concepts defined here; the reader deliberately re-lists its own copies
 * of the enum lists so it never trusts writer code, and the tests
 * cross-check that the two copies agree.
 */

/** Where an agenda item's evidence comes from. */
export const SOURCE_TYPES = [
  "self-profile",
  "peer-public-profile",
  "shared-meeting-context",
  "participant-note",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Fixture-owned shareability. Notes about the other participant may only
 * leave the local workspace when the fixture contract explicitly marks
 * them "shared" (with a contractRationale). The workspace itself has no
 * way to change shareability.
 */
export const SHAREABILITY_LEVELS = ["private", "shared"] as const;
export type Shareability = (typeof SHAREABILITY_LEVELS)[number];

/**
 * Agenda statuses. "proposed" items are suggestions only: agreement is an
 * explicit user action, never inferred, and no outcome is ever promised.
 */
export const AGENDA_STATUSES = ["proposed", "agreed", "set-aside"] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export const OPEN_QUESTION_STATUSES = ["open", "parked"] as const;
export type OpenQuestionStatus = (typeof OPEN_QUESTION_STATUSES)[number];

/**
 * Permitted profile projection, exactly as production returns it from
 * `getProfileByUserIdPublic`: displayName, bio, goals, languages,
 * experience, field, jobTitle, company.
 */
export const PERMITTED_PROFILE_FIELDS = [
  "displayName",
  "bio",
  "goals",
  "languages",
  "experience",
  "field",
  "jobTitle",
  "company",
] as const;
export type PermittedProfileField = (typeof PERMITTED_PROFILE_FIELDS)[number];

/** Sensitive fields production never exposes to another participant. */
export const EXCLUDED_PROFILE_FIELDS = [
  "age",
  "gender",
  "linkedinUrl",
] as const;
export type ExcludedProfileField = (typeof EXCLUDED_PROFILE_FIELDS)[number];

/** Mirrors the app's profile visibility scoping in getProfileByUserIdPublic. */
export const VISIBILITY_BASES = [
  "self",
  "same-org",
  "shared-meeting",
  "none",
] as const;
export type VisibilityBasis = (typeof VISIBILITY_BASES)[number];

/** Full profile shape, mirroring convex/schema/users.ts `profiles` (without Convex ids). */
export type InternalProfile = {
  userId: string;
  displayName: string;
  bio?: string;
  goals?: string;
  languages: string[];
  experience?: string;
  age?: number;
  gender?: "male" | "female" | "non-binary" | "prefer-not-to-say";
  field?: string;
  jobTitle?: string;
  company?: string;
  linkedinUrl?: string;
};

/** What a viewer may hold: only permitted projection fields, ever. */
export type ProjectedProfile = { userId: string } & Pick<
  InternalProfile,
  PermittedProfileField
>;

export type SourceNote = {
  id: string;
  sourceType: SourceType;
  shareability: Shareability;
  subject: "self" | "peer" | "meeting";
  text: string;
  /**
   * Required whenever a note about the peer is marked "shared": the fixture
   * contract's explicit reason for making it shareable.
   */
  contractRationale?: string;
};

/** Mirrors convex/schema/meetings.ts `meetings` (without Convex ids). */
export type MeetingRef = {
  id: string;
  title: string;
  state: "scheduled" | "active" | "concluded" | "cancelled";
  scheduledAt: number;
  durationMinutes: number;
};

/** Exact labels used for agenda statuses everywhere (UI and export). */
export const PROPOSAL_LABEL = "Proposal — suggestion only, not yet agreed";
export const AGREED_LABEL = "Agreed for discussion";
export const SET_ASIDE_LABEL = "Set aside — not proposed right now";

/** Canonical disclaimer carried by every exported preparation document. */
export const DISCLAIMER_TEXT =
  "Agenda topics marked as proposals are suggestions only. " +
  "Agreement is recorded only when each participant explicitly agrees. " +
  "This document records no consent and promises no outcome.";

export function statusLabel(status: AgendaStatus): string {
  switch (status) {
    case "proposed":
      return PROPOSAL_LABEL;
    case "agreed":
      return AGREED_LABEL;
    case "set-aside":
      return SET_ASIDE_LABEL;
  }
}
