"use client";

/**
 * The two after-call taps (docs/plan/MATCHING-PLAN.md, "After the call"):
 * "Would you talk again?" and "Connect". Shown on the call's ended screen
 * and on the recap page, once per person per meeting — after an answer, the
 * prompt is replaced by what was recorded. A connection exists only when
 * both people tap Connect; until then nobody's individual choice or tap is
 * ever revealed to the other (convex/network/queries.ts).
 */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HistoryBoundary } from "./HistoryBoundary";
import { useHistoryAuth } from "./useHistoryAuth";

/** Optional chips for a "no" — pick any, or send none. */
const NO_REASONS = [
  "Not a good fit",
  "Bad timing",
  "Hard to find time",
  "Already know them",
  "Prefer not to say",
];

function PostCallPromptsControl({ meetingId }: { meetingId: Id<"meetings"> }) {
  const auth = useHistoryAuth();
  const state = useQuery(
    api.network.queries.getMeetingAfterCallState,
    auth === "ready" ? { meetingId } : "skip",
  );
  const recordFeedback = useMutation(
    api.network.mutations.recordTalkAgainFeedback,
  );
  const connect = useMutation(api.network.mutations.connectWith);
  const [pickedReasons, setPickedReasons] = useState<string[]>([]);
  const [askingWhyNot, setAskingWhyNot] = useState(false);
  const [saving, setSaving] = useState<"feedback" | "connect" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (auth === "signed-out") return null;
  if (state === undefined) return <Skeleton className="h-24 w-full" />;

  const answer = (talkAgain: boolean, reasons: string[] = []) => {
    if (saving) return;
    setSaving("feedback");
    setProblem(null);
    recordFeedback({
      meetingId,
      talkAgain,
      reasons: talkAgain ? [] : reasons,
    })
      .then(() => setAskingWhyNot(false))
      .catch(() => setProblem("That didn't save. Try again."))
      .finally(() => setSaving(null));
  };

  const tapConnect = async () => {
    if (saving) return;
    setSaving("connect");
    setProblem(null);
    try {
      await connect({ meetingId });
    } catch {
      setProblem("That didn't save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div data-testid="post-call-prompts" className="flex flex-col gap-5">
      <section
        aria-labelledby="post-call-talk-again"
        className="flex flex-col gap-2"
      >
        <h3 id="post-call-talk-again" className="text-sm font-medium">
          Would you talk again?
        </h3>
        {state.feedback === null ? (
          askingWhyNot ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap gap-2">
                {NO_REASONS.map((reason) => {
                  const picked = pickedReasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      type="button"
                      aria-pressed={picked}
                      onClick={() =>
                        setPickedReasons((prev) =>
                          prev.includes(reason)
                            ? prev.filter((r) => r !== reason)
                            : [...prev, reason],
                        )
                      }
                      className={cn(
                        "focus-visible:ring-ring/50 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px]",
                        picked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
              <p className="text-muted-foreground text-xs">
                Optional: pick any reasons, or just send.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAskingWhyNot(false)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  aria-disabled={saving === "feedback"}
                  className="aria-disabled:cursor-wait aria-disabled:opacity-50"
                  onClick={() => answer(false, pickedReasons)}
                >
                  Send
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                aria-disabled={saving === "feedback"}
                className="aria-disabled:cursor-wait aria-disabled:opacity-50"
                onClick={() => answer(true)}
              >
                Yes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-disabled={saving === "feedback"}
                className="aria-disabled:cursor-wait aria-disabled:opacity-50"
                onClick={() => setAskingWhyNot(true)}
              >
                No
              </Button>
            </div>
          )
        ) : (
          <p role="status" className="text-muted-foreground text-sm">
            {state.feedback.talkAgain
              ? "Noted — you'd talk again."
              : "Noted — you'd rather not this time."}
            {state.feedback.reasons.length > 0
              ? ` (${state.feedback.reasons.join(", ")})`
              : null}
          </p>
        )}
      </section>

      <section
        aria-labelledby="post-call-connect"
        className="flex flex-col gap-2"
      >
        <h3 id="post-call-connect" className="text-sm font-medium">
          Connect
        </h3>
        {state.connected ? (
          <p role="status" className="text-sm">
            You&apos;re connected.{" "}
            <Link
              href="/app/dashboard"
              className="text-primary underline-offset-4 hover:underline"
            >
              Open Your network
            </Link>
          </p>
        ) : state.connectTapped ? (
          <p role="status" className="text-muted-foreground text-sm">
            You tapped Connect. You&apos;ll see each other in Your network when
            you both do.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Keep this person in your network.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => void tapConnect()}
              aria-disabled={saving === "connect"}
              className="w-fit aria-disabled:cursor-wait aria-disabled:opacity-50"
            >
              Connect
            </Button>
          </>
        )}
      </section>

      {problem ? (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

export function PostCallPrompts({ meetingId }: { meetingId: Id<"meetings"> }) {
  return (
    <HistoryBoundary>
      <PostCallPromptsControl meetingId={meetingId} />
    </HistoryBoundary>
  );
}
