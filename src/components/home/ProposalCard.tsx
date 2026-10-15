"use client";

/**
 * The live proposal card (docs/plan/MATCHING-PLAN.md, step 5): the person,
 * why they were picked, a first question, the proposed time with stored
 * alternatives, and the three decisions — accept, pick another time, or pass
 * with a reason. When I have accepted, the card says so and waits for the
 * other person instead of offering my decision again.
 */

import { useState } from "react";
import { motion } from "motion/react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { generateAvatarColor, getInitials } from "@/lib/avatar-utils";
import { Check, ChevronDown, Clock, X } from "lucide-react";
import type { useNow } from "./useCountdown";

export type MyProposal = NonNullable<
  FunctionReturnType<typeof api.matching.proposals.myProposal>
>;

const DECLINE_CHOICES = [
  { value: "not_relevant", label: "Not a good fit" },
  { value: "bad_timing", label: "Bad timing" },
  { value: "already_met", label: "We've already talked" },
  { value: "other", label: "Other" },
] as const;

export function ProposalCard({
  proposal,
  now,
}: {
  proposal: MyProposal;
  now: ReturnType<typeof useNow>;
}) {
  const accept = useMutation(api.matching.proposals.accept);
  const chooseAlternative = useMutation(
    api.matching.proposals.chooseAlternative,
  );
  const decline = useMutation(api.matching.proposals.decline);

  const [pickingTime, setPickingTime] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState<
    (typeof DECLINE_CHOICES)[number]["value"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const firstName = proposal.partner.name.split(" ")[0];
  const color = generateAvatarColor(proposal.partner.userId);
  const initials = getInitials(proposal.partner.name);
  // The proposal is only shown while it is still "proposed"; if I have
  // accepted and it is still here, the partner is the one who hasn't.
  const iAmWaiting = proposal.myAcceptance;
  const expired = now >= proposal.expiresAt;

  async function run(kind: string, action: () => Promise<unknown>) {
    setError(null);
    setBusy(kind);
    try {
      await action();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.section
      data-testid="proposal-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="rounded-sm border border-surface bg-white/95 px-4 py-4 dark:bg-emerald-950/40"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300/80">
        Your next conversation
      </p>

      <div className="mt-3 flex items-center gap-4">
        <div
          aria-hidden="true"
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold bg-linear-to-br ${color.from} ${color.to} ${color.text}`}
        >
          {initials}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-emerald-900 dark:text-white">
            {proposal.partner.name}
          </h2>
          <p className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
            {[proposal.partner.title, proposal.partner.company]
              .filter(Boolean)
              .join(" · ") || "Connvo member"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3 text-sm text-emerald-900/80 dark:text-emerald-100/80">
        <div>
          <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">
            Why you two
          </h3>
          <ul className="mt-1 space-y-0.5">
            {proposal.reasons.map((reason) => (
              <li key={reason}>· {reason}</li>
            ))}
          </ul>
          {proposal.sharedInterests.length > 0 && (
            <p className="mt-1 text-xs text-emerald-900/60 dark:text-emerald-100/60">
              Shared interests: {proposal.sharedInterests.join(", ")}
            </p>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">
            Open with
          </h3>
          <p className="mt-1 italic">“{proposal.firstQuestion}”</p>
        </div>
        <div>
          <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">
            <Clock aria-hidden="true" className="mr-1 inline h-4 w-4" />
            Proposed time
          </h3>
          <p className="mt-1">
            {proposal.scheduledAtLocal} · your timezone
          </p>
        </div>
      </div>

      {iAmWaiting ? (
        <div
          data-testid="waiting-pill"
          className="mt-4 rounded-sm bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
        >
          Waiting for {firstName} to accept — we&apos;ll confirm by email.
        </div>
      ) : expired ? (
        <div className="mt-4 text-sm text-emerald-900/60 dark:text-emerald-100/60">
          This invitation has timed out. The next matcher run will bring a new
          person.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              data-testid="accept-proposal"
              disabled={busy !== null}
              className="flex-1 rounded-sm bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-emerald-600"
              onClick={() =>
                run("accept", () => accept({ proposalId: proposal.proposalId }))
              }
            >
              <Check aria-hidden="true" />
              {busy === "accept" ? "Accepting…" : "Accept"}
            </Button>
            <Button
              data-testid="toggle-alternatives"
              variant="outline"
              disabled={busy !== null}
              aria-expanded={pickingTime}
              className="flex-1 rounded-sm border border-surface bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/80 transition-colors duration-200 hover:bg-emerald-50/60 dark:bg-emerald-950/50 dark:text-emerald-100/80 dark:hover:bg-emerald-900/60"
              onClick={() => {
                setDeclining(false);
                setPickingTime((open) => !open);
              }}
            >
              <ChevronDown
                aria-hidden="true"
                className={pickingTime ? "rotate-180 transition-transform" : "transition-transform"}
              />
              Pick another time
            </Button>
            <Button
              data-testid="toggle-decline"
              variant="outline"
              disabled={busy !== null}
              aria-expanded={declining}
              className="flex-1 rounded-sm border border-surface bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/60 transition-colors duration-200 hover:bg-red-50/60 dark:bg-emerald-950/50 dark:text-emerald-100/60 dark:hover:bg-red-950/40"
              onClick={() => {
                setPickingTime(false);
                setDeclining((open) => !open);
              }}
            >
              <X aria-hidden="true" />
              Not this one
            </Button>
          </div>

          {pickingTime && (
            <fieldset className="mt-3 space-y-1.5 rounded-sm border border-surface bg-emerald-50/40 px-3 py-3 dark:bg-emerald-900/20">
              <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                Other times
              </legend>
              {proposal.alternatives.map((alternative) => (
                <label
                  key={alternative.at}
                  className="flex cursor-pointer items-center gap-2 text-sm text-emerald-900/80 dark:text-emerald-100/80"
                >
                  <input
                    type="radio"
                    name="alternative"
                    value={alternative.at}
                    disabled={busy !== null}
                    onChange={() =>
                      run("alternative", () =>
                        chooseAlternative({
                          proposalId: proposal.proposalId,
                          index: proposal.alternatives.findIndex(
                            (a) => a.at === alternative.at,
                          ),
                        }),
                      )
                    }
                  />
                  {alternative.atLocal}
                </label>
              ))}
              {proposal.alternatives.length === 0 && (
                <p className="text-sm text-emerald-900/60 dark:text-emerald-100/60">
                  No other times were offered for this match.
                </p>
              )}
            </fieldset>
          )}

          {declining && (
            <fieldset className="mt-3 space-y-1.5 rounded-sm border border-surface bg-emerald-50/40 px-3 py-3 dark:bg-emerald-900/20">
              <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                What was off?
              </legend>
              {DECLINE_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-emerald-900/80 dark:text-emerald-100/80"
                >
                  <input
                    type="radio"
                    name="decline-reason"
                    value={choice.value}
                    checked={declineReason === choice.value}
                    onChange={() => setDeclineReason(choice.value)}
                  />
                  {choice.label}
                </label>
              ))}
              <Button
                data-testid="confirm-decline"
                variant="outline"
                disabled={declineReason === null || busy !== null}
                className="rounded-sm border border-surface bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/70 dark:bg-emerald-950/50 dark:text-emerald-100/70"
                onClick={() =>
                  declineReason !== null &&
                  run("decline", () =>
                    decline({
                      proposalId: proposal.proposalId,
                      reason: declineReason,
                    }),
                  )
                }
              >
                {busy === "decline" ? "Passing…" : "Confirm"}
              </Button>
            </fieldset>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </motion.section>
  );
}
