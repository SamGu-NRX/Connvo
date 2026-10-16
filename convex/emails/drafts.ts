/**
 * Email drafts for the matcher (docs/plan/MATCHING-PLAN.md, steps 3-4).
 *
 * Drafts are built as queries — transactional reads, no side effects — and
 * the scheduled actions in convex/emails/deliver.ts send them through the
 * provider (convex/lib/email.ts). Three emails exist:
 *
 * - a new introduction, written when the matcher proposes a pair;
 * - a confirmation with the .ics invite, when both people accept;
 * - reminders 24 hours and 10 minutes before a confirmed meeting, which
 *   return no draft for a cancelled, ended or past meeting, so a reminder
 *   can never fire for one.
 */

import { internalQuery } from "@convex/_generated/server";
import type { QueryCtx } from "@convex/_generated/server";
import { v } from "convex/values";
import type { Id } from "@convex/_generated/dataModel";
import { internal } from "@convex/_generated/api";
import { buildCalendarExport } from "../lib/ics";
import { formatInZone, MEETING_DURATION_MS } from "@convex/matching/proposals";
import type { EmailMessage } from "@convex/lib/email";

export const reminderKinds = v.union(v.literal("24h"), v.literal("10min"));
export type ReminderKind = "24h" | "10min";

/** The deployment's URL; emails link the join page and the home screen. */
function appUrl(): string {
  return process.env.CONNVO_APP_URL ?? "http://localhost:3000";
}

/** UTF-8-safe base64 (Resend attachments want base64; ics text may be unicode). */
function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function joinUrlFor(meetingId: Id<"meetings">): string {
  return `${appUrl()}/app/call/${meetingId}`;
}

/** Minimal, calm HTML wrapper: one heading, a few paragraphs, one button. */
function emailHtml(title: string, paragraphs: string[], cta?: { label: string; href: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("");
  const button = cta
    ? `<a href="${cta.href}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px">${cta.label}</a>`
    : "";
  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px">',
    `<h2 style="margin:0 0 16px;font-size:18px">${title}</h2>`,
    body,
    button,
    '<p style="margin:20px 0 0;font-size:12px;color:#64748b">Connvo — one good conversation at a time</p>',
    "</div>",
  ].join("");
}

/** One draft per meeting participant, in their own timezone. */
async function draftsFor(
  ctx: QueryCtx,
  participantIds: Id<"users">[],
  build: (args: {
    to: string;
    myName: string;
    partnerName: string;
    timeZone: string;
  }) => { subject: string; text: string; html: string; attachment?: EmailMessage["attachment"] },
): Promise<EmailMessage[]> {
  const drafts: EmailMessage[] = [];
  for (const userId of participantIds) {
    const user = await ctx.db.get(userId);
    if (!user?.email) continue;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const others = participantIds.filter((id) => id !== userId);
    const partnerProfile = others[0]
      ? await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", others[0]))
          .unique()
      : undefined;
    const draft = build({
      to: user.email,
      myName: profile?.displayName ?? "Connvo member",
      partnerName: partnerProfile?.displayName ?? "a Connvo member",
      timeZone: profile?.timezone ?? "UTC",
    });
    drafts.push({ to: user.email, ...draft });
  }
  return drafts;
}

/** The two people of a proposal, from its stored pair. */
function proposalParticipants(
  row: { userAId: Id<"users">; userBId: Id<"users"> },
): Id<"users">[] {
  return [row.userAId, row.userBId];
}

/** The participants of a meeting. */
async function meetingParticipants(
  ctx: QueryCtx,
  meetingId: Id<"meetings">,
): Promise<Id<"users">[]> {
  return (
    await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect()
  ).map((row) => row.userId);
}

/** "You have a new introduction", written when the matcher proposes a pair. */
export const introductionDrafts = internalQuery({
  args: { proposalId: v.id("matchProposals") },
  handler: async (ctx, { proposalId }): Promise<EmailMessage[]> => {
    const row = await ctx.db.get(proposalId);
    if (!row) return [];
    return await draftsFor(ctx, proposalParticipants(row), ({ to, partnerName, timeZone }) => {
      const at = formatInZone(row.scheduledAt, timeZone);
      const reasonLines = row.reasons.map((reason) => `· ${reason}`).join("\n");
      const subject = `New introduction: ${partnerName}`;
      const text = [
        `Connvo found someone for you: ${partnerName}.`,
        "",
        `Why you two:`,
        reasonLines,
        "",
        `Suggested first question: ${row.firstQuestion}`,
        `Proposed time: ${at} (your timezone)`,
        "",
        `Accept, pick another time, or pass — from your home screen: ${appUrl()}/app`,
      ].join("\n");
      const html = emailHtml(
        `Connvo found someone for you: ${partnerName}`,
        [
          `<strong>Why you two</strong><br/>${row.reasons.map((r) => `· ${r}`).join("<br/>")}`,
          `<strong>Suggested first question</strong><br/>${row.firstQuestion}`,
          `<strong>Proposed time</strong><br/>${at} (your timezone)`,
        ],
        { label: "See your introduction", href: `${appUrl()}/app` },
      );
      return { to, subject, text, html };
    });
  },
});

