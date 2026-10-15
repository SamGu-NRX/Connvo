"use client";

/**
 * The signed-in person's meetings, newest first by meeting time. Pages come
 * from listMyMeetings, which reads a bounded slice of meetings per call and
 * can return a short page that is not the end; this keeps asking until it
 * has a screenful or the list is done.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryBoundary } from "./HistoryBoundary";
import { formatRecordedDuration } from "@/lib/history/duration";
import { SIGNED_OUT_MESSAGE, useHistoryAuth } from "./useHistoryAuth";

const PAGE = 20;
/** Short pages fetched by themselves before the list asks the person to load more. */
const AUTO_FETCHES = 5;

type Item = FunctionReturnType<
  typeof api.history.queries.listMyMeetings
>["page"][number];

const STATE_LABEL: Record<Item["meeting"]["state"], string> = {
  scheduled: "Scheduled",
  active: "In progress",
  concluded: "Ended",
  cancelled: "Cancelled",
};

export function formatMeetingTime(at: number | null): string {
  if (at === null) return "No time set";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export function MeetingListRows({ items }: { items: Item[] }) {
  return (
    <ul
      data-testid="meeting-list"
      className="divide-border flex flex-col divide-y rounded-md border"
    >
      {items.map((item) => (
        <li key={item.meeting._id}>
          <Link
            href={`/app/meetings/${item.meeting._id}`}
            className="hover:bg-muted/50 focus-visible:ring-ring/50 flex items-center gap-3 px-4 py-3 outline-none focus-visible:ring-[3px]"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{item.meeting.title}</span>
              <span className="text-muted-foreground text-sm">
                {formatMeetingTime(item.meeting.scheduledAt)}
                {item.role === "host" ? " · You hosted" : ""}
                {formatRecordedDuration(item.startedAt, item.endedAt)
                  ? ` · ${formatRecordedDuration(item.startedAt, item.endedAt)}`
                  : ""}
              </span>
            </span>
            <Badge variant="outline">{STATE_LABEL[item.meeting.state]}</Badge>
            <ChevronRight
              aria-hidden="true"
              className="text-muted-foreground size-4"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MeetingListSkeleton() {
  return (
    <div
      data-testid="meeting-list-loading"
      aria-busy="true"
      className="flex flex-col divide-y rounded-md border"
    >
      <span className="sr-only">Loading your meetings…</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-2 px-4 py-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function MeetingListData() {
  const auth = useHistoryAuth();
  const { results, status, loadMore } = usePaginatedQuery(
    api.history.queries.listMyMeetings,
    auth === "ready" ? {} : "skip",
    { initialNumItems: PAGE },
  );
  const autoFetches = useRef(0);
  useEffect(() => {
    if (
      status === "CanLoadMore" &&
      results.length < PAGE &&
      autoFetches.current < AUTO_FETCHES
    ) {
      autoFetches.current++;
      loadMore(PAGE);
    }
  }, [status, results.length, loadMore]);

  if (auth === "signed-out")
    return (
      <p
        data-testid="history-signed-out"
        className="text-muted-foreground text-sm"
      >
        {SIGNED_OUT_MESSAGE}
      </p>
    );
  const settling =
    auth === "loading" ||
    status === "LoadingFirstPage" ||
    (results.length === 0 &&
      (status === "LoadingMore" ||
        (status === "CanLoadMore" && autoFetches.current < AUTO_FETCHES)));
  if (settling) return <MeetingListSkeleton />;
  if (results.length === 0) {
    return (
      <div
        data-testid="meeting-list-empty"
        className="flex flex-col items-start gap-2 rounded-md border p-6"
      >
        <p className="font-medium">No meetings yet</p>
        <p className="text-muted-foreground text-sm">
          Meetings you take part in show up here, with what each one recorded.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <MeetingListRows items={results} />
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button
          variant="outline"
          className="self-center"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(PAGE)}
        >
          {status === "LoadingMore" ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}

export function MeetingList() {
  return (
    <HistoryBoundary>
      <MeetingListData />
    </HistoryBoundary>
  );
}
