/**
 * Synthetic fixtures — no real people, no real data.
 *
 * All identifiers are clearly synthetic, all URLs use the reserved
 * .example TLD, and every timestamp is a fixed constant so "upcoming"
 * is asserted fixture-vs-fixture and stays deterministic forever.
 */
import type {
  InternalProfile,
  MeetingRef,
  SourceNote,
  VisibilityBasis,
} from "./contract";

/** Fixed synthetic clock: 2026-10-08T12:00:00Z. */
export const FIXTURE_NOW = 1791460800000;

/** Fixed synthetic upcoming meeting: 2026-10-14T14:00:00Z, state "scheduled". */
export const SYNTHETIC_MEETINGS: MeetingRef[] = [
  {
    id: "mtg_synth_001",
    title: "Synthetic intro call — agenda preparation",
    state: "scheduled",
    scheduledAt: 1791986400000,
    durationMinutes: 30,
  },
];

export const VIEWER_ID = "u_synth_viewer_riley";
export const PEER_ID = "u_synth_peer_noor";
export const STRANGER_ID = "u_synth_stranger_kai";

/** Mirrors convex/schema/meetings.ts `meetingParticipants` (without Convex ids). */
export type MeetingParticipant = {
  meetingId: string;
  userId: string;
  role: "host" | "participant" | "observer";
  presence: "invited" | "joined" | "left";
};

export const SYNTHETIC_PARTICIPANTS: MeetingParticipant[] = [
  { meetingId: "mtg_synth_001", userId: VIEWER_ID, role: "host", presence: "invited" },
  { meetingId: "mtg_synth_001", userId: PEER_ID, role: "participant", presence: "invited" },
];

/**
 * Internal profiles carrying sensitive fields (age, gender, linkedinUrl).
 * These are the fields the permitted projection must never let through.
 */
export const INTERNAL_PROFILES: InternalProfile[] = [
  {
    userId: VIEWER_ID,
    displayName: "Riley Chen",
    bio: "Synthetic viewer profile (fixture data, not a real person).",
    goals: "Keep calls short and agenda-led",
    languages: ["en", "de"],
    experience: "5 years synthetic product work",
    age: 34,
    gender: "non-binary",
    field: "product",
    jobTitle: "Product designer",
    company: "Example Synthetics",
    linkedinUrl: "https://linkedin.example/in/riley-synth",
  },
  {
    userId: PEER_ID,
    displayName: "Noor Haddad",
    bio: "Synthetic peer profile (fixture data, not a real person).",
    goals: "Compare notes on onboarding flows",
    languages: ["en", "ar"],
    experience: "8 years synthetic engineering",
    age: 41,
    gender: "female",
    field: "engineering",
    jobTitle: "Staff engineer",
    company: "Example Synthetics",
    linkedinUrl: "https://linkedin.example/in/noor-synth",
  },
];

/**
 * Explicit visibility grants mirroring production's tenancy scoping:
 * the viewer sees themself ("self") and the peer via the shared meeting
 * ("shared-meeting"); a stranger sees nothing ("none").
 */
export type VisibilityGrant = {
  viewerId: string;
  targetId: string;
  basis: VisibilityBasis;
  meetingId?: string;
};

export const VISIBILITY_GRANTS: VisibilityGrant[] = [
  { viewerId: VIEWER_ID, targetId: VIEWER_ID, basis: "self" },
  { viewerId: VIEWER_ID, targetId: PEER_ID, basis: "shared-meeting", meetingId: "mtg_synth_001" },
  { viewerId: STRANGER_ID, targetId: PEER_ID, basis: "none" },
];

/**
 * Initial agenda: all items start "proposed" — suggestions only.
 * Notes with shareability "private" must never leave the workspace;
 * the single peer-facing "shared" note carries an explicit
 * contractRationale (peer-public-profile is public by construction).
 */
export type InitialAgendaItem = {
  id: string;
  title: string;
  status: "proposed";
  notes: SourceNote[];
};

export const INITIAL_AGENDA: InitialAgendaItem[] = [
  {
    id: "agenda_1",
    title: "Warm-up: what each of us wants from this call",
    status: "proposed",
    notes: [
      {
        id: "note_1",
        sourceType: "self-profile",
        shareability: "shared",
        subject: "self",
        text: "Riley's own profile goal: keep calls short and agenda-led.",
      },
      {
        id: "note_2",
        sourceType: "peer-public-profile",
        shareability: "shared",
        subject: "peer",
        contractRationale: "Sourced exclusively from the peer's permitted public projection.",
        text: "Noor's public goal: compare notes on onboarding flows.",
      },
    ],
  },
  {
    id: "agenda_2",
    title: "Compare onboarding flows",
    status: "proposed",
    notes: [
      {
        id: "note_3",
        sourceType: "participant-note",
        shareability: "private",
        subject: "peer",
        text: "Private recollection: Noor mentioned preferring short calls.",
      },
      {
        id: "note_4",
        sourceType: "shared-meeting-context",
        shareability: "shared",
        subject: "meeting",
        text: "Both participants are invited to the synthetic meeting mtg_synth_001.",
      },
    ],
  },
  {
    id: "agenda_3",
    title: "Agree what, if anything, happens after the call",
    status: "proposed",
    notes: [
      {
        id: "note_5",
        sourceType: "participant-note",
        shareability: "private",
        subject: "peer",
        text: "Private: check with Noor directly before assuming any follow-up.",
      },
      {
        id: "note_6",
        sourceType: "self-profile",
        shareability: "private",
        subject: "self",
        text: "Private: Riley is still practising agenda-setting.",
      },
    ],
  },
];

/** Exact fixture counts, asserted by tests and committed as evidence. */
export const FIXTURE_COUNTS = {
  meetings: 1,
  meetingParticipants: 2,
  internalProfiles: 2,
  visibilityGrants: 3,
  agendaItems: 3,
  sourceNotes: 6,
  sourceNotesPrivate: 3,
  sourceNotesShareable: 3,
} as const;
