"use client";

/**
 * The upcoming confirmed chat (docs/plan/MATCHING-PLAN.md, step 6): a live
 * countdown, the partner and the first question, "Add to calendar" reusing
 * the existing .ics builder (src/lib/history/ics.ts), and the join button —
 * disabled until five minutes before the start, then linking into the call
 * lobby. Once the meeting is over (start + 30 minutes) the home query stops
 * serving it, so the card never needs an ended state.
 */

import Link from "next/link";
import { CalendarPlus, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildCalendarExport } from "@/lib/history/ics";
import { generateAvatarColor, getInitials } from "@/lib/avatar-utils";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { formatCountdown, type useNow } from "./useCountdown";

export type Upcoming = FunctionReturnType<
  typeof api.matching.home.myHomeView
>["upcoming"];

function icsFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "connvo-chat"}.ics`;
}

export function UpcomingChatCard({
  upcoming,
  now,
}: {
  upcoming: NonNullable<Upcoming>;
  now: ReturnType<typeof useNow>;
}) {
  const color = generateAvatarColor(upcoming.partnerUserId);
  const initials = getInitials(upcoming.partnerName);
  const firstName = upcoming.partnerName.split(" ")[0];
  const joinOpen = now >= upcoming.joinOpensAt;
  const inProgress = now >= upcoming.scheduledAt;

  const download = () => {
    const ics = buildCalendarExport({
      meetingId: upcoming.meetingId,
      title: `Connvo: you & ${upcoming.partnerName}`,
      description: `Suggested first question: ${upcoming.firstQuestion}`,
      scheduledAt: upcoming.scheduledAt,
      durationMs: upcoming.endsAt - upcoming.scheduledAt,
      state: "scheduled",
      updatedAt: now,
    });
    if (ics === null) return;
    const url = URL.createObjectURL(
      new Blob([ics], { type: "text/calendar;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = icsFileName(`Connvo you and ${upcoming.partnerName}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      data-testid="upcoming-card"
      className="rounded-sm border border-surface bg-white/95 px-4 py-4 dark:bg-emerald-950/40"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300/80">
        {inProgress ? "In progress" : "Your next conversation is confirmed"}
      </p>

      <div className="mt-3 flex items-center gap-4">
        <div
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold bg-linear-to-br ${color.from} ${color.to} ${color.text}`}
        >
          {initials}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-emerald-900 dark:text-white">
            {upcoming.partnerName}
          </h2>
          <p
            data-testid="upcoming-countdown"
            className="text-sm font-medium text-emerald-700 tabular-nums dark:text-emerald-200"
          >
            {inProgress
              ? "Started — you can still join"
              : `in ${formatCountdown(upcoming.scheduledAt - now)}`}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm text-emerald-900/80 dark:text-emerald-100/80">
        {upcoming.scheduledAtLocal} · your timezone
      </p>
      <p className="mt-2 text-sm text-emerald-900/70 dark:text-emerald-100/70">
        <span className="font-semibold text-emerald-900 dark:text-emerald-100">
          Open with:{" "}
        </span>
        <span className="italic">“{upcoming.firstQuestion}”</span>
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          data-testid="join-upcoming"
          disabled={!joinOpen}
          asChild={joinOpen}
          className="flex-1 rounded-sm bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-emerald-600 disabled:opacity-50"
        >
          {joinOpen ? (
            <Link href={`/app/call/${upcoming.meetingId}`}>
              <Video aria-hidden="true" />
              {inProgress ? `Join ${firstName} now` : "Join the lobby"}
            </Link>
          ) : (
            <span aria-disabled="true">
              Joining opens {formatCountdown(upcoming.joinOpensAt - now)} before
              the start
            </span>
          )}
        </Button>
        <Button
          data-testid="add-to-calendar"
          variant="outline"
          onClick={download}
          className="rounded-sm border border-surface bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/80 transition-colors duration-200 hover:bg-emerald-50/60 dark:bg-emerald-950/50 dark:text-emerald-100/80 dark:hover:bg-emerald-900/60"
        >
          <CalendarPlus aria-hidden="true" />
          Add to calendar
        </Button>
      </div>
    </section>
  );
}
