"use client";

/**
 * Stay in touch after a meeting. Each person decides for themselves; another
 * person's name and email show only when both have said yes, and nobody
 * learns anyone's choice before making their own (convex/history/queries.ts,
 * stayInTouchView).
 */
import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryBoundary } from "./HistoryBoundary";
import { useHistoryAuth } from "./useHistoryAuth";

function StayInTouchControl({ meetingId }: { meetingId: Id<"meetings"> }) {
  const auth = useHistoryAuth();
  const status = useQuery(
    api.history.queries.getStayInTouchStatus,
    auth === "ready" ? { meetingId } : "skip",
  );
  const setStayInTouch = useMutation(api.history.mutations.setStayInTouch);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const labelId = useId();
  const hintId = useId();

  if (auth === "signed-out") return null;
  if (status === undefined) return <Skeleton className="h-16 w-full" />;

  const toggle = async (enabled: boolean) => {
    if (saving) return;
    setSaving(true);
    setProblem(null);
    try {
      await setStayInTouch({ meetingId, enabled });
    } catch {
      setProblem("That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="stay-in-touch" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p id={labelId} className="text-sm font-medium">
            Stay in touch
          </p>
          <p id={hintId} className="text-muted-foreground text-sm">
            Share your email with the people from this meeting who say yes too.
            Until they do, they see nothing.
          </p>
        </div>
        <Switch
          data-testid="stay-in-touch-switch"
          aria-labelledby={labelId}
          aria-describedby={hintId}
          checked={status.enabled}
          // Not disabled while saving: disabling the focused switch drops
          // keyboard focus to the page, so a second press is ignored instead.
          aria-busy={saving}
          onCheckedChange={(checked) => void toggle(checked)}
          className="mt-1"
        />
      </div>
      {problem ? (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      ) : null}
      {status.enabled ? (
        <div role="status" aria-live="polite" className="text-sm">
          {status.contacts.length === 0 ? (
            <p className="text-muted-foreground">
              You said yes. Nobody else has yet; anyone who does will show up
              here.
            </p>
          ) : (
            <ul
              data-testid="stay-in-touch-contacts"
              className="flex flex-col gap-1.5"
            >
              {status.contacts.map((contact) => (
                <li
                  key={contact.email}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span className="font-medium">{contact.name}</span>
                  <a
                    className="text-primary underline-offset-4 hover:underline"
                    href={`mailto:${contact.email}`}
                  >
                    {contact.email}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function StayInTouch({ meetingId }: { meetingId: Id<"meetings"> }) {
  return (
    <HistoryBoundary>
      <StayInTouchControl meetingId={meetingId} />
    </HistoryBoundary>
  );
}
