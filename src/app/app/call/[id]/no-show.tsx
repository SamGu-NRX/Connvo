"use client";

/**
 * The call-room no-show control (docs/plan/MATCHING-PLAN.md, step 7): a
 * participant-only affordance in the side panel. The server owns every rule
 * — grace period, one report per meeting, strike recording, meeting
 * conclusion — so this stays a thin form that relays the server's answer.
 */

import { useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Flag } from "lucide-react";

const REASONS = [
  { value: "never_joined", label: "They never showed up" },
  { value: "joined_late", label: "They arrived more than 10 minutes late" },
  { value: "left_early", label: "They left right away" },
] as const;

type SubmitState = "idle" | "busy" | "reported" | "error";

export function NoShowControl({ meetingId }: { meetingId: Id<"meetings"> }) {
  const { isAuthenticated } = useConvexAuth();
  const reportNoShow = useMutation(api.matching.noshow.reportNoShow);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"] | null>(
    null,
  );
  const [submit, setSubmit] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!isAuthenticated) return null;

  async function confirm() {
    if (reason === null) return;
    setSubmit("busy");
    setMessage(null);
    try {
      await reportNoShow({ meetingId, reason });
      setSubmit("reported");
      setMessage("Recorded. Thanks for letting us know.");
    } catch (error) {
      setSubmit("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "That didn't go through. Try again.",
      );
    }
  }

  if (submit === "reported") {
    return (
      <p
        data-testid="no-show-reported"
        className="rounded-sm bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
      >
        Recorded. Thanks for letting us know.
      </p>
    );
  }

  return (
    <div data-testid="no-show-control" className="text-xs">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="inline-flex items-center gap-1.5 font-medium text-emerald-900/50 underline decoration-dotted hover:text-emerald-900/80 dark:text-emerald-100/50 dark:hover:text-emerald-100/80"
        >
          <Flag aria-hidden="true" className="h-3.5 w-3.5" />
          Report a no-show
        </button>
      ) : (
        <div className="rounded-sm border border-surface bg-emerald-50/40 px-3 py-2 dark:bg-emerald-900/20">
          <p className="font-semibold text-emerald-900 dark:text-emerald-100">
            What happened?
          </p>
          {REASONS.map((choice) => (
            <label
              key={choice.value}
              className="mt-1 flex cursor-pointer items-center gap-2 text-emerald-900/80 dark:text-emerald-100/80"
            >
              <input
                type="radio"
                name="no-show-reason"
                value={choice.value}
                checked={reason === choice.value}
                onChange={() => setReason(choice.value)}
              />
              {choice.label}
            </label>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <button
              data-testid="confirm-no-show"
              disabled={reason === null || submit === "busy"}
              onClick={confirm}
              className="rounded-sm bg-emerald-500 px-3 py-1 font-semibold uppercase tracking-[0.14em] text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {submit === "busy" ? "Reporting…" : "Report"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-emerald-900/50 underline decoration-dotted dark:text-emerald-100/50"
            >
              Cancel
            </button>
          </div>
          {message && (
            <p role="alert" className="mt-1.5 text-red-600 dark:text-red-300">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
