/**
 * Synthetic population generator (pure planning; no db access).
 *
 * DECLARED OBJECTIVES, NOT SOCIAL GROUND TRUTH: the generator builds cohorts
 * of users whose *declared* attributes (interests, roles, fields, languages,
 * embeddings) are structured so the engine's scoring features respond
 * predictably. Nothing about these profiles represents real human match
 * quality; they exist to give the allocator measurable structure to allocate
 * against.
 *
 * Determinism: a single 32-bit seed fixes the entire plan, so replays
 * regenerate identical populations (given the same generator source, which is
 * hash-pinned in run artifacts).
 */

import type { Id } from "@convex/_generated/dataModel";
import { mulberry32, stringHash32, intBetween, pick } from "./rng.js";
import type { PlannedEntry, PopulationPlan, PopulationParams, SyntheticIdentity } from "./types.js";

/** Cohorts pair interest sets with related fields so cross-cohort overlap is low. */
const COHORT_DEFS = [
  { interests: ["technology", "ai", "startups"], field: "technology", language: "English" },
  { interests: ["design", "ux", "product"], field: "design", language: "English" },
  { interests: ["business", "finance", "strategy"], field: "business", language: "English" },
  { interests: ["science", "research", "climate"], field: "science", language: "English" },
  { interests: ["healthcare", "biotech", "wellness"], field: "healthcare", language: "English" },
  { interests: ["education", "mentoring", "nonprofit"], field: "education", language: "English" },
];

const ROLE_PAIRS: Array<[string, string]> = [
  ["mentor", "mentee"],
  ["founder", "investor"],
  ["technical", "business"],
];

const EXPERIENCE_LEVELS = ["entry", "junior", "mid", "senior", "lead", "executive"];

export const DEFAULT_PARAMS: PopulationParams = {
  count: 8,
  arrivalProfile: "staggered",
  availabilityMix: { always_on: 0.4, daytime: 0.4, short: 0.2 },
  staleFraction: 0.1,
  rejoinFraction: 0.1,
  horizonMs: 2 * 60 * 60 * 1000, // arrivals spread over 2h
  embedding: { model: "synthetic-hashed-v1", dimensions: 64 },
  cohortCount: 3,
};

/** Hashed-bag embedding: interests map to shared dimensions, so users sharing
 * interests get aligned vectors and above-baseline cosine similarity. A small
 * seeded jitter keeps vectors user-specific without destroying the signal. */
function hashedBagVector(interests: string[], dims: number, jitterSeed: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const interest of interests) {
    const h = stringHash32(interest) % dims;
    v[h] += 1;
    v[(h * 7 + 13) % dims] += 0.5;
  }
  const jitterRng = mulberry32(jitterSeed);
  for (let i = 0; i < dims; i++) v[i] += jitterRng() * 0.15;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => Math.round((x / norm) * 1000) / 1000);
}

function synthIdentity(index: number): SyntheticIdentity {
  const subject = `synthetic-user-${index}`;
  return {
    subject,
    tokenIdentifier: `study|${subject}`,
    email: `${subject}@synthetic.invalid`,
    name: `Synthetic User ${index}`,
    issuer: "https://synthetic.invalid",
  };
}

/**
 * Plans a population. Pure: same seed and params produce the same plan.
 * availableFrom is always >= enqueueAt + 1s (queue validation) and windows
 * are always valid; staleness emerges from the logical clock passing
 * availableTo while the entry is still waiting.
 */
