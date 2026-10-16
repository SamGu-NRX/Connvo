import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertMeetingAccess } from "../auth/guards";
import { PROMPT_BANK } from "./bank";
import { selectPrompt } from "./selection";

// Product limits, not calibrated thresholds: leave time to discuss each idea,
// bound repeated manual requests, and cap cost even in an abandoned open tab.
const AUTO_MS = 90_000;
const MANUAL_GAP_MS = 10_000;
const MANUAL_WINDOW_MS = 10 * 60_000;
const MANUAL_CAP = 5;
const SESSION_CAP = 40;
const LEASE_MS = 15_000; // Longer than the 5 s provider deadline; crashes recover.
const meetingArgs = { meetingId: v.id("meetings") };
const sessionFor = (ctx: QueryCtx, meetingId: Id<"meetings">) =>
  ctx.db
    .query("livePromptSessions")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .unique();
const notesFor = (ctx: QueryCtx, meetingId: Id<"meetings">) =>
  ctx.db
    .query("meetingNotes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .unique();

export const current = query({
  args: meetingArgs,
  handler: async (ctx, { meetingId }) => {
    await assertMeetingAccess(ctx, meetingId);
    const [meeting, session, notes] = await Promise.all([
      ctx.db.get(meetingId),
      sessionFor(ctx, meetingId),
      notesFor(ctx, meetingId),
    ]);
    const prompt = session?.currentPromptId
      ? await ctx.db.get(session.currentPromptId)
      : null;
    const requests = session?.manualRequests ?? [];
    // The fifth most recent request determines the rolling-window release time.
    const windowRelease =
      requests.length >= MANUAL_CAP
        ? requests[requests.length - MANUAL_CAP] + MANUAL_WINDOW_MS
        : 0;
    return {
      prompt: prompt
        ? {
            id: prompt._id,
            content: prompt.content,
            used: prompt.usedAt !== undefined,
          }
        : null,
      active: meeting?.state === "active",
      exhausted:
        (session?.requestCount ?? session?.shown.length ?? 0) >= SESSION_CAP,
      autoPaused: session?.autoPaused ?? false,
      nextAutoAt: Math.max(
        session?.lastAutoRequestAt ? session.lastAutoRequestAt + AUTO_MS : 0,
        session?.currentPromptId
          ? Math.max(session.lastPickAt, notes?.updatedAt ?? 0) + AUTO_MS
          : 0,
      ),
      nextManualAt: Math.max(
        session ? session.lastPickAt + MANUAL_GAP_MS : 0,
        windowRelease,
      ),
      pendingUntil: session?.reservation
        ? session.reservation.at + LEASE_MS
        : 0,
    };
  },
});

export const reserve = internalMutation({
  args: { ...meetingArgs, automatic: v.boolean(), reservationId: v.string() },
  handler: async (ctx, { meetingId, automatic, reservationId }) => {
    await assertMeetingAccess(ctx, meetingId);
    const meeting = await ctx.db.get(meetingId);
    if (!meeting || meeting.state !== "active")
      return { status: "inactive" } as const;
    const now = Date.now();
    const [session, notes] = await Promise.all([
      sessionFor(ctx, meetingId),
      notesFor(ctx, meetingId),
    ]);
    if (session?.reservation && now < session.reservation.at + LEASE_MS)
      return { status: "pending" } as const;
    if ((session?.requestCount ?? session?.shown.length ?? 0) >= SESSION_CAP)
      return { status: "exhausted" } as const;
    const manualRequests = (session?.manualRequests ?? []).filter(
      (at) => now - at < MANUAL_WINDOW_MS,
    );
    if (automatic) {
      if (session?.autoPaused) return { status: "paused" } as const;
      // Charge attempts before external work: discarded results and crashed
      // actions must not bypass the 90-second limit or the per-call budget.
      if (
        session?.lastAutoRequestAt &&
        now < session.lastAutoRequestAt + AUTO_MS
      )
        return { status: "idle_wait" } as const;
      if (
        session?.currentPromptId &&
        now < Math.max(session.lastPickAt, notes?.updatedAt ?? 0) + AUTO_MS
      )
        return { status: "idle_wait" } as const;
    } else if (
      (session && now < session.lastPickAt + MANUAL_GAP_MS) ||
      manualRequests.length >= MANUAL_CAP
    ) {
      return { status: "rate_limited" } as const;
    }
    const reservation = {
      id: reservationId,
      at: now,
      automatic,
      notesUpdatedAt: notes?.updatedAt ?? 0,
    };
    if (session)
      await ctx.db.patch(session._id, {
        reservation,
        requestCount: (session.requestCount ?? session.shown.length) + 1,
        lastAutoRequestAt: automatic ? now : session.lastAutoRequestAt,
        manualRequests: automatic ? manualRequests : [...manualRequests, now],
      });
    else
      await ctx.db.insert("livePromptSessions", {
        meetingId,
        shown: [],
        lastPickAt: 0,
        requestCount: 1,
        ...(automatic ? { lastAutoRequestAt: now } : {}),
        manualRequests: automatic ? [] : [now],
        autoPaused: false,
        reservation,
      });
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const profiles = await Promise.all(
      participants.map(async (p) => {
        const [profile, interests] = await Promise.all([
          ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", p.userId))
            .unique(),
          ctx.db
            .query("userInterests")
            .withIndex("by_user", (q) => q.eq("userId", p.userId))
            .collect(),
        ]);
        return {
          interests: interests.map((i) => i.interestKey),
          role: [profile?.jobTitle, profile?.field].filter(Boolean).join(" / "),
        };
      }),
    );
    const state = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    return {
      status: "reserved",
      context: {
        participants: profiles,
        // The same start the recap counts from: when the live call started.
        // Before the call has a recorded start, nothing has elapsed — the
        // old fallback to the meeting's creation counted the pre-call wait
        // into prompt timing.
        elapsedSeconds: state?.startedAt
          ? Math.max(0, (now - state.startedAt) / 1000)
          : 0,
        durationSeconds:
          meeting.duration && meeting.duration > 0
            ? meeting.duration / 1000
            : 1800,
        shown: session?.shown ?? [],
        notes: notes?.content ?? "",
      },
    } as const;
  },
});

export const publish = internalMutation({
  args: {
    ...meetingArgs,
    reservationId: v.string(),
    bankId: v.string(),
    probability: v.number(),
  },
  handler: async (ctx, { meetingId, reservationId, bankId, probability }) => {
    // Recheck access and lifecycle after the external request.
    await assertMeetingAccess(ctx, meetingId);
    const session = await sessionFor(ctx, meetingId);
    if (!session?.reservation || session.reservation.id !== reservationId)
      return false;
    const meeting = await ctx.db.get(meetingId);
    const notes = await notesFor(ctx, meetingId);
    const discard =
      meeting?.state !== "active" ||
      (session.reservation.automatic &&
        (session.autoPaused ||
          (notes?.updatedAt ?? 0) !== session.reservation.notesUpdatedAt));
    if (discard) {
      await ctx.db.patch(session._id, { reservation: undefined });
      return false;
    }
    const prompt = PROMPT_BANK.find((p) => p.id === bankId);
    if (!prompt || session.shown.includes(bankId))
      throw new Error("Invalid or already shown prompt");
    const now = Date.now();
    const promptId = await ctx.db.insert("prompts", {
      meetingId,
      type: "incall",
      content: prompt.content,
      tags: [...prompt.tags, "live-prompt", prompt.stage],
      relevance: probability,
      createdAt: now,
    });
    await ctx.db.patch(session._id, {
      currentPromptId: promptId,
      shown: [...session.shown, bankId],
      lastPickAt: now,
      reservation: undefined,
    });
    return true;
  },
});

export const pick = action({
  args: { ...meetingArgs, automatic: v.boolean() },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const reservationId = crypto.randomUUID();
    const reserved = await ctx.runMutation(internal.prompts.live.reserve, {
      ...args,
      reservationId,
    });
    if (reserved.status !== "reserved") return { status: reserved.status };
    const selected = await selectPrompt(reserved.context, {
      key: process.env.OPENAI_API_KEY,
    });
    if (!selected) return { status: "exhausted" };
    const published = await ctx.runMutation(internal.prompts.live.publish, {
      meetingId: args.meetingId,
      reservationId,
      bankId: selected.prompt.id,
      probability: selected.probability,
    });
    return { status: published ? "shown" : "superseded" };
  },
});

export const markUsed = mutation({
  args: { ...meetingArgs, promptId: v.id("prompts") },
  handler: async (ctx, { meetingId, promptId }) => {
    await assertMeetingAccess(ctx, meetingId);
    const prompt = await ctx.db.get(promptId);
    if (
      !prompt ||
      prompt.meetingId !== meetingId ||
      !prompt.tags.includes("live-prompt")
    )
      throw new Error("Prompt does not belong to this call");
    if (prompt.usedAt === undefined)
      await ctx.db.patch(promptId, { usedAt: Date.now(), feedback: "used" });
    return null;
  },
});

export const pauseAuto = mutation({
  args: { ...meetingArgs, paused: v.boolean() },
  handler: async (ctx, { meetingId, paused }) => {
    await assertMeetingAccess(ctx, meetingId);
    const session = await sessionFor(ctx, meetingId);
    if (session) await ctx.db.patch(session._id, { autoPaused: paused });
    else
      await ctx.db.insert("livePromptSessions", {
        meetingId,
        shown: [],
        lastPickAt: 0,
        manualRequests: [],
        autoPaused: paused,
      });
    return null;
  },
});
