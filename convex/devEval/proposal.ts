// Eval-only seed for the local anonymous backend used by tools/call-eval
// (CONTRACT.md): one live matchProposals row for the seeded users A and B
// (WorkOS subjects local-test-a/b), plus minimal profiles so the proposal
// card and the upcoming-chat card can render. Env-gated like devEval/seed:
// refuses to run unless CONNVO_LOCAL_TEST_JWKS is set on the deployment.
// Internal mutation, so only the CLI (`npx convex run devEval/proposal`) or
// other server functions can call it.
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { firstQuestionCandidates, interestReason } from "../matching/reasons";

async function userIdBySubject(
  db: QueryCtx["db"],
  subject: string,
): Promise<Id<"users">> {
  const row = await db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
    .unique();
  if (!row) throw new Error(`devEval/proposal: user ${subject} not seeded`);
  return row._id;
}

export const seedProposal = internalMutation({
  args: {},
  returns: v.object({ proposalId: v.id("matchProposals") }),
  handler: async (ctx) => {
    if (!process.env.CONNVO_LOCAL_TEST_JWKS) {
      throw new Error(
        "devEval/proposal refuses to run: CONNVO_LOCAL_TEST_JWKS is not set",
      );
    }

    const now = Date.now();
    const a = await userIdBySubject(ctx.db, "local-test-a");
    const b = await userIdBySubject(ctx.db, "local-test-b");

    // Minimal profiles so myProposal and the upcoming-chat card have names.
    for (const [userId, displayName] of [
      [a, "Alice Anderson"],
      [b, "Bob Brown"],
    ] as const) {
      const existing = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          displayName,
          jobTitle: "Software engineer",
          company: "Eval Corp",
          timezone: "UTC",
        });
      } else {
        await ctx.db.insert("profiles", {
          userId,
          displayName,
          languages: ["en"],
          jobTitle: "Software engineer",
          company: "Eval Corp",
          timezone: "UTC",
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Drop any earlier seeded proposal so repeat runs stay idempotent.
    for (const old of await ctx.db
      .query("matchProposals")
      .withIndex("by_user_a", (q) => q.eq("userAId", a))
      .collect()) {
      await ctx.db.delete(old._id);
    }

    const [userAId, userBId] = [a, b].sort() as [Id<"users">, Id<"users">];
    const reasons = [
      interestReason("TypeScript"),
      "You're both meeting peers in your field",
    ];
    const question = firstQuestionCandidates({
      sharedTags: ["typescript"],
      goalPairKey: "peers|peers",
    })[0];

    const proposalId = await ctx.db.insert("matchProposals", {
      userAId,
      userBId,
      state: "proposed",
      aAccepted: false,
      bAccepted: false,
      scheduledAt: now + 30 * 60 * 60 * 1000,
      alternatives: [
        now + 54 * 60 * 60 * 1000,
        now + 78 * 60 * 60 * 1000,
      ],
      reasons,
      firstQuestion: question ?? "What are you working on this week?",
      score: 4.2,
      sharedInterestKeys: ["typescript"],
      runAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    });

    return { proposalId };
  },
});
