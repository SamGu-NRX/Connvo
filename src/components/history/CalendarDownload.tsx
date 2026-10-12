"use client";

/**
 * "Add to calendar": the meeting as an .ics file (src/lib/history/ics.ts).
 * A meeting with no scheduled time has nothing to put on a calendar, so the
 * button says why instead of downloading an empty file.
 */
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildCalendarExport } from "@/lib/history/ics";
import type { MeetingHistory } from "./MeetingRecap";

export function calendarFileFor(history: MeetingHistory): string | null {
  const { meeting } = history;
  return buildCalendarExport({
    meetingId: meeting._id,
    title: meeting.title,
    description: meeting.description ?? null,
    scheduledAt: meeting.scheduledAt ?? null,
    durationMs: meeting.duration ?? null,
    state: meeting.state === "cancelled" ? "cancelled" : "scheduled",
    updatedAt: meeting.updatedAt,
  });
}

function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "meeting"}.ics`;
}

export function CalendarDownload({ history }: { history: MeetingHistory }) {
  const ics = calendarFileFor(history);
  if (ics === null) {
    return (
      <p
        data-testid="calendar-unavailable"
        className="text-muted-foreground text-sm"
      >
        No time was set for this meeting, so there is nothing to add to a
        calendar.
      </p>
    );
  }
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([ics], { type: "text/calendar;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(history.meeting.title);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <Button
      data-testid="calendar-download"
      variant="outline"
      onClick={download}
    >
      <CalendarPlus aria-hidden="true" />
      Add to calendar
    </Button>
  );
}
