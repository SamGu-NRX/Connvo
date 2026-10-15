// Internal fixtures for the local queue-to-call browser proof. Never client-callable.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { entryForUser, leaveQueue } from "../matching/callQueue";

function requireLocalTestBackend() {
  if (!process.env.CONNVO_LOCAL_TEST_JWKS)
    throw new Error("queueProof requires the local test identity backend");
}

export const prepare = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireLocalTestBackend();
    for (const subject of [
      "local-test-a",
      "local-test-b",
      "local-test-c",
      "local-test-o",
    ]) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
        .unique();
      if (!user) throw new Error(`Run devEval/seed first: ${subject} missing`);
      await leaveQueue(ctx, user._id);
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      if (!profile)
        await ctx.db.insert("profiles", {
          userId: user._id,
          displayName: user.displayName ?? subject,
          languages: ["English"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      const interests = await ctx.db
        .query("userInterests")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      if (!interests.some((i) => i.interestKey === "technology"))
        await ctx.db.insert("userInterests", {
          userId: user._id,
          interestKey: "technology",
          createdAt: Date.now(),
        });
    }
    return { prepared: 4 };
  },
});

export const expire = internalMutation({
  args: {
    subject: v.string(),
    kind: v.union(v.literal("queue"), v.literal("match")),
  },
  handler: async (ctx, { subject, kind }) => {
    requireLocalTestBackend();
    if (!/^local-test-[abco]$/.test(subject))
      throw new Error("Only harness identities may be expired");
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
      .unique();
    if (!user) throw new Error("Seeded user missing");
    const entry = await entryForUser(ctx, user._id);
    if (!entry) throw new Error("Queue entry missing");
    const expiresAt = Date.now();
    if (kind === "queue") {
      await ctx.db.patch(entry._id, { expiresAt });
      await ctx.scheduler.runAfter(0, internal.matching.queue.expireEntry, {
        entryId: entry._id,
        expiresAt,
      });
    } else {
      if (!entry.matchId) throw new Error("Pending match missing");
      await ctx.db.patch(entry.matchId, { expiresAt });
      await ctx.scheduler.runAfter(0, internal.matching.queue.expireMatch, {
        matchId: entry.matchId,
      });
    }
    return { expiresAt };
  },
});

export const meeting = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    requireLocalTestBackend();
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const identities = await Promise.all(
      participants.map(async (p) => ({
        subject: (await ctx.db.get(p.userId))?.workosUserId,
        role: p.role,
      })),
    );
    return { meeting: await ctx.db.get(meetingId), participants: identities };
  },
});
