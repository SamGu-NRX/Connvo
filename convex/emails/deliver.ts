/**
 * The scheduled send actions for matcher emails (docs/plan/MATCHING-PLAN.md,
 * steps 3-4).
 *
 * Mutations and queries cannot fetch, so they build drafts (internal queries
 * in convex/emails/drafts.ts) and schedule these actions. The provider is
 * selected at send time from the Convex environment: Resend when
 * RESEND_API_KEY is set, the console logger otherwise, so dev and CI need no
 * key.
 *
 * Retry safety: a multi-recipient send is ONE action that walks its drafts
 * and records a durable per-recipient sent marker (the idempotencyKeys
 * table, via withActionIdempotency) after each successful send before
 * moving on. A transient provider failure (TransientSendError — 429, 5xx,
 * network) neither aborts the other recipients nor abandons the failed one:
 * the action schedules its own bounded retry with backoff through the
 * Convex scheduler, which does not retry actions on its own. Every retry
 * re-runs the drafts query, so the reminder guard (null for a cancelled or
 * ended meeting) is checked again at retry time, and the per-recipient
 * markers make already-sent recipients skip instead of double-sending.
 * Refusals (4xx) are terminal: the provider drops them without throwing.
 * Resend receives the same key as its Idempotency-Key header, so even an
 * ambiguous failure — the send landed, the response was lost — cannot
 * double-send within Resend's 24-hour key window.
 */

import { internalAction } from "@convex/_generated/server";
import type { ActionCtx } from "@convex/_generated/server";
import { v } from "convex/values";
import { internal } from "@convex/_generated/api";
import {
  selectEmailProvider,
  TransientSendError,
  type EmailMessage,
} from "@convex/lib/email";
import { withActionIdempotency } from "@convex/lib/idempotency";

/** Attempts per recipient: the initial send plus two scheduled retries. */
const MAX_ATTEMPTS = 3;

/** Backoff before the retry that follows attempt 1 and attempt 2. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

/**
 * Marker TTL: outlives any retry chain and matches Resend's 24-hour
 * Idempotency-Key window, so a duplicate scheduling within a day is a skip.
 */
const MARKER_TTL_MS = 24 * 60 * 60_000;

/**
 * No provider timeout is configured. Convex runtime actions can run for 30
 * minutes, so 31 minutes prevents takeover while the original action is live.
 * A later attempt can recover a terminated action without waiting for the TTL.
 * Runtime limit: https://docs.convex.dev/production/state/limits
 */
const EXECUTION_LEASE_MS = 31 * 60_000;

const EMAIL_SCOPE = "email_send";

async function send(message: EmailMessage): Promise<void> {
  const provider = selectEmailProvider({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });
  await provider.send(message);
}

/**
 * Send one fully built message under its per-message-and-recipient key.
 * Settles silently when the marker says this exact message was already
 * sent; throws TransientSendError through when the provider says retry.
 */
async function sendOnce(
  ctx: ActionCtx,
  key: string,
  draft: EmailMessage,
): Promise<void> {
  await withActionIdempotency(
    ctx,
    {
      key,
      scope: EMAIL_SCOPE,
      ttlMs: MARKER_TTL_MS,
      leaseMs: EXECUTION_LEASE_MS,
      allowRetry: true,
    },
    async () => {
      await send({ ...draft, idempotencyKey: key });
      return "sent";
    },
  );
}

/**
 * Walk the drafts, one send per recipient under a stable idempotency key,
 * and schedule a bounded backoff retry when transient failures remain.
 * Returns a one-line summary for the Convex dashboard.
 */
async function deliverDrafts(
  ctx: ActionCtx,
  kind: string,
  entityId: string,
  drafts: EmailMessage[],
  attempt: number,
  scheduleRetry: (nextAttempt: number) => Promise<unknown>,
): Promise<string> {
  const stuck: string[] = [];
  const dropped: string[] = [];
  for (const draft of drafts) {
    const key = `${kind}:${entityId}:${draft.to}`;
    try {
      await sendOnce(ctx, key, draft);
    } catch (error) {
      if (error instanceof TransientSendError) {
        stuck.push(draft.to);
        continue;
      }
      // Not classified as transient, so it is not retried.
      dropped.push(draft.to);
      console.error(
        `[email:deliver] ${kind} ${entityId} to ${draft.to} failed terminally:`,
        error,
      );
    }
  }

  if (stuck.length > 0 && attempt < MAX_ATTEMPTS) {
    await scheduleRetry(attempt + 1);
    console.warn(
      `[email:deliver] ${kind} ${entityId}: attempt ${attempt}/${MAX_ATTEMPTS} left ${stuck.join(", ")} unsent; retry scheduled`,
    );
  } else if (stuck.length > 0) {
    console.error(
      `[email:deliver] ${kind} ${entityId}: giving up on ${stuck.join(", ")} after ${attempt} attempts`,
    );
  }

  const sent = drafts.length - stuck.length - dropped.length;
  const parts = [`attempt ${attempt}/${MAX_ATTEMPTS}`, `sent:${sent}`];
  if (dropped.length > 0) parts.push(`dropped:${dropped.join(",")}`);
  if (stuck.length > 0) parts.push(`retrying:${stuck.join(",")}`);
  return parts.join(" ");
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
  args: {
    proposalId: v.id("matchProposals"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { proposalId, attempt = 1 }): Promise<string> => {
    const drafts = await ctx.runQuery(
      internal.emails.drafts.introductionDrafts,
      { proposalId },
    );
    return await deliverDrafts(
      ctx,
      "introduction",
      proposalId,
      drafts,
      attempt,
      (next) =>
        ctx.scheduler.runAfter(
          RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[0],
          internal.emails.deliver.proposalIntroduced,
          { proposalId, attempt: next },
        ),
    );
  },
});

/** "Confirmed" with the .ics invite: one send per meeting participant. */
export const meetingConfirmed = internalAction({
  args: {
    meetingId: v.id("meetings"),
    reminderKinds: v.array(v.union(v.literal("24h"), v.literal("10min"))),
    attempt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { meetingId, reminderKinds, attempt = 1 },
  ): Promise<string> => {
    const drafts = await ctx.runQuery(internal.emails.drafts.confirmedDrafts, {
      meetingId,
      reminderKinds,
    });
    return await deliverDrafts(
      ctx,
      "confirmed",
      meetingId,
      drafts,
      attempt,
      (next) =>
        ctx.scheduler.runAfter(
          RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[0],
          internal.emails.deliver.meetingConfirmed,
          { meetingId, reminderKinds, attempt: next },
        ),
    );
  },
});

/**
 * A reminder: 24 hours or 10 minutes before a confirmed meeting. The drafts
 * query is the guard — null for a cancelled, ended or expired meeting — and
 * it re-runs on every retry, so a meeting cancelled between attempts sends
 * nothing more.
 */
export const sendReminder = internalAction({
  args: {
    meetingId: v.id("meetings"),
    kind: v.union(v.literal("24h"), v.literal("10min")),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { meetingId, kind, attempt = 1 }): Promise<string> => {
    const drafts = await ctx.runQuery(internal.emails.drafts.reminderDrafts, {
      meetingId,
      kind,
    });
    if (!drafts) return `skipped (guard: meeting not in a reminder window)`;
    return await deliverDrafts(
      ctx,
      `reminder-${kind}`,
      meetingId,
      drafts,
      attempt,
      (next) =>
        ctx.scheduler.runAfter(
          RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[0],
          internal.emails.deliver.sendReminder,
          { meetingId, kind, attempt: next },
        ),
    );
  },
});
