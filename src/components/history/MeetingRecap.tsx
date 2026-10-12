"use client";

/**
 * What a meeting recorded, shown back to the people who were in it: who took
 * part, how long it ran, the shared notes, and the prompts used. Extractive
 * only: every line comes from a stored record (src/lib/history/recap.ts
 * builds the sections); nothing is summarised or generated, and a source
 * that recorded nothing says so.
 */
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { buildRecap } from "@/lib/history/recap";
import { cn } from "@/lib/utils";
import { HistoryBoundary } from "./HistoryBoundary";

export type MeetingHistory = FunctionReturnType<
  typeof api.history.queries.getMeetingHistory
>;

function durationLine(history: MeetingHistory): string {
  const { state } = history;
  const started = state?.startedAt;
  const ended = state?.endedAt;
  if (typeof started === "number" && typeof ended === "number") {
    const minutes = Math.max(0, Math.round((ended - started) / 60_000));
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  if (typeof started === "number")
    return "Still going: no end has been recorded yet.";
  return "Not recorded";
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The recap of one meeting's records. `compact` shortens it for the call page. */
export function MeetingRecapView({
  history,
  compact = false,
}: {
  history: MeetingHistory;
  compact?: boolean;
}) {
  const recap = buildRecap({
    meeting: history.meeting,
    participants: history.participants,
    state: history.state,
    lifecycleEvents: history.lifecycleEvents,
    notes: history.notes,
    prompts: history.prompts,
  });
  const used = recap.sections.find((s) => s.kind === "prompts-used");
  const served = recap.sections.find((s) => s.kind === "prompts-served");
  const people = [...history.participants].sort((a, b) =>
    (a.displayName ?? "").localeCompare(b.displayName ?? ""),
  );
  const notes = history.notes?.content.trim() ?? "";

  return (
    <div
      data-testid="meeting-recap"
      className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}
    >
      <Section title="Who took part">
        <ul className="flex flex-wrap gap-2">
          {people.map((p) => (
            <li
              key={p.userId}
              className="bg-muted/60 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm"
            >
              {p.displayName ?? "Someone without a name"}
              {p.role === "host" ? (
                <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                  Host
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Duration">
        <p className="text-sm">{durationLine(history)}</p>
      </Section>

      <Section title="Shared notes">
        {notes ? (
          <p
            data-testid="recap-notes"
            className={cn(
              "bg-muted/40 rounded-md border p-3 font-mono text-sm break-words whitespace-pre-wrap",
              compact && "max-h-48 overflow-y-auto",
            )}
          >
            {history.notes?.content}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            No notes were shared during this meeting.
          </p>
        )}
      </Section>

      {!compact || used ? (
        <Section title="Prompts used">
          {used ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {used.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No prompts were used.
            </p>
          )}
          {!compact && served ? (
            <details className="text-sm">
              <summary className="text-muted-foreground cursor-pointer">
                Shown but not marked as used ({served.items.length})
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {served.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

export function MeetingRecapSkeleton() {
  return (
    <div
      data-testid="meeting-recap-loading"
      aria-busy="true"
      className="flex flex-col gap-5"
    >
      <span className="sr-only">Loading the recap…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

function MeetingRecapData({
  meetingId,
  compact,
}: {
  meetingId: Id<"meetings">;
  compact?: boolean;
}) {
  const history = useQuery(api.history.queries.getMeetingHistory, {
    meetingId,
  });
  if (history === undefined) return <MeetingRecapSkeleton />;
  return <MeetingRecapView history={history} compact={compact} />;
}

/** The recap for a meeting, loaded live; refusals show as one sentence. */
export function MeetingRecap({
  meetingId,
  compact,
}: {
  meetingId: Id<"meetings">;
  compact?: boolean;
}) {
  return (
    <HistoryBoundary>
      <MeetingRecapData meetingId={meetingId} compact={compact} />
    </HistoryBoundary>
  );
}
