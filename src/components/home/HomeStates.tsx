"use client";

/**
 * The home screen's calm states (docs/plan/MATCHING-PLAN.md, steps 5-6):
 * nothing pending with a next matcher run, the last declined or expired
 * outcome said plainly, and an availability nudge when the profile cannot
 * feed the matcher yet.
 */

import Link from "next/link";
import { CalendarClock, Sparkles } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

export type HomeView = FunctionReturnType<typeof api.matching.home.myHomeView>;

export function HomeStates({ view }: { view: NonNullable<HomeView> }) {
  const outcomeCopy = view.lastOutcome
    ? view.lastOutcome.state === "declined"
      ? "You passed on the last match — the next run will bring someone else."
      : "The last invitation timed out before anyone accepted."
    : null;

  return (
    <section
      data-testid="home-states"
      className="rounded-sm border border-surface bg-white/95 px-4 py-4 dark:bg-emerald-950/40"
    >
      {!view.availabilityReady ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300/80">
            Almost there
          </p>
          <h2 className="mt-2 text-lg font-semibold text-emerald-900 dark:text-white">
            The matcher needs a little more from you
          </h2>
          <p className="mt-1 text-sm text-emerald-900/70 dark:text-emerald-100/70">
            Tell us {view.missingAvailability.join(", ")} and the matcher will
            start proposing people at its next run.
          </p>
          <Link
            href="/app/settings#matching"
            className="mt-3 inline-flex items-center gap-1.5 rounded-sm bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-emerald-600"
          >
            <Sparkles aria-hidden="true" />
            Set your free times
          </Link>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300/80">
            Nothing pending
          </p>
          <h2 className="mt-2 text-lg font-semibold text-emerald-900 dark:text-white">
            {outcomeCopy ??
              "You're all set — the matcher is working on your next conversation."}
          </h2>
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-emerald-900/70 dark:text-emerald-100/70">
            <CalendarClock aria-hidden="true" className="h-4 w-4" />
            Next matcher run: {view.nextRunAtLocal} · your timezone
          </p>
          <p className="mt-2 text-sm text-emerald-900/60 dark:text-emerald-100/60">
            Meanwhile, jump into a live queue below.
          </p>
        </>
      )}
    </section>
  );
}
