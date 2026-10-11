"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DetailSkeleton,
  MeetingStateBadge,
  NotesSection,
  RecoverableErrorPanel,
  TranscriptSection,
  UniformUnavailable,
} from "../components";
import { formatMeetingDate } from "../format";
import { FIXTURE_QUERY_FLAG } from "../fixtureTransport";
import { HistoryTransportProvider, useHistoryResource, useHistoryTransport } from "../useHistoryTransport";

function DetailInner() {
  const routeParams = useParams<{ meetingId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();
  const { transport, isFixture } = useHistoryTransport();
  const meetingId = typeof routeParams?.meetingId === "string" ? routeParams.meetingId : "";
  const backHref = "/app/history" + (isFixture ? "?" + FIXTURE_QUERY_FLAG + "=1" : "");

  const load = useCallback(() => transport.getMeeting(meetingId), [transport, meetingId]);
  const resource = useHistoryResource(load, [transport, meetingId]);

  // Changed-version notice: surface when a later fetch returns a different
  // notes version than the one first shown (concurrent edits, rebases).
  const prevVersionRef = useRef<number | null>(null);
  const [versionNotice, setVersionNotice] = useState<string | null>(null);
  useEffect(() => {
    if (resource.status !== "ready") return;
    const version = resource.data.notes?.version ?? null;
    const previous = prevVersionRef.current;
    prevVersionRef.current = version;
    if (version !== null && previous !== null && previous !== version) {
      setVersionNotice("Notes changed since you opened this page (version " + previous + " to " + version + ").");
    }
  }, [resource]);

  // Esc returns to the list (the slice has no dialogs to trap the key).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") router.back();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  if (!meetingId || (resource.status === "error" && resource.error.kind === "unavailable")) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <UniformUnavailable backHref={backHref} />
      </main>
    );
  }

  if (resource.status === "loading") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <DetailSkeleton />
      </main>
    );
  }

  if (resource.status === "error" && resource.error.kind === "recoverable") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <RecoverableErrorPanel message={resource.error.message} onRetry={resource.retry} />
        <div className="mt-3 text-center">
          <Button asChild variant="ghost" size="sm">
            <Link href={backHref}>Back to history</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (resource.status === "error" && resource.error.kind === "signed-out") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="mt-10 rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">You&apos;re signed out.</p>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to see this meeting.</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href={backHref}>Back to history</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (resource.status !== "ready") {
    // Logically unreachable (all other states returned above); safe fallback.
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <UniformUnavailable backHref={backHref} />
      </main>
    );
  }

  const meeting = resource.data;
  const notesState = meeting.notesError ? "unavailable" : meeting.notes ? "ready" : "missing";
  const transcriptState = meeting.transcriptError ? "unavailable" : meeting.transcript ? "ready" : "missing";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          Back
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>All history</Link>
        </Button>
      </div>

      <motion.header
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mt-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{meeting.title}</h1>
          <MeetingStateBadge state={meeting.state} />
          {isFixture ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-300">
              Local fixture transport - synthetic data
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatMeetingDate(meeting.scheduledAt)} - You were {meeting.userRole}
          {meeting.userPresence ? " (" + meeting.userPresence + ")" : ""}
        </p>
      </motion.header>

      {versionNotice ? (
        <div
          role="status"
          className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
        >
          {versionNotice}
        </div>
      ) : null}

      <section className="mt-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent data-testid="notes-section">
            <NotesSection state={notesState} notes={meeting.notes} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transcript</CardTitle>
          </CardHeader>
          <CardContent data-testid="transcript-section">
            <TranscriptSection state={transcriptState} segments={meeting.transcript} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

export default function MeetingHistoryDetailPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <HistoryTransportProvider>
        <DetailInner />
      </HistoryTransportProvider>
    </Suspense>
  );
}
