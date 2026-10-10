import { writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENDA_STATUSES,
  EXCLUDED_PROFILE_FIELDS,
  PERMITTED_PROFILE_FIELDS,
  SHAREABILITY_LEVELS,
  SOURCE_TYPES,
  VISIBILITY_BASES,
} from "../src/contract";
import {
  FIXTURE_COUNTS,
  FIXTURE_NOW,
  INITIAL_AGENDA,
  INTERNAL_PROFILES,
  PEER_ID,
  STRANGER_ID,
  SYNTHETIC_MEETINGS,
  SYNTHETIC_PARTICIPANTS,
  VIEWER_ID,
  VISIBILITY_GRANTS,
} from "../src/fixtures";

describe("fixture contract — exact state counts", () => {
  it("binds exactly one synthetic meeting, in state 'scheduled' and in the future", () => {
    expect(FIXTURE_COUNTS.meetings).toBe(1);
    expect(SYNTHETIC_MEETINGS).toHaveLength(1);
    const meeting = SYNTHETIC_MEETINGS[0]!;
    expect(meeting.id).toBe("mtg_synth_001");
    expect(meeting.state).toBe("scheduled");
    expect(meeting.scheduledAt).toBeGreaterThan(FIXTURE_NOW);
  });

  it("binds exactly two invited participants with production roles", () => {
    expect(FIXTURE_COUNTS.meetingParticipants).toBe(2);
    expect(SYNTHETIC_PARTICIPANTS).toHaveLength(2);
    for (const p of SYNTHETIC_PARTICIPANTS) {
      expect(p.meetingId).toBe("mtg_synth_001");
      expect(p.presence).toBe("invited");
      expect(["host", "participant"]).toContain(p.role);
    }
    expect(SYNTHETIC_PARTICIPANTS.map((p) => p.userId)).toEqual([VIEWER_ID, PEER_ID]);
  });

  it("carries exactly two internal profiles (viewer and peer)", () => {
    expect(FIXTURE_COUNTS.internalProfiles).toBe(2);
    expect(INTERNAL_PROFILES).toHaveLength(2);
    expect(INTERNAL_PROFILES.map((p) => p.userId)).toEqual([VIEWER_ID, PEER_ID]);
  });

  it("carries exactly three explicit visibility grants (self, shared-meeting, none)", () => {
    expect(FIXTURE_COUNTS.visibilityGrants).toBe(3);
    expect(VISIBILITY_GRANTS).toHaveLength(3);
    expect(VISIBILITY_GRANTS.map((g) => g.basis)).toEqual([
      "self",
      "shared-meeting",
      "none",
    ]);
    // The stranger has no basis at all: not self, not tenancy-bounded.
    expect(VISIBILITY_GRANTS.find((g) => g.viewerId === STRANGER_ID)?.basis).toBe("none");
  });

  it("starts with exactly three agenda items, all 'proposed' (suggestions only)", () => {
    expect(FIXTURE_COUNTS.agendaItems).toBe(3);
    expect(INITIAL_AGENDA).toHaveLength(3);
    for (const item of INITIAL_AGENDA) {
      expect(item.status).toBe("proposed");
    }
  });

  it("carries exactly six source notes: three private, three shareable", () => {
    expect(FIXTURE_COUNTS.sourceNotes).toBe(6);
    const notes = INITIAL_AGENDA.flatMap((item) => item.notes);
    expect(notes).toHaveLength(6);
    expect(notes.filter((n) => n.shareability === "private")).toHaveLength(3);
    expect(notes.filter((n) => n.shareability === "shared")).toHaveLength(3);
    expect(FIXTURE_COUNTS.sourceNotesPrivate).toBe(3);
    expect(FIXTURE_COUNTS.sourceNotesShareable).toBe(3);
  });
});

describe("fixture contract — source types used", () => {
  it("uses exactly these four source types, in order", () => {
    expect(SOURCE_TYPES).toEqual([
      "self-profile",
      "peer-public-profile",
      "shared-meeting-context",
      "participant-note",
    ]);
  });

  it("exercises every source type at least once in the fixture agenda", () => {
    const notes = INITIAL_AGENDA.flatMap((item) => item.notes);
    for (const note of notes) {
      expect(SOURCE_TYPES).toContain(note.sourceType);
    }
    expect(new Set(notes.map((n) => n.sourceType)).size).toBe(SOURCE_TYPES.length);
  });

  it("keeps every participant-note about the peer private, and rationale-marks the one shared peer note", () => {
    const notes = INITIAL_AGENDA.flatMap((item) => item.notes);
    for (const note of notes) {
      if (note.subject === "peer" && note.shareability === "shared") {
        // The fixture contract must explicitly make a peer note shareable.
        expect(typeof note.contractRationale).toBe("string");
        expect(note.contractRationale!.length).toBeGreaterThan(0);
        expect(note.sourceType).toBe("peer-public-profile");
      }
    }
    const privatePeerNotes = notes.filter(
      (n) => n.subject === "peer" && n.shareability === "private",
    );
    expect(privatePeerNotes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("fixture contract — permission vocabulary", () => {
  it("permits exactly the production public-projection fields", () => {
    expect(PERMITTED_PROFILE_FIELDS).toEqual([
      "displayName",
      "bio",
      "goals",
      "languages",
      "experience",
      "field",
      "jobTitle",
      "company",
    ]);
  });

  it("excludes exactly the production-sensitive fields", () => {
    expect(EXCLUDED_PROFILE_FIELDS).toEqual(["age", "gender", "linkedinUrl"]);
    // Disjointness of the two lists is part of the contract.
    for (const excluded of EXCLUDED_PROFILE_FIELDS) {
      expect(PERMITTED_PROFILE_FIELDS).not.toContain(excluded);
    }
  });

  it("defines shareability, agenda statuses, question statuses, and visibility bases", () => {
    expect(SHAREABILITY_LEVELS).toEqual(["private", "shared"]);
    expect(AGENDA_STATUSES).toEqual(["proposed", "agreed", "set-aside"]);
    expect(VISIBILITY_BASES).toEqual(["self", "same-org", "shared-meeting", "none"]);
  });
});

describe("fixture contract — committed evidence", () => {
  it("writes results/fixture-inventory.json with the exact counts and source types", () => {
    const notes = INITIAL_AGENDA.flatMap((item) => item.notes);
    const inventory = {
      generatedBy: "tools/meeting-preparation tests/fixtures.test.ts",
      counts: { ...FIXTURE_COUNTS },
      sourceTypes: [...SOURCE_TYPES],
      permittedProfileFields: [...PERMITTED_PROFILE_FIELDS],
      excludedProfileFields: [...EXCLUDED_PROFILE_FIELDS],
      agendaStatuses: [...AGENDA_STATUSES],
      shareabilityLevels: [...SHAREABILITY_LEVELS],
      visibilityBases: [...VISIBILITY_BASES],
      sourceTypeUsage: Object.fromEntries(
        SOURCE_TYPES.map((t) => [t, notes.filter((n) => n.sourceType === t).length]),
      ),
    };
    mkdirSync(new URL("../results", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../results/fixture-inventory.json", import.meta.url),
      JSON.stringify(inventory, null, 2) + "\n",
    );
    expect(inventory.counts.sourceNotes).toBe(
      Object.values(inventory.sourceTypeUsage).reduce<number>((a, b) => a + b, 0),
    );
  });
});
