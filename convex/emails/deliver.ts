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
 * Refusals (4xx) are not retried: they leave the marker failed and
 * non-retryable, so a duplicate invocation skips that recipient rather than
 * sending again, and the action itself throws once every recipient has been
 * tried, so a refused person is never recorded as sent. Resend receives a SHA-256 digest of the
 * same key as its Idempotency-Key header, so even an ambiguous failure —
 * the send landed, the response was lost — cannot double-send within
 * Resend's 24-hour key window.
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
 * Resend rejects an Idempotency-Key longer than 256 characters with a 400,
 * and the raw key embeds the recipient address, which has no such bound.
 * A SHA-256 hex digest of the whole key is always 64 characters; the kind
 * prefix keeps it readable in Resend's logs. Hashing uses Web Crypto
 * (crypto.subtle), which the default Convex runtime provides, so this file
 * needs no "use node".
 */
async function resendIdempotencyKey(
  kind: string,
  key: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${kind}:${hex}`;
}

/**
 * Send one fully built message under its per-message-and-recipient key.
 * Settles silently when the marker says this exact message was already
 * sent or terminally refused; otherwise any provider error
 * (TransientSendError for a retry, RefusedSendError for a refusal)
 * propagates and leaves the marker failed.
 */
async function sendOnce(
  ctx: ActionCtx,
  kind: string,
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
      // Only a transient failure may be re-sent by a later invocation. A
      // refusal (or anything unclassified, which deliverDrafts also treats
      // as terminal) keeps its failed marker, so a duplicate scheduling of
      // the same message skips the recipient instead of calling the
      // provider again.
      isRetryable: (error) => error instanceof TransientSendError,
    },
    async () => {
      // The marker keeps the full readable key; Resend gets the bounded
      // digest, since a long address would push the raw key past its
      // 256-character limit and turn every send into a 400.
      await send({
        ...draft,
        idempotencyKey: await resendIdempotencyKey(kind, key),
      });
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
      await sendOnce(ctx, kind, key, draft);
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
  // A refusal fails the action, after every other recipient was tried and
  // any retry was scheduled, so it shows as a failed run in the dashboard
  // rather than a successful one with a summary nobody reads.
  if (dropped.length > 0) {
    throw new Error(`[email:deliver] ${kind} ${entityId}: ${parts.join(" ")}`);
  }
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
