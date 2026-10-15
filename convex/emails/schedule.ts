/**
 * Reminder scheduling for confirmed meetings (docs/plan/MATCHING-PLAN.md,
 * step 4: "email reminders 24 hours and 10 minutes before").
 *
 * Called from the second accept in convex/matching/proposals.ts, which is the
 * moment a meeting exists. The scheduled sends guard themselves at fire time
 * (convex/emails/drafts.ts reminderDrafts): a meeting that was cancelled or
 * ended in the meantime, or whose window has passed, sends nothing.
 */

import type { MutationCtx } from "@convex/_generated/server";
import type { Id } from "@convex/_generated/dataModel";
import { internal } from "@convex/_generated/api";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60_000;
const TEN_MINUTES_MS = 10 * 60_000;

/**
 * Schedules the confirmation email and both reminders for a newly confirmed
 * meeting. A reminder whose scheduled moment is already past (the meeting is
 * less than 24 hours out) fires immediately after confirmation; the drafts
 * guard keeps its content honest and skips it entirely inside the final 30
 * minutes, where the 10-minute reminder takes over.
 */
export async function scheduleMeetingEmails(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  scheduledAt: number,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.emails.deliver.meetingConfirmed,
    { meetingId },
  );
  await ctx.scheduler.runAt(
    scheduledAt - TWENTY_FOUR_HOURS_MS,
    internal.emails.deliver.sendReminder,
    { meetingId, kind: "24h" },
  );
  await ctx.scheduler.runAt(
    scheduledAt - TEN_MINUTES_MS,
    internal.emails.deliver.sendReminder,
    { meetingId, kind: "10min" },
  );
}
