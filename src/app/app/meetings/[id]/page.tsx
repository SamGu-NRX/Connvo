"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { historyMutations, historyQueries } from "@/lib/history/api";
import type { Id } from "@convex/_generated/dataModel";
import { isAfterCallEnabled } from "@/lib/featureFlags";
import { buildCalendarExport } from "@/lib/history/ics";
import { downloadTextFile } from "@/lib/history/download";
import {
  buildMeetingRecap,
  formatMeetingDateTime,
  icsExportState,
  icsFilename,
  meetingStateBadgeVariant,
  qualifiesForCalendarExport,
} from "@/lib/history/view";
import { HistoryErrorBoundary } from "@/components/history/HistoryErrorBoundary";
import { MeetingRecap } from "@/components/history/MeetingRecap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  // Candidate feature gate: with the flag off the surface does not exist.
  if (!isAfterCallEnabled()) {
    return null;
  }
  const rawId = typeof params?.id === "string" ? params.id : "";
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <HistoryErrorBoundary label="the meeting history">
        {rawId.length > 0 ? (
          // The Convex function's validator checks the id at runtime; a
          // malformed id surfaces the same honest error state as any other
          // failure.
          <MeetingDetail meetingId={rawId as Id<"meetings">} />
        ) : null}
      </HistoryErrorBoundary>
    </div>
  );
}

type SetStayInTouch = (args: {
  meetingId: Id<"meetings">;
  enabled: boolean;
}) => Promise<unknown>;

/** Records the opt-in and surfaces the outcome via toast; never silent. */
async function changeStayInTouch(
  setStayInTouch: SetStayInTouch,
  meetingId: Id<"meetings">,
  enabled: boolean,
): Promise<void> {
  try {
    await setStayInTouch({ meetingId, enabled });
    toast.success(enabled ? "Marked to stay in touch" : "Removed stay-in-touch");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(`Couldn't update stay-in-touch: ${message}`);
  }
}

function MeetingDetail({ meetingId }: { meetingId: Id<"meetings"> }) {
  const history = useQuery(historyQueries.getMeetingHistory, {
    meetingId,
  });
  const stayInTouchStatus = useQuery(
    historyQueries.getStayInTouchStatus,
    { meetingId },
  );
  const setStayInTouch = useMutation(historyMutations.setStayInTouch);
  const [savingOptIn, setSavingOptIn] = useState(false);

  if (history === undefined) {
    return <MeetingDetailSkeleton />;
  }

  const recap = buildMeetingRecap(history);
  const canExport = qualifiesForCalendarExport(history.meeting);

  const handleOptInChange = (enabled: boolean): void => {
    setSavingOptIn(true);
    changeStayInTouch(setStayInTouch, meetingId, enabled).finally(() =>
      setSavingOptIn(false),
    );
  };

  const handleDownloadIcs = (): void => {
    const ics = buildCalendarExport({
      meetingId: history.meeting._id,
      title: history.meeting.title,
      description: history.meeting.description ?? null,
      scheduledAt: history.meeting.scheduledAt ?? null,
      durationMs: history.meeting.duration ?? null,
      state: icsExportState(history.meeting.state),
      updatedAt: history.meeting.updatedAt,
    });
    if (ics === null) return;
    downloadTextFile(
      icsFilename(history.meeting.title, history.meeting._id),
      ics,
      "text/calendar",
    );
  };

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/app/meetings">Back to meetings</Link>
      </Button>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1
          className="text-3xl font-semibold text-emerald-900 dark:text-emerald-200"
          data-testid="meeting-detail-title"
        >
          {history.meeting.title}
        </h1>
        <Badge variant={meetingStateBadgeVariant(history.meeting.state)}>
          {history.meeting.state}
        </Badge>
      </div>
      <p className="text-muted-foreground mt-2 text-sm">
        {history.meeting.scheduledAt !== null
          ? `Scheduled ${formatMeetingDateTime(history.meeting.scheduledAt)}`
          : `Created ${formatMeetingDateTime(history.meeting.createdAt)}`}
        {" · "}
        Joined as {history.myRole}
      </p>

      {canExport ? (
        <Button
          variant="outline"
          className="mt-4"
          onClick={handleDownloadIcs}
          data-testid="download-ics"
        >
          Download calendar (.ics)
        </Button>
      ) : null}

      <Separator className="my-6" />

      <MeetingRecap recap={recap} />

      <Separator className="my-6" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stay in touch</CardTitle>
        </CardHeader>
        <CardContent>
          {stayInTouchStatus === undefined ? (
            <Skeleton className="h-6 w-64" />
          ) : (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="stay-in-touch" className="text-sm font-normal">
                Ask to exchange contact details with everyone from this
                meeting
              </Label>
              <Switch
                id="stay-in-touch"
                checked={stayInTouchStatus.enabled}
                disabled={savingOptIn}
                onCheckedChange={handleOptInChange}
                data-testid="stay-in-touch-switch"
              />
            </div>
          )}
          {stayInTouchStatus?.mutual ? (
            <p
              className="text-muted-foreground mt-3 text-sm"
              data-testid="stay-in-touch-mutual"
            >
              Everyone in this meeting has opted in to stay in touch.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MeetingDetailSkeleton() {
  return (
    <div aria-busy="true" role="status" data-testid="meeting-detail-loading">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="mt-4 h-9 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-8 space-y-6">
        {["recap-1", "recap-2", "recap-3"].map((key) => (
          <div key={key}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-4 w-3/4" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading meeting history…</span>
    </div>
  );
}