/** Confirmation with the .ics invite, written when both people accept. */
export const confirmedDrafts = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    reminderKinds: v.array(reminderKinds),
  },
  handler: async (ctx, { meetingId, reminderKinds: scheduledReminderKinds }): Promise<EmailMessage[]> => {
    const row = await ctx.db
      .query("matchProposals")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    if (!row || row.state !== "confirmed") return [];
    const participants = await meetingParticipants(ctx, meetingId);
    return await draftsFor(ctx, participants, ({ to, myName, partnerName, timeZone }) => {
      const at = formatInZone(row.scheduledAt, timeZone);
      const joinUrl = joinUrlFor(meetingId);
      const ics = buildCalendarExport({
        meetingId,
        title: `Connvo: ${myName} & ${partnerName}`,
        description: `Suggested first question: ${row.firstQuestion}\nJoin: ${joinUrl}`,
        scheduledAt: row.scheduledAt,
        durationMs: MEETING_DURATION_MS,
        state: "scheduled",
        updatedAt: Date.now(),
      });
      const reminderText =
        scheduledReminderKinds.length === 2
          ? "We'll remind you 24 hours and 10 minutes before."
          : scheduledReminderKinds.includes("24h")
            ? "We'll remind you 24 hours before."
            : scheduledReminderKinds.includes("10min")
              ? "We'll remind you 10 minutes before."
              : "No reminders are scheduled.";
      const subject = `Confirmed: you and ${partnerName}, ${at}`;
      const text = [
        `You and ${partnerName} both said yes.`,
        "",
        `When: ${at} (your timezone), for 30 minutes`,
        `Where: ${joinUrl}`,
        `Suggested first question: ${row.firstQuestion}`,
        "",
        `The calendar invite is attached. ${reminderText}`,
      ].join("\n");
      const html = emailHtml(
        `You and ${partnerName} both said yes`,
        [
          `<strong>When</strong><br/>${at} (your timezone), for 30 minutes`,
          `<strong>Suggested first question</strong><br/>${row.firstQuestion}`,
          `The calendar invite is attached. ${reminderText}`,
        ],
        { label: "Open the lobby", href: joinUrl },
      );
      return {
        to,
        subject,
        text,
        html,
        attachment: ics
          ? { filename: "connvo-chat.ics", base64: utf8Base64(ics) }
          : undefined,
      };
    });
  },
});

/**
 * Reminder drafts, or null when the reminder must not send: the meeting is
 * cancelled or already over, or its proposal is not confirmed. This guard is
 * what makes "a reminder is never sent for a cancelled or expired meeting"
 * hold — the send action skips whenever this returns null.
 */
export const reminderDrafts = internalQuery({
  args: { meetingId: v.id("meetings"), kind: reminderKinds },
  handler: async (ctx, { meetingId, kind }): Promise<EmailMessage[] | null> => {
    const meeting = await ctx.db.get(meetingId);
    if (!meeting || !meeting.scheduledAt) return null;
    if (meeting.state !== "scheduled") return null;
    const now = Date.now();
    const start = meeting.scheduledAt;
    // Never after the start (a late or expired window); the 24-hour reminder
    // also stands down within 30 minutes of the start, where the 10-minute
    // reminder takes over.
    if (now >= start) return null;
    if (kind === "24h" && now >= start - 30 * 60_000) return null;

    const row = await ctx.db
      .query("matchProposals")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    if (!row || row.state !== "confirmed") return null;

    const participants = await meetingParticipants(ctx, meetingId);
    return await draftsFor(ctx, participants, ({ to, partnerName, timeZone }) => {
      const at = formatInZone(start, timeZone);
      const joinUrl = joinUrlFor(meetingId);
      const lead = kind === "24h" ? "Tomorrow" : "Starting soon";
      const subject = `${lead}: you and ${partnerName}, ${at}`;
      const text = [
        kind === "24h"
          ? `Your Connvo chat with ${partnerName} is in about 24 hours.`
          : `Your Connvo chat with ${partnerName} starts in about 10 minutes.`,
        "",
        `When: ${at} (your timezone)`,
        `Where: ${joinUrl}`,
        `Suggested first question: ${row.firstQuestion}`,
      ].join("\n");
      const html = emailHtml(
        `${lead}: your chat with ${partnerName}`,
        [
          `<strong>When</strong><br/>${at} (your timezone)`,
          `<strong>Suggested first question</strong><br/>${row.firstQuestion}`,
        ],
        { label: "Open the lobby", href: joinUrl },
      );
      return { to, subject, text, html };
    });
  },
});
