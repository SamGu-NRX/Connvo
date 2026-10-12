// Read-only verification query for the eval seed (devEval/seed.ts): returns
// the seeded shape the browser proof needs — users A/B/C + outsider O, the
// one active meeting, its meetingParticipants rows (A host, then B and C;
// outsider O deliberately has NO row — that absence is what H-14 exercises)
// and the meetingState row. Env-gated like the seed: read-only, but refused
// off the eval backend.
import { v } from "convex/values";
import { query } from "../_generated/server";

export const shape = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    if (!process.env.CONNVO_LOCAL_TEST_JWKS) {
      throw new Error(
        "devEval/shape refuses to run: CONNVO_LOCAL_TEST_JWKS is not set on this deployment; " +
          "seed verification is restricted to the local anonymous backend",
      );
    }

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      return { found: false, meeting: null, users: [], participants: [], meetingState: null };
    }

    const participants = await ctx.db
      .query("meetingParticipants")
      .filter((q) => q.eq(q.field("meetingId"), args.meetingId))
      .collect();

    const users = [];
    for (const subject of ["local-test-a", "local-test-b", "local-test-c", "local-test-o"]) {
      const u = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
        .first();
      if (u) {
        users.push({
          workosUserId: u.workosUserId,
          email: u.email,
          displayName: u.displayName ?? null,
          isActive: u.isActive,
        });
      }
    }

    const participantRows = [];
    for (const p of participants) {
      const user = await ctx.db.get(p.userId);
      participantRows.push({
        workosUserId: user?.workosUserId ?? null,
        role: p.role,
        presence: p.presence,
        joinedAt: p.joinedAt ?? null,
      });
    }

    const meetingState = await ctx.db
      .query("meetingState")
      .filter((q) => q.eq(q.field("meetingId"), args.meetingId))
      .first();

    const organizer = await ctx.db.get(meeting.organizerId);

    return {
      found: true,
      meeting: {
        title: meeting.title,
        state: meeting.state,
        organizerWorkosUserId: organizer?.workosUserId ?? null,
        participantCount: meeting.participantCount ?? null,
        webrtcEnabled: meeting.webrtcEnabled ?? null,
      },
      users,
      participants: participantRows,
      meetingState: meetingState
        ? {
            active: meetingState.active,
            recordingEnabled: meetingState.recordingEnabled,
            topics: meetingState.topics,
          }
        : null,
    };
  },
});
