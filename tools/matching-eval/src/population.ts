/**
 * Seeded synthetic population — 300 users.
 *
 * Latents (taste vector, sociability) generate everything observable:
 * interests, role, experience, timezone, language, org, bio phrasing.
 * The matcher sees only EvalProfile fields (plus permissions); latents
 * stay hidden (README §threat-model).
 */

import { Rng } from "./rng";
import {
  ALL_FIELDS,
  type EvalProfile,
  type Latent,
  type Population,
  type RoleFamily,
} from "./types";

export const POP_SIZE = 300;

const INTERESTS = [
  "AI/ML", "web dev", "design", "fintech", "climate",
  "games", "music", "writing", "fitness", "investing",
  "robotics", "biology", "space", "education", "crypto", "psychology",
];

const INDUSTRIES = [
  "software", "fintech", "healthcare", "education", "climate",
  "gaming", "media", "hardware", "consulting", "other",
];

const ROLE_FAMILIES: RoleFamily[] = ["build", "product", "gtm", "operate"];

const TITLES: Record<RoleFamily, string[]> = {
  build: ["frontend engineer", "backend engineer", "full-stack engineer", "ML engineer", "mobile engineer"],
  product: ["product manager", "technical PM", "product designer", "UX researcher"],
  gtm: ["growth marketer", "sales lead", "content strategist", "BD manager"],
  operate: ["ops manager", "finance lead", "people ops", "founder"],
};

const LANGUAGES = ["English", "Spanish", "Mandarin", "Hindi", "French", "German", "Portuguese", "Arabic", "Japanese", "Korean"];

/** Bio fragments whose selection is driven by the taste vector — one
 * per interest, so the bio carries the same signal as the interests
 * channel with distinct phrasing. */
const BIO_HEADS: Array<{ interest: string; text: string }> = [
  { interest: "AI/ML", text: "Building with LLMs and trying to ship useful things" },
  { interest: "web dev", text: "Shipping web apps and arguing about CSS in my spare time" },
  { interest: "design", text: "Care a lot about interfaces that feel calm" },
  { interest: "fintech", text: "Ex-banking, now building payments tooling" },
  { interest: "climate", text: "Spending my weekends on carbon accounting side projects" },
  { interest: "games", text: "Modding an old RPG in my spare time" },
  { interest: "music", text: "Half-decent guitar, terrible singing" },
  { interest: "writing", text: "Keeping a public engineering journal" },
  { interest: "fitness", text: "Training for a half marathon between deploys" },
  { interest: "investing", text: "Way too many open browser tabs about index funds" },
  { interest: "robotics", text: "Tinkering with a ROS2 setup in the garage" },
  { interest: "biology", text: "Reading papers about RNA folding for fun" },
  { interest: "space", text: "Amateur telescope, professional star-gazing ambitions" },
  { interest: "education", text: "Teaching a weekend coding class for beginners" },
  { interest: "crypto", text: "Running a node and avoiding the hype cycles" },
  { interest: "psychology", text: "Reading Kahneman again, fourth time" },
];

const BIO_TAILS = [
  "Happy to trade notes.",
  "Looking for people who ship.",
  "Mostly here to learn.",
  "Prefer small honest catch-ups.",
];

/** Sample a 16-dim unit-ish taste vector. */
function tasteVector(rng: Rng): number[] {
  const v: number[] = [];
  for (let i = 0; i < 16; i++) v.push(rng.normal());
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / (norm || 1));
}

export function makePopulation(seed: number, size = POP_SIZE): Population {
  const rng = new Rng(seed);
  const profiles: EvalProfile[] = [];
  const latents: Latent[] = [];
  const orgIds = Array.from({ length: 12 }, (_, i) => `org-${i}`);

  for (let i = 0; i < size; i++) {
    const taste = tasteVector(rng);
    const sociability = Math.min(1, Math.max(0, 0.5 + 0.22 * rng.normal()));

    // Interests: top-k taste affinity plus one wildcard — the channel
    // the ground truth rewards for trueInterestAlign. Interest k maps
    // to taste dim k (both are 16-long), so affinity is a direct read.
    const scored = INTERESTS.map((name, k) => ({
      name,
      a: taste[k % taste.length] + 0.3 * rng.normal(),
    })).sort((x, y) => y.a - x.a);
    const interests = scored.slice(0, 4 + rng.int(3)).map((s) => s.name);
    interests.push(rng.pick(INTERESTS));

    const roleFamily = rng.pick(ROLE_FAMILIES);
    const roleTitle = rng.pick(TITLES[roleFamily]);

    const expYears = Math.max(0, Math.min(25, rng.normal() * 5 + 6));
    const experienceBand =
      expYears <= 2 ? "0-2" : expYears <= 6 ? "3-6" : expYears <= 12 ? "7-12" : "13+";

    // Timezones clustered in US/EU with an Asia tail.
    const tzRoll = rng.next();
    const timezoneOffset =
      tzRoll < 0.55 ? rng.pick([-8, -6, -5, 0]) : tzRoll < 0.8 ? rng.pick([0, 1, 2]) : rng.pick([5.5, 8, 9]);

    const languages = ["English", ...rng.sample(LANGUAGES.slice(1), rng.int(3))];

    // Bio: taste-aligned head + filler tail. Contains NO permittable data.
    const aligned = BIO_HEADS.filter((h) => interests.includes(h.interest));
    const head = (aligned.length > 0 ? rng.pick(aligned) : rng.pick(BIO_HEADS)).text;
    const bio = `${head}. ${rng.pick(BIO_TAILS)}`;

    const orgId = rng.pick(orgIds);
    const orgPreference = rng.next() < 0.3 ? "same" : rng.next() < 0.55 ? "different" : "none";

    // Permissions: 25% withhold experience, 40% industry, 20% timezone,
    // 35% organization (independent draws) — see README §permissions.
    const permittedFields = ALL_FIELDS.filter((f) => {
      const p = f === "experience" ? 0.75 : f === "industry" ? 0.6 : f === "timezone" ? 0.8 : 0.65;
      return rng.bool(p);
    });

    const profile: EvalProfile = {
      id: `u${String(i).padStart(3, "0")}`,
      displayName: `User ${i}`,
      roleFamily,
      roleTitle,
      interests,
      bio,
      experienceBand,
      languages,
      orgPreference,
      permittedFields,
    };
    if (permittedFields.includes("experience")) profile.experienceYears = Math.round(expYears * 10) / 10;
    if (permittedFields.includes("industry")) profile.industry = rng.pick(INDUSTRIES);
    if (permittedFields.includes("timezone")) profile.timezoneOffset = timezoneOffset;
    if (permittedFields.includes("organization")) profile.orgId = orgId;

    profiles.push(profile);
    latents.push({ taste, sociability });
  }

  return { profiles, latents, interests: INTERESTS, industries: INDUSTRIES, orgIds };
}
