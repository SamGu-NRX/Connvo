/**
 * Controlled synthetic profiles for the match-explanations experiment.
 *
 * These fixtures NEVER touch production data. Every private field carries a
 * distinctive sentinel value ("Canary ...") so that any leak of a private
 * field into a proposed public explanation is detectable by string search.
 * Public profile fields (interests, roles, experience, languages, field)
 * are ordinary values chosen to exercise specific scoring branches.
 *
 * The fixtures are typed against the production `UserScoringData` shape and
 * are consumed ONLY through the real scoring entrypoint
 * (`calculateCompatibilityScore` via its `_handler`, with a stub
 * `ctx.runQuery`), so any malformed fixture surfaces as a handler error.
 */

import type { Id } from "@convex/_generated/dataModel";
import type { UserScoringData } from "@convex/types/entities/matching";

export interface SyntheticConstraints {
  interests: string[];
  roles: string[];
  orgConstraints?: string;
}

export interface SyntheticProfile {
  /** Experiment-local id (safe to publish). */
  id: string;
  /** What this fixture is designed to exercise. */
  description: string;
  scoringData: UserScoringData;
  constraints: SyntheticConstraints;
  /**
   * Private-field sentinel values planted in this profile. A public
   * explanation containing any of these strings means a leak.
   */
  privateSentinels: { field: string; value: string }[];
}

const EMBEDDING_MODEL = "synthetic-embedder-v1";

function asUserId(id: string): Id<"users"> {
  return id as Id<"users">;
}

/** Float32 byte buffer for a synthetic embedding vector. */
function embeddingBuffer(components: number[]): ArrayBuffer {
  return new Float32Array(components).buffer;
}

function sentinels(
  displayName: string,
  orgId: string,
  orgRole: string,
  company?: string,
): { field: string; value: string }[] {
  const list = [
    { field: "displayName", value: displayName },
    { field: "orgId", value: orgId },
    { field: "orgRole", value: orgRole },
  ];
  if (company !== undefined) list.push({ field: "company", value: company });
  return list;
}