export function planPopulation(
  scenarioName: string,
  seed: number,
  params: PopulationParams,
  startClockMs: number,
): PopulationPlan {
  const rng = mulberry32(seed);
  const entries: PlannedEntry[] = [];
  // Ids are assigned by convex-test's DatabaseFake deterministically on
  // insertion; the plan references them by index and the materializer fills
  // real ids. Rejoins re-use the same planned user (per-user identity).
  for (let i = 0; i < params.count; i++) {
    const cohort = i % params.cohortCount;
    const def = COHORT_DEFS[cohort % COHORT_DEFS.length];

    // Interests: 3-5 mostly from the cohort set (creates overlap structure).
    const nInterests = intBetween(rng, 3, 5);
    const interestSet = new Set<string>();
    for (let k = 0; k < nInterests; k++) {
      interestSet.add(
        rng() < 0.75
          ? pick(rng, def.interests)
          : pick(rng, COHORT_DEFS[(cohort + 1) % COHORT_DEFS.length].interests),
      );
    }
    const interests = [...interestSet];

    // Roles: draw one complementary pair role (0.7) or a neutral role (0.3).
    const pair = pick(rng, ROLE_PAIRS);
    const roleSide = rng() < 0.5 ? pair[0] : pair[1];
    const roles = rng() < 0.7 ? [roleSide] : [pick(rng, ["advisor", "operator", "generalist"])];

    // Availability classes.
    const roll = rng();
    const mix = params.availabilityMix;
    const availabilityClass: PlannedEntry["availabilityClass"] =
      roll < mix.always_on ? "always_on" : roll < mix.always_on + mix.daytime ? "daytime" : "short";

    // Arrivals.
    const enqueueAt =
      params.arrivalProfile === "burst"
        ? startClockMs + (i % 3) * 1000
        : startClockMs + Math.floor((i * params.horizonMs) / Math.max(params.count, 1));

    // Windows (relative to enqueueAt).
    let windowMs: number;
    let startOffsetMs = 1000;
    if (availabilityClass === "always_on") windowMs = 24 * 60 * 60 * 1000;
    else if (availabilityClass === "daytime")
      windowMs = 6 * 60 * 60 * 1000 + intBetween(rng, 0, 3) * 60 * 60 * 1000;
    else windowMs = 15 * 60 * 1000 + intBetween(rng, 0, 3) * 5 * 60 * 1000;
    if (availabilityClass === "daytime") startOffsetMs += intBetween(rng, 0, 2) * 60 * 60 * 1000;

    // Stale entries: short windows that will already be over by the first
    // cycle when the clock has advanced past them (scenario advances time).
    if (rng() < params.staleFraction) {
      windowMs = Math.min(windowMs, 30 * 1000);
    }

    // Experience: offset within the level ladder (drives experienceGap).
    const expIdx = intBetween(rng, 0, EXPERIENCE_LEVELS.length - 1);
    // Company: some users share a company (industryMatch same-company bonus).
    const company = rng() < 0.3 ? `company-${cohort}` : undefined;
    // Org constraints: mostly none; some different_org (exercises org feature).
    const orgConstraints = rng() < 0.15 ? "different_org" : undefined;

    entries.push({
      index: i,
      userId: `PENDING-${i}` as unknown as Id<"users">,
      identity: synthIdentity(i),
      enqueueAt,
      availableFrom: enqueueAt + startOffsetMs,
      availableTo: enqueueAt + startOffsetMs + windowMs,
      constraints: {
        interests: interests.slice(0, Math.max(1, Math.min(2, interests.length))),
        roles,
        ...(orgConstraints ? { orgConstraints } : {}),
      },
      interests,
      profile: {
        displayName: `Synthetic User ${i}`,
        experience: EXPERIENCE_LEVELS[expIdx],
        field: def.field,
        ...(company ? { company } : {}),
        languages: [def.language],
      },
      orgId: "org-synthetic",
      embedding: hashedBagVector(interests, params.embedding.dimensions, seed + 7919 * (i + 1)),
      availabilityClass,
      cohort,
      rejoinAtCycle: undefined,
    });
  }

  // Rejoins: some users plan a second entry after their first expires or
  // matches (cycle 4 if their first entry is a short/stale window).
  const rejoinRng = mulberry32(seed ^ 0x5eed);
  for (const entry of entries) {
    if (rejoinRng() < params.rejoinFraction && entry.availabilityClass !== "always_on") {
      entry.rejoinAtCycle = 4;
    }
  }

  return { scenarioName, seed, params, startClockMs, entries };
}
