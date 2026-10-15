import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Asynchronous matching proposals (docs/plan/MATCHING-PLAN.md, step 2).
 *
 * One row per proposed pair. The state machine lives in
 * convex/matching/proposals.ts: proposed -> confirmed | declined | expired.
 * User A is always the lexicographically smaller user id so a pair maps to at
 * most one row.
 */
export const matchProposalsTable = {
  matchProposals: defineTable({
    userAId: v.id("users"),
    userBId: v.id("users"),
    state: v.union(
      v.literal("proposed"),
      v.literal("confirmed"),
      v.literal("declined"),
      v.literal("expired"),
    ),
    // Per-side acceptance. A time change resets the other person's flag.
    aAccepted: v.boolean(),
    bAccepted: v.boolean(),
    // The chosen shared slot and up to three alternatives (UTC epoch ms).
    scheduledAt: v.number(),
    alternatives: v.array(v.number()),
    // Specific reasons and the suggested first question from the written banks.
    reasons: v.array(v.string()),
    firstQuestion: v.string(),
    // Final score after the deterministic score and the Decisions rerank, plus
    // the shared interest keys and goal pair for the later learning step.
    score: v.number(),
    sharedInterestKeys: v.array(v.string()),
    goalPair: v.optional(v.string()),
    // Wall time of the run that produced this proposal (UTC epoch ms), used for
    // the per-run waiting bonus.
    runAt: v.number(),
    // 48 hours from proposal, or 2 hours before the proposed time.
    expiresAt: v.number(),
    declinedById: v.optional(v.id("users")),
    declineReason: v.optional(
      v.union(
        v.literal("not_relevant"),
        v.literal("bad_timing"),
        v.literal("already_met"),
        v.literal("other"),
      ),
    ),
    meetingId: v.optional(v.id("meetings")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_a", ["userAId"])
    .index("by_user_b", ["userBId"])
    .index("by_state", ["state"])
    .index("by_expires", ["expiresAt"])
    .index("by_meeting", ["meetingId"]),
};