export const PROFILES: SyntheticProfile[] = [
  {
    id: "mentee-junior-technology",
    description:
      "Junior technologist seeking a mentor: overlapping interests with the " +
      "senior technologist, ideal 2-level experience gap, complementary " +
      "roles, no profile embedding (missing-data path), same_org constraint.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_mentee"),
        displayName: "Canary Name Mentee",
        orgId: "canary-org-mentee",
        orgRole: "member",
      },
      profile: {
        experience: "junior",
        languages: ["English", "Spanish"],
        field: "Technology",
        company: "Canary Company Mentee",
      },
      interests: ["technology", "ai", "startups"],
      embedding: null,
    },
    constraints: {
      interests: ["ai", "startups"],
      roles: ["mentee"],
      orgConstraints: "same_org",
    },
    privateSentinels: sentinels(
      "Canary Name Mentee",
      "canary-org-mentee",
      "member",
      "Canary Company Mentee",
    ),
  },
  {
    id: "mentor-senior-technology",
    description:
      "Senior technologist offering mentorship: near-identical embedding to " +
      "the peer fixture, complementary with both mentee fixtures, same_org " +
      "constraint (short-circuit branch against differing orgs).",
    scoringData: {
      user: {
        _id: asUserId("u_canary_mentor"),
        displayName: "Canary Name Mentor",
        orgId: "canary-org-mentor",
        orgRole: "member",
      },
      profile: {
        experience: "senior",
        languages: ["English", "French"],
        field: "Technology",
      },
      interests: ["ai", "technology", "robotics"],
      embedding: {
        vector: embeddingBuffer([3, 1]),
        model: EMBEDDING_MODEL,
      },
    },
    constraints: {
      interests: ["ai", "startups"],
      roles: ["mentor"],
      orgConstraints: "same_org",
    },
    privateSentinels: sentinels(
      "Canary Name Mentor",
      "canary-org-mentor",
      "member",
    ),
  },
  {
    id: "peer-mid-software",
    description:
      "Mid-level software peer: shares the mentor's embedding model and a " +
      "near-collinear vector (cosine ~0.99), related-field industry match, " +
      "complementary mentee role, same_org constraint with a different org.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_peer"),
        displayName: "Canary Name Peer",
        orgId: "canary-org-peer",
        orgRole: "member",
      },
      profile: {
        experience: "mid",
        languages: ["English"],
        field: "Software",
      },
      interests: ["business", "marketing"],
      embedding: {
        vector: embeddingBuffer([1, 0.5]),
        model: EMBEDDING_MODEL,
      },
    },
    constraints: {
      interests: ["growth", "fundraising"],
      roles: ["mentee"],
      orgConstraints: "same_org",
    },
    privateSentinels: sentinels(
      "Canary Name Peer",
      "canary-org-peer",
      "member",
    ),
  },
  {
    id: "lead-design-cross-org",
    description:
      "Design lead in a different organization: 3-level experience gap, " +
      "same-role (not complementary) mentee role, a conflicting org " +
      "constraint (same_org vs different_org) resolved by org equality to " +
      "orgConstraintMatch 0.0, no embedding.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_design"),
        displayName: "Canary Name Design",
        orgId: "canary-org-design",
        orgRole: "member",
      },
      profile: {
        experience: "lead",
        languages: ["English", "German"],
        field: "Design",
      },
      interests: ["technology", "hiking"],
      embedding: null,
    },
    constraints: {
      interests: ["technology"],
      roles: ["mentee"],
      orgConstraints: "different_org",
    },
    privateSentinels: sentinels(
      "Canary Name Design",
      "canary-org-design",
      "member",
    ),
  },
  {
    id: "executive-sparse-no-profile",
    description:
      "Executive with no profile document at all (profile: null): forces the " +
      "missing-data neutral branches (experience 0.5, industry 0.5, language " +
      "0.5) and a one-sided same_org constraint against a differing org.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_exec"),
        displayName: "Canary Name Exec",
        orgId: "canary-org-exec",
        orgRole: "member",
      },
      profile: null,
      interests: [],
      embedding: null,
    },
    constraints: {
      interests: [],
      roles: ["investor"],
    },
    privateSentinels: sentinels(
      "Canary Name Exec",
      "canary-org-exec",
      "member",
    ),
  },

  // -------------------------------------------------------------------------
  // Deliberate tied-match constructions. Each is a renamed counterpart of an
  // existing pair with every scoring-relevant value held exactly equal, while
  // everything the score ignores (display names, org identities, language
  // identities, field spelling, interest order) differs. The hand solutions
  // (83/96 and 11/32) are pinned in ties.test.ts.
  // -------------------------------------------------------------------------
  {
    id: "tie-a-mentee",
    description:
      "Deliberate tie construction A (mentee side): renamed counterpart of " +
      "the junior technologist with identical scoring-relevant values — same " +
      "interests, junior experience, technology field (lowercase spelling, " +
      "matched case-insensitively), one shared + one differing language, " +
      "mentee role, identical same_org constraint strings, no embedding. The " +
      "score ignores the renamed display name, org identity, language " +
      "identities, and field casing.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_tie_a"),
        displayName: "Canary Name Tie A",
        orgId: "canary-org-tie-a",
        orgRole: "member",
      },
      profile: {
        experience: "junior",
        languages: ["English", "German"],
        field: "technology",
      },
      interests: ["technology", "ai", "startups"],
      embedding: null,
    },
    constraints: {
      interests: ["ai", "startups"],
      roles: ["mentee"],
      orgConstraints: "same_org",
    },
    privateSentinels: sentinels(
      "Canary Name Tie A",
      "canary-org-tie-a",
      "member",
    ),
  },
  {
    id: "tie-b-mentor",
    description:
      "Deliberate tie construction B (mentor side): renamed counterpart of " +
      "the senior technologist; uppercase field spelling still matches " +
      "case-insensitively, language identities differ with the same 1-of-2 " +
      "overlap ratio, no embedding.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_tie_b"),
        displayName: "Canary Name Tie B",
        orgId: "canary-org-tie-b",
        orgRole: "member",
      },
      profile: {
        experience: "senior",
        languages: ["English", "Italian"],
        field: "TECHNOLOGY",
      },
      interests: ["ai", "technology", "robotics"],
      embedding: null,
    },
    constraints: {
      interests: ["ai", "startups"],
      roles: ["mentor"],
      orgConstraints: "same_org",
    },
    privateSentinels: sentinels(
      "Canary Name Tie B",
      "canary-org-tie-b",
      "member",
    ),
  },
  {
    id: "tie-c-mentee",
    description:
      "Deliberate tie construction C (mentee side): renamed counterpart of " +
      "the junior technologist paired against a profile-less partner — " +
      "interests present but unmatched, junior experience, two languages " +
      "against an empty set, same_org constraint against a differing org, no " +
      "embedding.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_tie_c"),
        displayName: "Canary Name Tie C",
        orgId: "canary-org-tie-c",
        orgRole: "member",
      },
      profile: {
        experience: "junior",
        languages: ["English", "German"],
        field: "Technology",
      },
      interests: ["technology", "ai", "startups"],
      embedding: null,
    },
    constraints: {
      interests: ["ai", "startups"],
      roles: ["mentee"],
      orgConstraints: "same_org",
    },
    privateSentinels: sentinels(
      "Canary Name Tie C",
      "canary-org-tie-c",
      "member",
    ),
  },
  {
    id: "tie-d-sparse",
    description:
      "Deliberate tie construction D (sparse side): renamed counterpart of " +
      "the profile-less executive — null profile, no interests, no embedding, " +
      "investor role, no org constraint; forces the 0.5 neutral branches and " +
      "a one-sided same_org mismatch.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_tie_d"),
        displayName: "Canary Name Tie D",
        orgId: "canary-org-tie-d",
        orgRole: "member",
      },
      profile: null,
      interests: [],
      embedding: null,
    },
    constraints: {
      interests: [],
      roles: ["investor"],
    },
    privateSentinels: sentinels(
      "Canary Name Tie D",
      "canary-org-tie-d",
      "member",
    ),
  },
];

