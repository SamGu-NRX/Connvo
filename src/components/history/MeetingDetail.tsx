"use client";

/**
 * One meeting after the fact: when it was, the recap of what it recorded,
 * a calendar file, and the stay-in-touch choice.
 */
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDownload } from "./CalendarDownload";
import { HistoryBoundary } from "./HistoryBoundary";
import { formatMeetingTime } from "./MeetingList";
import { MeetingRecapSkeleton, MeetingRecapView } from "./MeetingRecap";
import { PostCallPrompts } from "./PostCallPrompts";
import { StayInTouch } from "./StayInTouch";
import { SIGNED_OUT_MESSAGE, useHistoryAuth } from "./useHistoryAuth";

const STATE_LABEL = {
  scheduled: "Scheduled",
  active: "In progress",
  concluded: "Ended",
  cancelled: "Cancelled",
} as const;

function MeetingDetailData({ meetingId }: { meetingId: Id<"meetings"> }) {
  const auth = useHistoryAuth();
  const history = useQuery(
    api.history.queries.getMeetingHistory,
    auth === "ready" ? { meetingId } : "skip",
  );
  if (auth === "signed-out")
    return (
      <p
        data-testid="history-signed-out"
        className="text-muted-foreground text-sm"
      >
        {SIGNED_OUT_MESSAGE}
      </p>
    );
  if (history === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardContent>
            <MeetingRecapSkeleton />
          </CardContent>
        </Card>
      </div>
    );
  }
  const { meeting } = history;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {meeting.title}
          </h1>
          <Badge variant="outline">{STATE_LABEL[meeting.state]}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {formatMeetingTime(meeting.scheduledAt ?? null)}
        </p>
        <div className="pt-1">
          <CalendarDownload history={history} />
        </div>
      </header>
      <Card>
        <CardContent>
          <MeetingRecapView history={history} />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <PostCallPrompts meetingId={meetingId} />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <StayInTouch meetingId={meetingId} />
        </CardContent>
      </Card>
    </div>
  );
}

export function MeetingDetail({ meetingId }: { meetingId: Id<"meetings"> }) {
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/app/meetings"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex w-fit items-center gap-1 rounded-sm text-sm outline-none focus-visible:ring-[3px]"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All meetings
      </Link>
      <HistoryBoundary>
        <MeetingDetailData meetingId={meetingId} />
      </HistoryBoundary>
    </div>
  );
}
