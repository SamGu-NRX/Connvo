import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Cache for Decisions API answers, keyed by the person and their candidate
 * set (docs/plan/MATCHING-PLAN.md: "answers are cached for 7 days"). Owned by
 * the matcher packet.
 */
export const decisionsCacheTable = {
  decisionsCache: defineTable({
    personId: v.id("users"),
    // Deterministic hash of the person's profile inputs and the sorted
    // candidate ids, so a changed shortlist or profile is a new key.
    candidatesKey: v.string(),
    // candidateId -> probability, from the answer's probabilities.
    probabilities: v.array(
      v.object({ candidateId: v.id("users"), probability: v.number() }),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_person_and_key", ["personId", "candidatesKey"])
    .index("by_expires", ["expiresAt"]),
};
