/**
 * The scheduled send actions for matcher emails (docs/plan/MATCHING-PLAN.md,
 * steps 3-4).
 *
 * Mutations and queries cannot fetch, so they build drafts (internal queries
 * in convex/emails/drafts.ts) and schedule these actions. The provider is
 * selected at send time from the Convex environment: Resend when
 * RESEND_API_KEY is set, the console logger otherwise, so dev and CI need no
 * key.
 */

import { internalAction } from "@convex/_generated/server";
import { v } from "convex/values";
import { internal } from "@convex/_generated/api";
import {
  selectEmailProvider,
  type EmailMessage,
} from "@convex/lib/email";

async function send(message: EmailMessage): Promise<void> {
  const provider = selectEmailProvider({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });
  await provider.send(message);
}

/** The one primitive: send a fully built message through the provider. */
export const deliverEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.string(),
    attachmentFilename: v.optional(v.string()),
    attachmentBase64: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await send({
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      ...(args.attachmentFilename && args.attachmentBase64
        ? {
            attachment: {
              filename: args.attachmentFilename,
              base64: args.attachmentBase64,
            },
          }
        : {}),
    });
    return null;
  },
});

/** "You have a new introduction": one send per person of the pair. */
export const proposalIntroduced = internalAction({
  args: { proposalId: v.id("matchProposals") },
  handler: async (ctx, { proposalId }) => {
    const drafts = await ctx.runQuery(internal.emails.drafts.introductionDrafts, {
      proposalId,
    });
    for (const draft of drafts) {
      await send(draft);
    }
    return null;
  },
});

/** "Confirmed" with the .ics invite: one send per meeting participant. */
export const meetingConfirmed = internalAction({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const drafts = await ctx.runQuery(internal.emails.drafts.confirmedDrafts, {
      meetingId,
    });
    for (const draft of drafts) {
      await send(draft);
    }
    return null;
  },
});

/**
 * A reminder: 24 hours or 10 minutes before a confirmed meeting. The drafts
 * query is the guard — null for a cancelled, ended or expired meeting, and
 * the action skips, so nothing sends.
 */
export const sendReminder = internalAction({
  args: { meetingId: v.id("meetings"), kind: v.union(v.literal("24h"), v.literal("10min")) },
  handler: async (ctx, { meetingId, kind }) => {
    const drafts = await ctx.runQuery(internal.emails.drafts.reminderDrafts, {
      meetingId,
      kind,
    });
    if (!drafts) return "skipped";
    for (const draft of drafts) {
      await send(draft);
    }
    return "sent";
  },
});
