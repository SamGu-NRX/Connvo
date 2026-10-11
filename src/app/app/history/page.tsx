"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EmptyHistory,
  ListSkeleton,
  MeetingStateBadge,
  RecoverableErrorPanel,
  UniformUnavailable,
} from "./components";
import { formatMeetingDate } from "./format";
import { FIXTURE_QUERY_FLAG } from "./fixtureTransport";
import { HistoryTransportProvider, useHistoryResource, useHistoryTransport } from "./useHistoryTransport";
import {
  buildListSearchParams,
  DEFAULT_LIST_QUERY,
  HISTORY_STATE_FILTERS,
  parseListQuery,
  selectVisibleMeetings,
  type ListQuery,
} from "./listQuery";
import type { MeetingStateFilter } from "./types";

const LIST_STORAGE_KEY = "connvo-history:list-query";

function ListInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();
  const { transport, isFixture } = useHistoryTransport();
  const query = useMemo(() => parseListQuery(searchParams), [searchParams]);

  const [draftQ, setDraftQ] = useState(query.q);
  useEffect(() => {
    setDraftQ(query.q);
  }, [query.q]);

  const load = useCallback(
    () => transport.listMeetings({ state: query.state === "all" ? undefined : query.state, limit: 200 }),
    [transport, query.state],
  );
  const resource = useHistoryResource(load, [transport, query.state]);

  const updateQuery = useCallback(
    (patch: Partial<ListQuery>) => {
      const next = { ...query, ...patch };
      const qs = buildListSearchParams(next).toString();
      const fixtureSuffix = isFixture ? (qs ? "&" : "?") + FIXTURE_QUERY_FLAG + "=1" : "";
      router.replace("/app/history" + (qs ? "?" + qs : "") + fixtureSuffix, { scroll: false });
    },
    [query, router, isFixture],
  );

  // Debounce search input into the URL (resets pagination).
  useEffect(() => {
    if (draftQ === query.q) return;
    const handle = setTimeout(() => updateQuery({ q: draftQ, page: 1 }), 250);
    return () => clearTimeout(handle);
  }, [draftQ, query.q, updateQuery]);

  // Persist position; restore it when arriving with a bare URL (e.g. from Back).
  const restoredRef = useRef(false);
  const pendingScrollRef = useRef<number | null>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        LIST_STORAGE_KEY,
        JSON.stringify({ ...query, scrollY: pendingScrollRef.current ?? window.scrollY }),
      );
    } catch {
      // storage unavailable - position restore is best-effort
    }
  }, [query]);
  useEffect(() => {
    if (restoredRef.current || searchParams.toString().length > 0) return;
    restoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(LIST_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<ListQuery> & { scrollY?: number };
      pendingScrollRef.current = typeof parsed.scrollY === "number" ? parsed.scrollY : null;
      if (parsed.q || parsed.state !== undefined || (parsed.page ?? 1) > 1) {
        updateQuery({ q: parsed.q ?? "", state: parsed.state ?? DEFAULT_LIST_QUERY.state, page: parsed.page ?? 1 });
      }
    } catch {
      // ignore malformed saved state
    }
  }, [searchParams, updateQuery]);

  const visible = useMemo(
    () => (resource.status === "ready" ? selectVisibleMeetings(resource.data, query) : null),
    [resource, query],
  );

  // Restore scroll once the list is ready again.
  useEffect(() => {
    if (visible && pendingScrollRef.current !== null) {
      window.scrollTo(0, pendingScrollRef.current);
      pendingScrollRef.current = null;
    }
  }, [visible]);

  const rememberScroll = useCallback(() => {
    pendingScrollRef.current = window.scrollY;
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">Meetings you took part in, newest first.</p>
        </div>
        {isFixture ? (
          <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-300">
            Local fixture transport - synthetic data
          </Badge>
        ) : null}
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2" role="search">
        <Input
          type="search"
          aria-label="Search your meetings"
          placeholder="Search title or description"
          value={draftQ}
          onChange={(event) => setDraftQ(event.target.value)}
          className="h-9 min-w-48 flex-1"
        />
        <select
          aria-label="Filter by meeting state"
          value={query.state}
          onChange={(event) => updateQuery({ state: event.target.value as MeetingStateFilter, page: 1 })}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {HISTORY_STATE_FILTERS.map((state) => (
            <option key={state} value={state}>
              {state === "all" ? "All states" : state.charAt(0).toUpperCase() + state.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {resource.status === "loading" ? <ListSkeleton /> : null}

      {resource.status === "error" && resource.error.kind === "recoverable" ? (
        <RecoverableErrorPanel message={resource.error.message} onRetry={resource.retry} />
      ) : null}
      {resource.status === "error" && resource.error.kind === "signed-out" ? (
        <div className="mt-10 rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">You&apos;re signed out.</p>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to see your meeting history.</p>
        </div>
      ) : null}
      {resource.status === "error" && resource.error.kind === "unavailable" ? (
        <UniformUnavailable backHref="/app/history" />
      ) : null}

      {visible && visible.items.length === 0 ? (
        <EmptyHistory filtered={query.q !== "" || query.state !== DEFAULT_LIST_QUERY.state} />
      ) : null}

      {visible && visible.items.length > 0 ? (
        <>
          <ul className="mt-4 space-y-2">
            {visible.items.map((meeting, index) => (
              <motion.li
                key={meeting.meetingId}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(index * 0.03, 0.15) }}
              >
                <Card>
                  <CardContent className="p-4">
                    <Link
                      href={"/app/history/" + meeting.meetingId + (isFixture ? "?" + FIXTURE_QUERY_FLAG + "=1" : "")}
                      className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={rememberScroll}
                      data-testid="history-row"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{meeting.title}</p>
                          {meeting.description ? (
                            <p className="truncate text-sm text-muted-foreground">{meeting.description}</p>
                          ) : null}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatMeetingDate(meeting.scheduledAt)} -{" "}
                            {meeting.userRole === "host" ? "Hosted" : "Participated"}
                            {typeof meeting.participantCount === "number"
                              ? " - " + meeting.participantCount + " participants"
                              : ""}
                          </p>
                        </div>
                        <div className="shrink-0">
                          <MeetingStateBadge state={meeting.state} />
                        </div>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              </motion.li>
            ))}
          </ul>
          <nav className="mt-4 flex items-center justify-between" aria-label="History pagination">
            <Button
              variant="outline"
              size="sm"
              disabled={visible.page <= 1}
              onClick={() => updateQuery({ page: visible.page - 1 })}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Page {visible.page} of {visible.totalPages} - {visible.totalMatches} meetings
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={visible.page >= visible.totalPages}
              onClick={() => updateQuery({ page: visible.page + 1 })}
            >
              Next
            </Button>
          </nav>
        </>
      ) : null}
    </main>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <HistoryTransportProvider>
        <ListInner />
      </HistoryTransportProvider>
    </Suspense>
  );
}
