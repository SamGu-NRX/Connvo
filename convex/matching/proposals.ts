/**
 * Proposal reads for the asynchronous matcher.
 *
 * The proposal state machine itself (accept, decline, expiry, meeting
 * creation) is owned by the cv6-connect-network packet; this module exposes
 * the read the plan calls the `matchup` query so the run can be consumed
 * end to end before that packet lands.
 */

import { v } from "convex/values";
import { query } from "@convex/_generated/server";

/**
 * A user's live proposals: proposed or confirmed, soonest first, with the
 * other person's display name resolved for rendering.
 */
export const matchup = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = [
      ...(await ctx.db
        .query("matchProposals")
        .withIndex("by_user_a", (q) => q.eq("userAId", args.userId))
        .collect()),
      ...(await ctx.db
        .query("matchProposals")
        .withIndex("by_user_b", (q) => q.eq("userBId", args.userId))
        .collect()),
    ];
    const live = rows.filter(
      (row) => row.state === "proposed" || row.state === "confirmed",
    );
    live.sort((a, b) => a.scheduledAt - b.scheduledAt);
    const withNames = await Promise.all(
      live.map(async (row) => {
        const otherId = row.userAId === args.userId ? row.userBId : row.userAId;
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", otherId))
          .unique();
        return {
          ...row,
          otherName: profile?.displayName ?? "Connvo member",
          isUserA: row.userAId === args.userId,
        };
      }),
    );
    return withNames;
  },
});
