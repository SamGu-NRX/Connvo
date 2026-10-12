"use client";

import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import { isAfterCallEnabled } from "@/lib/featureFlags";
import { historyQueries } from "@/lib/history/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryErrorBoundary } from "@/components/history/HistoryErrorBoundary";
import {
  formatMeetingDateTime,
  meetingStateBadgeVariant,
} from "@/lib/history/view";

const INITIAL_PAGE_SIZE = 10;

export default function MeetingsPage() {
  // Candidate feature gate: with the flag off the surface does not exist.
  // isAfterCallEnabled reads the env var on every render, so no hooks
  // precede this check.
  if (!isAfterCallEnabled()) {
    return null;
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <HistoryErrorBoundary label="meeting history">
        <MeetingsList />
      </HistoryErrorBoundary>
    </div>
  );
}

function MeetingsList() {
  const { results, status, loadMore } = usePaginatedQuery(
    historyQueries.listMyMeetings,
    {},
    { initialNumItems: INITIAL_PAGE_SIZE },
  );

  if (status === "LoadingFirstPage") {
    return <MeetingsListSkeleton />;
  }

  if (results.page.length === 0) {
    return <EmptyMeetings />;
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold text-emerald-900 dark:text-emerald-200">
        Meetings
      </h1>
      <ul className="mt-6 space-y-3" data-testid="meeting-list">
        {results.page.map((item) => (
          <li key={item.meeting._id}>
            <Link
              href={`/app/meetings/${item.meeting._id}`}
              className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              data-testid="meeting-list-item"
            >
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.meeting.title}</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {item.meeting.scheduledAt !== null
                        ? formatMeetingDateTime(item.meeting.scheduledAt)
                        : `Created ${formatMeetingDateTime(item.meeting.createdAt)}`}
                    </p>
                  </div>
                  <Badge variant={meetingStateBadgeVariant(item.meeting.state)}>
                    {item.meeting.state}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button
          variant="outline"
          className="mt-4"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(INITIAL_PAGE_SIZE)}
          data-testid="load-more"
        >
          {status === "LoadingMore" ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}

function MeetingsListSkeleton() {
  return (
    <div aria-busy="true" role="status" data-testid="meetings-loading">
      <Skeleton className="h-9 w-40" />
      <div className="mt-6 space-y-3">
        {["skeleton-1", "skeleton-2", "skeleton-3", "skeleton-4"].map((key) => (
          <Skeleton key={key} className="h-20 w-full rounded-md" />
        ))}
      </div>
      <span className="sr-only">Loading meetings…</span>
    </div>
  );
}

function EmptyMeetings() {
  return (
    <div data-testid="meetings-empty">
      <h1 className="text-3xl font-semibold text-emerald-900 dark:text-emerald-200">
        Meetings
      </h1>
      <Card className="mt-6">
        <CardContent className="py-10 text-center">
          <p className="font-medium">No meetings yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Meetings you host or join on Connvo will appear here after your
            calls.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/app/dashboard">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
