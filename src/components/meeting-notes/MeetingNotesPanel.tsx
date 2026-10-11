"use client";

/**
 * In-call shared meeting notes panel (M3 of connvo-notes-ledger-f1).
 *
 * Renders the notes-ledger hook's truth HONESTLY (docs/notes-ledger-f1/design.md §4):
 * the status badge never claims "Saved" unless the ledger reports `synced`,
 * and unsaved words stay visible until the server confirms them by identity.
 *
 * Self-contained: when no NotesTransportProvider sits above it, a guard catches
 * the missing-transport error and re-renders under the default provider (the
 * production Convex wiring lands with the ledger milestone — until then the
 * default provider fails loudly; the /dev/notes-preview route supplies the
 * demo transport explicitly). The S3 call-UX task mounts this panel; call
 * pages are NOT edited by this task.
 *
 * The panel owns no buffering: every change is forwarded via the hook's
 * `onEdit`, which debounces and flushes. The local `draft` mirror only keeps
 * the textarea showing the user's keystrokes between renders — the hook's
 * `isEditing` flag decides when the composed ledger content shows through.
 */

import {
  Component,
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Id } from "@convex/_generated/dataModel";
import {
  useNotesLedger,
  useStableNotesClientId,
} from "@/hooks/notes";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import {
  UNSAVED_STATE_LABELS,
  notesTextMetrics,
  presentStatus,
  unsavedBadgeTone,
  unsavedBadgeVariant,
  type UseNotesLedgerRecordState,
} from "./notesStatus";
import { FadeRise } from "./FadeRise";
import { DefaultNotesTransportProvider } from "./defaultNotesTransport";

/**
 * The pinned §3 contract `useNotesLedger(meetingId)` is the real ledger hook
 * since the M2/M3 join — no signature alignment needed: the optional options
 * argument carries the stable client identity the panel decides above both
 * the ledger and the transport.
 */

export interface MeetingNotesPanelProps {
  meetingId: Id<"meetings">;
  className?: string;
}

/**
 * Catches the notes transport context's "used without a NotesTransportProvider"
 * error and re-renders the panel under the default provider. Any other error
 * is rethrown — the panel never masks a real failure.
 */
const MISSING_TRANSPORT_SNIPPET = "used without a NotesTransportProvider";

class TransportGuard extends Component<
  { meetingId: Id<"meetings">; clientId: string; children: ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    if (error instanceof Error && error.message.includes(MISSING_TRANSPORT_SNIPPET)) {
      return (
        <DefaultNotesTransportProvider
          meetingId={this.props.meetingId}
          clientId={this.props.clientId}
        >
          {this.props.children}
        </DefaultNotesTransportProvider>
      );
    }
    throw error;
  }
}

function MeetingNotesPanelBody({
  meetingId,
  clientId,
  className,
}: MeetingNotesPanelProps & { clientId: string }) {
  const ledger = useNotesLedger(meetingId, { clientId });
  const [draft, setDraft] = useState<string | null>(null);
  const titleId = useId();

  // When the hook's editing session ends (flush settled), drop the mirror so
  // the composed ledger content — possibly rebased with remote edits — shows.
  useEffect(() => {
    if (!ledger.isEditing) {
      setDraft(null);
    }
  }, [ledger.isEditing]);

  const value = ledger.isEditing && draft !== null ? draft : ledger.content;

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setDraft(next);
    ledger.onEdit(next);
  };

  const presentation = presentStatus(ledger.status, ledger.unconfirmedCount);
  const metrics = notesTextMetrics(value);

  // The retry affordance only promises what retryConflicts actually does:
  // recompute conflicted/rejected ops. Pending/sending/unconfirmed records
  // resolve through the ledger's own evidence-gated sends and fresh reads.
  const hasRetryableRecords = ledger.unsavedRecords.some(
    (record) => record.state === "conflict" || record.state === "rejected",
  );

  return (
    <FadeRise className={className}>
      <Card data-testid="notes-panel" className="gap-3 py-4">
        <CardHeader>
          <CardTitle id={titleId}>Shared meeting notes</CardTitle>
          <CardAction>
            {/* Stable polite live region: rendered from the first mount so
                repeated announcements are reliable (screen-readers skill). */}
            <div role="status" aria-live="polite" className="flex">
              <Badge
                data-testid="notes-status"
                variant="outline"
                className={cn("gap-1.5", presentation.tone)}
              >
                <presentation.Icon
                  aria-hidden="true"
                  focusable="false"
                  className={cn(
                    "size-3.5",
                    ledger.status === "loading" && "motion-safe:animate-spin",
                  )}
                />
                {presentation.label}
              </Badge>
            </div>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <Textarea
            data-testid="notes-editor"
            aria-labelledby={titleId}
            value={value}
            onChange={handleChange}
            onBlur={() => ledger.flushNow()}
            // Disabled ONLY while loading — offline and syncing typing must
            // always work (the ledger queues edits).
            disabled={ledger.isLoading}
            placeholder="Start taking shared notes…"
            className="min-h-40 resize-y font-mono text-sm md:min-h-60"
          />

          {/* Quiet metrics row — deliberately outside the live region so
              every keystroke isn't announced. */}
          <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p data-testid="notes-counts">
              {metrics.words} {metrics.words === 1 ? "word" : "words"} ·{" "}
              {metrics.characters}{" "}
              {metrics.characters === 1 ? "character" : "characters"}
            </p>
            {ledger.version > 0 && <p>Version {ledger.version}</p>}
          </div>

          {ledger.unsavedRecords.length > 0 && (
            <FadeRise>
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Unsaved changes</p>
                  {hasRetryableRecords && (
                    <Button
                      data-testid="notes-retry"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => ledger.retryConflicts()}
                    >
                      <RotateCcw aria-hidden="true" focusable="false" />
                      Retry unsaved changes
                    </Button>
                  )}
                </div>
                <ul
                  data-testid="notes-unsaved-list"
                  className="mt-2 space-y-1.5"
                >
                  {ledger.unsavedRecords.map((record) => (
                    <li
                      key={record.clientOpId}
                      data-state={record.state}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <Badge
                        variant={unsavedBadgeVariant(record.state)}
                        className={unsavedBadgeTone(record.state)}
                      >
                        {UNSAVED_STATE_LABELS[record.state]}
                      </Badge>
                      {/* The user's words stay visible in full — this list is
                          the loss-proof promise, never a truncating console. */}
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        &ldquo;{record.content}&rdquo;
                      </span>
                      {record.attempts > 1 && (
                        <span className="text-muted-foreground">
                          attempt {record.attempts}
                        </span>
                      )}
                    </li>
                  ))}
                  {ledger.bufferedContent.length > 0 && (
                    <li
                      data-state="buffered"
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        Unsent
                      </Badge>
                      {/* The loss-proof promise covers words waiting in the
                          buffer too: while live records make a new op's
                          coordinates unsound, the words wait here — visible
                          with a state label, never hidden. */}
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        &ldquo;{ledger.bufferedContent}&rdquo;
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            </FadeRise>
          )}
        </CardContent>
      </Card>
    </FadeRise>
  );
}

export function MeetingNotesPanel({ meetingId, className }: MeetingNotesPanelProps) {
  // One identity above BOTH the ledger and the transport (design.md §3):
  // identity acknowledgements and dedupe join only when both sides share it.
  const clientId = useStableNotesClientId(meetingId);
  return (
    <TransportGuard meetingId={meetingId} clientId={clientId}>
      <MeetingNotesPanelBody
        meetingId={meetingId}
        clientId={clientId}
        className={className}
      />
    </TransportGuard>
  );
}
