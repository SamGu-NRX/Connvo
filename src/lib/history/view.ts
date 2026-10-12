/**
 * Presentation helpers for the after-call meetings UI.
 *
 * Pure functions only: no Convex client, no DOM, no clocks. The Convex
 * payload type comes from the typed bridge (src/lib/history/api.ts) so
 * mapping into the recap builder stays compile-checked.
 */

import type { MeetingHistoryPayload, MeetingState } from "./api";
import { buildRecap, type RecapInput } from "./recap";

/** The full after-call history payload served by getMeetingHistory. */
export type MeetingHistory = MeetingHistoryPayload;

/** Meeting lifecycle states, mirroring the meetings table validator. */
export type { MeetingState };

/** Badge variants available in the repo's Badge component. */
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const STATE_BADGE_VARIANTS: Record<MeetingState, BadgeVariant> = {
  scheduled: "outline",
  active: "secondary",
  concluded: "default",
  cancelled: "destructive",
};

export function meetingStateBadgeVariant(state: MeetingState): BadgeVariant {
  return STATE_BADGE_VARIANTS[state];
}

/**
 * Formats an epoch-ms instant for display. Returns a literal placeholder
 * when no time is recorded — never a fabricated date. Accepts an explicit
 * timeZone so rendering is deterministic where callers need it.
 */
export function formatMeetingDateTime(
  epochMs: number | null | undefined,
  timeZone?: string,
): string {
  if (typeof epochMs !== "number") return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone !== undefined ? { timeZone } : {}),
  }).format(epochMs);
}

/** Only meetings with a scheduled start time export to a calendar. */
export function qualifiesForCalendarExport(meeting: {
  scheduledAt: number | null | undefined;
}): boolean {
  return typeof meeting.scheduledAt === "number";
}

/**
 * Maps the four-state lifecycle onto the exporter's two-state contract:
 * the exporter renders CANCELLED for cancelled meetings and TENTATIVE
 * otherwise.
 */
export function icsExportState(state: MeetingState): "scheduled" | "cancelled" {
  return state === "cancelled" ? "cancelled" : "scheduled";
}

/** Stable, filesystem-safe .ics filename derived from the meeting record. */
export function icsFilename(title: string, meetingId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const base = slug.length > 0 ? slug : "meeting";
  return `connvo-${base}-${meetingId}.ics`;
}

/**
 * The server marks every access failure with an "Access denied" prefix —
 * both "feature disabled" and "not a participant" share it, and neither
 * should offer a retry. Any other error is retryable.
 */
export function isAccessDeniedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Access denied");
}

/**
 * Maps the getMeetingHistory payload into the recap builder's input. The
 * mapping is explicit so a field change on either side fails compile
 * checks instead of silently dropping data.
 */
export function toRecapInput(history: MeetingHistory): RecapInput {
  return {
    meeting: {
      _id: history.meeting._id,
      title: history.meeting.title,
      state: history.meeting.state,
      scheduledAt: history.meeting.scheduledAt ?? null,
      duration: history.meeting.duration ?? null,
      createdAt: history.meeting.createdAt,
    },
    participants: history.participants.map((participant) => ({
      userId: participant.userId,
      displayName: participant.displayName,
      role: participant.role,
      presence: participant.presence,
      joinedAt: participant.joinedAt ?? null,
      leftAt: participant.leftAt ?? null,
    })),
    state: history.state
      ? {
          startedAt: history.state.startedAt ?? null,
          endedAt: history.state.endedAt ?? null,
        }
      : null,
    lifecycleEvents: history.lifecycleEvents.map((event) => ({
      _id: event._id,
      event: event.event,
      timestamp: event.timestamp,
    })),
    notes: history.notes
      ? { content: history.notes.content, version: history.notes.version }
      : null,
    prompts: history.prompts.map((prompt) => ({
      _id: prompt._id,
      content: prompt.content,
      type: prompt.type,
      usedAt: prompt.usedAt ?? null,
      createdAt: prompt.createdAt,
    })),
  };
}

/** Builds the recap for a history payload. */
export function buildMeetingRecap(history: MeetingHistory) {
  return buildRecap(toRecapInput(history));
}
