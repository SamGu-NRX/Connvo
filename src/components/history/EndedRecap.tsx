"use client";

/**
 * The after-call pieces of the call page: a link to the recap on the
 * "You left the call" screen, and a compact recap beside it. Both render
 * nothing unless NEXT_PUBLIC_CONNVO_AFTER_CALL is on.
 */
import type { Id } from "@convex/_generated/dataModel";
import { isAfterCallEnabled } from "@/lib/featureFlags";
import { MeetingRecap } from "./MeetingRecap";

const recapHref = (meetingId: string) => `/app/meetings/${meetingId}`;

// Plain links, not next/link: leaving the call page with a full page load
// ends its media and connections for certain. A client-side transition from
// the ended call page also never committed in the eval runs (the request
// was served, the URL did not change); the cause was not found.

/** For the dark ended screen of the call room. */
export function OpenRecapLink({ meetingId }: { meetingId: string }) {
  if (!isAfterCallEnabled()) return null;
  return (
    <a
      href={recapHref(meetingId)}
      data-testid="open-recap"
      className="grid h-11 place-items-center rounded-md bg-white/10 px-5 text-sm font-medium outline-none hover:bg-white/15 focus-visible:ring-[3px] focus-visible:ring-emerald-400/50"
    >
      Open the recap
    </a>
  );
}

export function EndedRecap({ meetingId }: { meetingId: string }) {
  if (!isAfterCallEnabled()) return null;
  return (
    <section
      aria-labelledby="ended-recap-title"
      data-testid="ended-recap"
      className="bg-card mb-3 flex flex-col gap-4 rounded-xl border p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ended-recap-title" className="font-semibold">
          What this meeting recorded
        </h2>
        <a
          href={recapHref(meetingId)}
          className="text-primary shrink-0 text-sm underline-offset-4 hover:underline"
        >
          Full recap
        </a>
      </div>
      <MeetingRecap meetingId={meetingId as Id<"meetings">} compact />
    </section>
  );
}
