// Eval-only helpers for scoring calls over Convex (tools/call-eval, --signaling=convex).
// Internal functions: no client can call them on any deployment; the harness
// runs them with `npx convex run`. The CONNVO_LOCAL_TEST_JWKS check is a
// second guard, as in devEval/seed.ts.
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";

function requireEvalBackend(name: string): void {
  if (!process.env.CONNVO_LOCAL_TEST_JWKS) {
    throw new Error(
      `devEval/callMeeting:${name} refuses to run: CONNVO_LOCAL_TEST_JWKS is not set on this deployment; ` +
        "eval helpers are restricted to the local anonymous backend",
    );
  }
}

/**
 * A fresh active meeting with the seeded users A (host), B and C, so each
 * scored scenario starts with no sessions or signals left by the previous
 * one. Requires devEval/seed to have run.
 */
export const create = internalMutation({
  args: { title: v.optional(v.string()) },
  returns: v.object({ meetingId: v.id("meetings") }),
  handler: async (ctx, { title }) => {
    requireEvalBackend("create");
    const ids: Record<string, Id<"users">> = {};
    for (const subject of ["local-test-a", "local-test-b", "local-test-c"]) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
        .unique();
      if (!user)
        throw new Error(
          `seeded user ${subject} is missing; run devEval/seed first`,
        );
      ids[subject] = user._id;
    }
    const now = Date.now();
    const meetingId = await ctx.db.insert("meetings", {
      organizerId: ids["local-test-a"],
      title: title ?? "Eval call",
      scheduledAt: now,
      duration: 30 * 60_000,
      webrtcEnabled: true,
      state: "active",
      participantCount: 3,
      createdAt: now,
      updatedAt: now,
    });
    for (const [subject, role] of [
      ["local-test-a", "host"],
      ["local-test-b", "participant"],
      ["local-test-c", "participant"],
    ] as const) {
      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId: ids[subject],
        role,
        presence: "joined",
        joinedAt: now,
        createdAt: now,
      });
    }
    await ctx.db.insert("meetingState", {
      meetingId,
      active: true,
      topics: [],
      recordingEnabled: false,
      updatedAt: now,
    });
    return { meetingId };
  },
});

/** Closed call sessions in a meeting and why they closed (H-10/H-11 evidence). */
export const sessionEvents = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    events: v.array(
      v.object({ participant: v.string(), reason: v.string(), at: v.number() }),
    ),
  }),
  handler: async (ctx, { meetingId }) => {
    requireEvalBackend("sessionEvents");
    const sessions = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const out = [];
    for (const s of sessions) {
      if (s.state !== "closed") continue;
      const user = await ctx.db.get(s.userId);
      out.push({
        participant: user?.workosUserId ?? "",
        reason: s.closedReason ?? "closed",
        at: s.updatedAt,
      });
    }
    return { events: out.sort((a, b) => a.at - b.at) };
  },
});

/** The stored shared-notes text for a meeting (the notes proof's server truth). */
export const notes = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.object({ content: v.string(), version: v.number() }),
  handler: async (ctx, { meetingId }) => {
    requireEvalBackend("notes");
    const row = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    return { content: row?.content ?? "", version: row?.version ?? 0 };
  },
});

/** Open (not closed) call sessions in a meeting: the leave-cleanup leak check.
 *  Returns an object wrapper because the eval runner's parseRunOutput only
 *  accepts JSON objects, never bare arrays. */
export const openSessions = internalQuery({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    sessions: v.array(
      v.object({
        participant: v.string(),
        state: v.string(),
        updatedAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { meetingId }) => {
    requireEvalBackend("openSessions");
    const sessions = await ctx.db
      .query("webrtcSessions")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const out = [];
    for (const s of sessions) {
      if (s.state === "closed") continue;
      const user = await ctx.db.get(s.userId);
      out.push({
        participant: user?.workosUserId ?? "",
        state: s.state,
        updatedAt: s.updatedAt,
      });
    }
    return { sessions: out.sort((a, b) => a.updatedAt - b.updatedAt) };
  },
});
