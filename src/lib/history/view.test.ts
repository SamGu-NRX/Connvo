// @vitest-environment node
/**
 * Unit tests for the after-call presentation helpers in view.ts. The
 * full-payload fixture mirrors the verified getMeetingHistory contract
 * (convex/history/queries.ts at base 87889b81).
 */

import { describe, expect, it } from "vitest";

import {
  buildMeetingRecap,
  formatMeetingDateTime,
  icsExportState,
  icsFilename,
  isAccessDeniedError,
  meetingStateBadgeVariant,
  qualifiesForCalendarExport,
  toRecapInput,
  type MeetingHistory,
} from "./view";

function historyFixture(): MeetingHistory {
  return {
    meeting: {
      _id: "j57fixturemeeting",
      organizerId: "j57host",
      title: "Weekly sync",
      description: "Talk about the roadmap",
      scheduledAt: 1780000000000,
      duration: 1800000,
      state: "concluded",
      createdAt: 1779900000000,
      updatedAt: 1780001000000,
    },
    myRole: "host",
    participants: [
      {
        userId: "j57u1",
        displayName: "Dana Kim",
        role: "host",
        presence: "left",
        joinedAt: 1,
        leftAt: 2,
      },
      {
        userId: "j57u2",
        displayName: null,
        role: "participant",
        presence: "joined",
        joinedAt: 1,
        leftAt: null,
      },
    ],
    state: {
      meetingId: "j57fixturemeeting",
      active: false,
      startedAt: 1780000000000,
      endedAt: 1780001800000,
      topics: [],
      recordingEnabled: false,
      updatedAt: 1780001000000,
    },
    lifecycleEvents: [
      {
        _id: "e1",
        meetingId: "j57fixturemeeting",
        event: "call.started",
        userId: "j57u1",
        success: true,
        metadata: {},
        timestamp: 1780000000500,
        createdAt: 1780000000500,
      },
      {
        _id: "e2",
        meetingId: "j57fixturemeeting",
        event: "recording.started",
        userId: "j57u1",
        success: true,
        metadata: {},
        timestamp: 1780000001000,
        createdAt: 1780000001000,
      },
    ],
    notes: {
      meetingId: "j57fixturemeeting",
      content: "Follow up on pricing",
      version: 3,
      lastRebasedAt: 0,
      updatedAt: 0,
    },
    prompts: [
      {
        _id: "p1",
        meetingId: "j57fixturemeeting",
        content: "Ask about goals",
        type: "precall",
        usedAt: 1780000002000,
        createdAt: 1,
      },
      {
        _id: "p2",
        meetingId: "j57fixturemeeting",
        content: "Share next steps",
        type: "incall",
        usedAt: null,
        createdAt: 2,
      },
    ],
  } as unknown as MeetingHistory;
}

describe("meetingStateBadgeVariant", () => {
  it("maps the four lifecycle states to badge variants", () => {
    expect(meetingStateBadgeVariant("scheduled")).toBe("outline");
    expect(meetingStateBadgeVariant("active")).toBe("secondary");
    expect(meetingStateBadgeVariant("concluded")).toBe("default");
    expect(meetingStateBadgeVariant("cancelled")).toBe("destructive");
  });
});

describe("formatMeetingDateTime", () => {
  it("never fabricates a date for missing times", () => {
    expect(formatMeetingDateTime(null)).toBe("Not scheduled");
    expect(formatMeetingDateTime(undefined)).toBe("Not scheduled");
  });

  it("formats an epoch instant deterministically", () => {
    expect(formatMeetingDateTime(1780000000000, "UTC")).toContain(
      "May 28, 2026",
    );
  });
});

describe("qualifiesForCalendarExport", () => {
  it("is true only with a scheduled time", () => {
    expect(qualifiesForCalendarExport({ scheduledAt: 1 })).toBe(true);
    expect(qualifiesForCalendarExport({ scheduledAt: null })).toBe(false);
    expect(qualifiesForCalendarExport({ scheduledAt: undefined })).toBe(false);
  });
});

describe("icsExportState", () => {
  it("maps the lifecycle onto the exporter's two states", () => {
    expect(icsExportState("cancelled")).toBe("cancelled");
    expect(icsExportState("scheduled")).toBe("scheduled");
    expect(icsExportState("active")).toBe("scheduled");
    expect(icsExportState("concluded")).toBe("scheduled");
  });
});

describe("icsFilename", () => {
  it("is stable and filesystem-safe", () => {
    expect(icsFilename("Weekly Sync!", "j57aaa")).toBe(
      "connvo-weekly-sync-j57aaa.ics",
    );
  });

  it("falls back to a generic base for symbol-only titles", () => {
    expect(icsFilename("///", "j57aaa")).toBe("connvo-meeting-j57aaa.ics");
  });
});

describe("isAccessDeniedError", () => {
  it("recognizes the server's access-denied prefix", () => {
    expect(
      isAccessDeniedError(
        new Error("Access denied: After-call history is disabled"),
      ),
    ).toBe(true);
    expect(
      isAccessDeniedError(new Error("Access denied: Not a meeting participant")),
    ).toBe(true);
    expect(isAccessDeniedError(new Error("Connection lost"))).toBe(false);
    expect(isAccessDeniedError("Access denied: nope")).toBe(false);
  });
});

describe("toRecapInput and buildMeetingRecap", () => {
  it("maps the history payload into the recap input", () => {
    const input = toRecapInput(historyFixture());
    expect(input.meeting.title).toBe("Weekly sync");
    expect(input.meeting.scheduledAt).toBe(1780000000000);
    expect(input.participants[0]?.presence).toBe("left");
    expect(input.state?.startedAt).toBe(1780000000000);
    expect(input.notes?.version).toBe(3);
    expect(input.prompts).toHaveLength(2);
  });

  it("builds the extractive recap end to end", () => {
    const recap = buildMeetingRecap(historyFixture());
    expect(recap.sections.map((section) => section.kind)).toEqual([
      "participants",
      "duration",
      "lifecycleEvents",
      "notes",
      "prompts-used",
      "prompts-served",
    ]);
    expect(recap.sections[0]?.items).toEqual([
      "Dana Kim (host)",
      "j57u2 (participant)",
    ]);
    expect(recap.sections[1]?.items).toEqual(["30 minutes"]);
    expect(recap.sections[2]?.items).toEqual([
      "call.started \u00d71",
      "recording.started \u00d71",
    ]);
    expect(recap.sections[3]?.items).toEqual([
      "Follow up on pricing (version 3)",
    ]);
    expect(recap.sections[4]?.items).toEqual(["Ask about goals"]);
    expect(recap.sections[5]?.items).toEqual(["Share next steps"]);
    expect(recap.sources).toEqual({
      participants: true,
      duration: true,
      lifecycleEvents: true,
      notes: true,
      prompts: true,
    });
  });
});