export interface ScoredPair {
  pairId: string;
  leftId: string;
  rightId: string;
  purpose: string;
}

/** Pairs scored through the real entrypoint, in a fixed order. */
export const PAIRS: ScoredPair[] = [
  {
    pairId: "mentee-x-mentor",
    leftId: "mentee-junior-technology",
    rightId: "mentor-senior-technology",
    purpose:
      "Strong interest alignment, ideal experience gap, complementary roles; " +
      "no embeddings so vectorSimilarity stays undefined (missing data).",
  },
  {
    pairId: "mentor-x-peer",
    leftId: "mentor-senior-technology",
    rightId: "peer-mid-software",
    purpose:
      "High semantic similarity (near-collinear vectors), ideal experience " +
      "gap, complementary roles, related-field industry match, zero interest " +
      "overlap.",
  },
  {
    pairId: "mentee-x-design",
    leftId: "mentee-junior-technology",
    rightId: "lead-design-cross-org",
    purpose:
      "Low interest overlap, 3-level gap, same-role only, same_org constraint " +
      "falsified by differing orgs: exercises the explanation fallback.",
  },
  {
    pairId: "mentee-x-sparse",
    leftId: "mentee-junior-technology",
    rightId: "executive-sparse-no-profile",
    purpose:
      "Missing profile data (neutral 0.5 branches) plus a one-sided same_org " +
      "constraint against a differing org; exercises the explanation fallback.",
  },
  {
    pairId: "tie-a-x-b",
    leftId: "tie-a-mentee",
    rightId: "tie-b-mentor",
    purpose:
      "Deliberate score tie with mentee-x-mentor: every scoring-relevant " +
      "value is held identical while identity content (display names, org " +
      "ids, language identities, field spelling) differs and is ignored by " +
      "the score. Hand solution 83/96; pinned in ties.test.ts.",
  },
  {
    pairId: "tie-c-x-d",
    leftId: "tie-c-mentee",
    rightId: "tie-d-sparse",
    purpose:
      "Deliberate score tie with mentee-x-sparse: zeroed and neutral-branch " +
      "components reproduce exactly for renamed profiles. Hand solution " +
      "11/32 = 0.34375; pinned in ties.test.ts.",
  },
];

/** A user id deliberately absent from the fixture store. */
export const MISSING_USER_ID = "u_canary_missing";

export function profileById(id: string): SyntheticProfile {
  const found = PROFILES.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown synthetic profile: ${id}`);
  return found;
}

/** Exact fixture counts asserted by the tests and recorded in results. */
export const EXACT_COUNTS = {
  profiles: PROFILES.length, // 9
  scoredPairs: PAIRS.length, // 6
  missingUserCases: 1,
} as const;
