"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HistoryNotesArtifact, MeetingLifecycleState, TranscriptSegmentView } from "./types";
import { formatMeetingDate, formatSegmentClock } from "./format";

export function MeetingStateBadge({ state }: { state: MeetingLifecycleState }) {
  return (
    <Badge variant="outline" className="capitalize">
      {state}
    </Badge>
  );
}

export function ListSkeleton() {
  return (
    <div className="mt-4 space-y-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
      <span className="sr-only">Loading history</span>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="mt-6 space-y-4" aria-hidden="true">
      <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-56 animate-pulse rounded-lg bg-muted" />
      <span className="sr-only">Loading meeting</span>
    </div>
  );
}

/**
 * Uniform refusal panel. Deliberately identical for every refusal cause -
 * other-user, removed participant, deactivated account, nonexistent meeting,
 * orphaned row - so the UI can never leak whether a meeting exists.
 */
export function UniformUnavailable({ backHref }: { backHref: string }) {
  return (
    <div className="mt-10 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">This meeting isn&apos;t available.</p>
      <p className="mt-1 text-sm text-muted-foreground">You may not have access to it, or it may no longer exist.</p>
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href={backHref}>Back to history</Link>
      </Button>
    </div>
  );
}

export function RecoverableErrorPanel({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-10 rounded-lg border border-amber-500/40 bg-amber-500/10 p-6 text-center">
      <p className="font-medium">Something went wrong loading history.</p>
      {message ? <p className="mt-1 text-xs text-muted-foreground">({message})</p> : null}
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function EmptyHistory({ filtered }: { filtered: boolean }) {
  return (
    <div className="mt-10 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      {filtered ? "No meetings match your search or filter." : "No meetings here yet."}
    </div>
  );
}

export function ArtifactIdentityLine({
  source,
  version,
  updatedAt,
  count,
}: {
  source: string;
  version?: number;
  updatedAt?: number;
  count?: number;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Source {source}
      {typeof version === "number" ? " - version " + version : ""}
      {updatedAt ? " - updated " + formatMeetingDate(updatedAt) : ""}
      {typeof count === "number" ? " - " + count + " segments" : ""}
    </p>
  );
}

export function NotesSection({
  state,
  notes,
}: {
  state: "ready" | "missing" | "unavailable";
  notes?: HistoryNotesArtifact | null;
}) {
  if (state === "unavailable") {
    return <p className="text-sm text-muted-foreground">Notes aren&apos;t available for this meeting right now.</p>;
  }
  if (state === "missing" || !notes) {
    // Authorized read returned a clean null: captured absence, safe to state.
    return <p className="text-sm text-muted-foreground">No notes were captured for this meeting.</p>;
  }
  return (
    <div data-testid="notes-artifact">
      <ArtifactIdentityLine source="getMeetingNotes" version={notes.version} updatedAt={notes.updatedAt} />
      {/* Text-node rendering only - meeting content is treated as untrusted data. */}
      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{notes.content}</pre>
    </div>
  );
}

export function TranscriptSection({
  state,
  segments,
}: {
  state: "ready" | "missing" | "unavailable";
  segments?: TranscriptSegmentView[] | null;
}) {
  if (state === "unavailable") {
    return <p className="text-sm text-muted-foreground">Transcript isn&apos;t available for this meeting right now.</p>;
  }
  if (state === "missing" || !segments || segments.length === 0) {
    return <p className="text-sm text-muted-foreground">No transcript was captured for this meeting.</p>;
  }
  return (
    <div data-testid="transcript-artifact">
      <ArtifactIdentityLine source="getTranscriptSegments" count={segments.length} />
      <ol className="mt-3 space-y-3">
        {segments.map((segment) => (
          <li key={segment.id || segment.startMs + "-" + segment.endMs} className="text-sm">
            <span className="font-mono text-xs text-muted-foreground">
              [{formatSegmentClock(segment.startMs)}-{formatSegmentClock(segment.endMs)}]
            </span>{" "}
            {segment.speakers.length > 0 ? <span className="font-medium">{segment.speakers.join(", ")}: </span> : null}
            {segment.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
