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

/**
 * Synthetic embedder: the production pipeline derives a profile embedding
 * FROM user-controlled profile content (the platform recomputes it whenever
 * profile content changes). This stand-in is deterministic per `profile.field`
 * and stands in for the production embedding model, which is not part of this
 * repository. Vectors are two-dimensional for legibility.
 */
export const FIELD_VECTORS: Record<string, [number, number]> = {
  Technology: [3, 1],
  Software: [1, 0.5],
  Design: [0, 1],
};

/**
 * Deterministically derive the embedding the platform would compute for the
 * given scoring data. Profiles without a usable `profile.field` embed to
 * null (the missing-vector path).
 */
export function deriveEmbedding(
  scoringData: UserScoringData,
): { vector: ArrayBuffer; model: string } | null {
  const field = scoringData.profile?.field;
  const components = field != null ? FIELD_VECTORS[field] : undefined;
  if (!components) return null;
  return { vector: embeddingBuffer([...components]), model: EMBEDDING_MODEL };
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
  {
    id: "mentee-twin-a",
    description:
      "Twin A of the tied-score pair: scoring-identical to mentee-twin-b; " +
      "only the experiment id and PRIVATE identity fields differ. Exists to " +
      "exercise tie handling: both twins must produce identical features, " +
      "identical composite scores, and identical explanations.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_twin_a"),
        displayName: "Canary Name Twin A",
        orgId: "canary-org-twin-a",
        orgRole: "member",
      },
      profile: {
        experience: "junior",
        languages: ["English"],
        field: "Technology",
      },
      interests: ["ai", "technology"],
      embedding: null,
    },
    constraints: {
      interests: ["ai"],
      roles: ["mentee"],
    },
    privateSentinels: sentinels(
      "Canary Name Twin A",
      "canary-org-twin-a",
      "member",
    ),
  },
  {
    id: "mentee-twin-b",
    description:
      "Twin B of the tied-score pair: scoring-identical to mentee-twin-a; " +
      "only the experiment id and PRIVATE identity fields differ.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_twin_b"),
        displayName: "Canary Name Twin B",
        orgId: "canary-org-twin-b",
        orgRole: "member",
      },
      profile: {
        experience: "junior",
        languages: ["English"],
        field: "Technology",
      },
      interests: ["ai", "technology"],
      embedding: null,
    },
    constraints: {
      interests: ["ai"],
      roles: ["mentee"],
    },
    privateSentinels: sentinels(
      "Canary Name Twin B",
      "canary-org-twin-b",
      "member",
    ),
  },
  {
    id: "leaky-mentee-control",
    description:
      "NEGATIVE CONTROL for the canary scan, never part of PAIRS: the " +
      "scanner is fed a fabricated explanation sentence that interpolates " +
      "this profile's PRIVATE displayName sentinel, and must flag it. The " +
      "real handler itself is not leaking; this fixture proves the scan " +
      "fails when a leak exists.",
    scoringData: {
      user: {
        _id: asUserId("u_canary_leaky"),
        displayName: "Canary Name Leaky",
        orgId: "canary-org-leaky",
        orgRole: "member",
      },
      profile: {
        experience: "junior",
        languages: ["English"],
        field: "Technology",
      },
      interests: ["ai", "technology"],
      embedding: null,
    },
    constraints: {
      interests: ["ai"],
      roles: ["mentee"],
    },
    privateSentinels: sentinels(
      "Canary Name Leaky",
      "canary-org-leaky",
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
    pairId: "twin-a-x-mentor",
    leftId: "mentee-twin-a",
    rightId: "mentor-senior-technology",
    purpose:
      "Tie case: scoring-identical to twin-b-x-mentor by construction; the " +
      "two pairs must tie on composite score with identical explanations.",
  },
  {
    pairId: "twin-b-x-mentor",
    leftId: "mentee-twin-b",
    rightId: "mentor-senior-technology",
    purpose:
      "Tie case: scoring-identical to twin-a-x-mentor by construction; the " +
      "two pairs must tie on composite score with identical explanations.",
  },
];

/**
 * NEGATIVE-CONTROL pairs for the canary scan. Never scored in the main run
 * or shown on the results page: the fabricated explanation corpus derived
 * from these pairs deliberately interpolates a private sentinel so the
 * privacy check can be seen FAILING (positive control for the scanner).
 */
export const CONTROL_PAIRS: ScoredPair[] = [
  {
    pairId: "canary-leak-control",
    leftId: "leaky-mentee-control",
    rightId: "mentor-senior-technology",
    purpose:
      "Negative control only: proves the canary scan detects a leak when " +
      "one is planted.",
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
  profiles: PROFILES.length, // 8 (5 study + 2 tie twins + 1 leak control)
  scoredPairs: PAIRS.length, // 6 (4 study + 2 tie pairs)
  missingUserCases: 1,
} as const;
