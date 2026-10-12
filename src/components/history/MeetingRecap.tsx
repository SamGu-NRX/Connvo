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
import { SIGNED_OUT_MESSAGE, useHistoryAuth } from "./useHistoryAuth";

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
  level,
  children,
}: {
  title: string;
  level: 2 | 3;
  children: React.ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className="flex flex-col gap-2">
      <Heading className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </Heading>
      {children}
    </section>
  );
}

/** The recap of one meeting's records. `compact` shortens it for the call page. */
export function MeetingRecapView({
  history,
  compact = false,
  level = 2,
}: {
  /** Heading level of the recap's sections: 2 on its own page, 3 inside a titled box. */
  level?: 2 | 3;
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
  // buildRecap writes a literal "No prompts were recorded" item when there
  // were none; shown here as a plain sentence instead of a one-item list.
  const used =
    history.prompts.length > 0
      ? recap.sections.find((s) => s.kind === "prompts-used")
      : undefined;
  const served = recap.sections.find((s) => s.kind === "prompts-served");
  const people = [...history.participants].sort((a, b) =>
    (a.displayName ?? "").localeCompare(b.displayName ?? ""),
  );
  const notes = history.notes?.content.trim() ?? "";
  // Who opened the call, when the call recorded sessions; everyone in the
  // meeting otherwise (a meeting whose call ran elsewhere records none).
  const joined = new Set(history.callAttendees);
  const attended = people.filter((p) => joined.has(p.userId));
  const invitedOnly =
    joined.size > 0 ? people.filter((p) => !joined.has(p.userId)) : [];

  return (
    <div
      data-testid="meeting-recap"
      className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}
    >
      <Section title="Who took part" level={level}>
        {attended.length > 0 || invitedOnly.length === 0 ? (
          <ul className="flex flex-wrap gap-2">
            {(attended.length > 0 ? attended : people).map((p) => (
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
        ) : (
          <p className="text-muted-foreground text-sm">
            Nobody joined the call.
          </p>
        )}
        {attended.length > 0 && invitedOnly.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            Invited but didn&apos;t join:{" "}
            {invitedOnly
              .map((p) => p.displayName ?? "someone without a name")
              .join(", ")}
          </p>
        ) : null}
      </Section>

      <Section title="Duration" level={level}>
        <p className="text-sm">{durationLine(history)}</p>
      </Section>

      <Section title="Shared notes" level={level}>
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
        <Section title="Prompts used" level={level}>
          {history.prompts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No prompts were recorded.
            </p>
          ) : used ? (
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
  if (history === undefined) return <MeetingRecapSkeleton />;
  return (
    <MeetingRecapView
      history={history}
      compact={compact}
      level={compact ? 3 : 2}
    />
  );
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
