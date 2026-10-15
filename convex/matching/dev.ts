/**
 * Dev-only seed for the asynchronous matcher (docs/plan/MATCHING-PLAN.md).
 *
 * Inserts about 20 realistic profiles with goals, languages, interests and
 * recurring availability so a dev deployment has a population the run can
 * actually pair. REFUSES to run unless the CONVO_DEV_SEED environment
 * variable is "1" on the deployment (`npx convex env set CONVO_DEV_SEED 1`
 * on a dev deployment; never on production). Idempotent: a second run
 * without new data is a no-op.
 */

import { v } from "convex/values";
import { internalMutation } from "@convex/_generated/server";
import { createError } from "@convex/lib/errors";
import type { Intent } from "@convex/lib/availability";

/** One seed person: profile fields plus their weekly free time and interests. */
interface SeedPerson {
  name: string;
  title: string;
  company: string;
  field: string;
  languages: string[];
  intents: Intent[];
  timezone: string;
  chatsPerWeek: 1 | 2;
  interests: string[];
  /** Recurring weekly free time in their own timezone: [weekday, start, end]. */
  blocks: Array<[number, number, number]>;
}

const PEOPLE: SeedPerson[] = [
  {
    name: "Ana Duarte", title: "Senior Backend Engineer", company: "Lumen Labs",
    field: "software", languages: ["English", "Português"], intents: ["find_mentor", "peers"],
    timezone: "America/Sao_Paulo", chatsPerWeek: 2, interests: ["rust", "distributed_systems", "coffee", "running"],
    blocks: [[1, 9 * 60, 11 * 60], [3, 9 * 60, 11 * 60], [5, 14 * 60, 16 * 60]],
  },
  {
    name: "Ben Okafor", title: "Staff Engineer", company: "Northwind",
    field: "software", languages: ["English"], intents: ["mentor", "collaborate"],
    timezone: "Europe/London", chatsPerWeek: 2, interests: ["distributed_systems", "rust", "mentoring", "cycling"],
    blocks: [[1, 9 * 60, 10 * 60 + 30], [2, 15 * 60, 17 * 60], [4, 9 * 60, 10 * 60 + 30]],
  },
  {
    name: "Carla Mendes", title: "Product Designer", company: "Studio Prata",
    field: "design", languages: ["English", "Português"], intents: ["peers", "explore_field"],
    timezone: "Europe/Lisbon", chatsPerWeek: 1, interests: ["design_systems", "typography", "coffee", "illustration"],
    blocks: [[2, 10 * 60, 12 * 60], [4, 10 * 60, 12 * 60]],
  },
  {
    name: "Daniel Kim", title: "ML Engineer", company: "Parsley AI",
    field: "data", languages: ["English", "한국어"], intents: ["find_mentor", "explore_field"],
    timezone: "Asia/Seoul", chatsPerWeek: 1, interests: ["machine_learning", "pytorch", "running", "coffee"],
    blocks: [[1, 8 * 60, 9 * 60 + 30], [3, 18 * 60, 19 * 60 + 30], [5, 8 * 60, 9 * 60]],
  },
  {
    name: "Emma Fischer", title: "Engineering Manager", company: "Kantina",
    field: "software", languages: ["English", "Deutsch"], intents: ["mentor", "hiring"],
    timezone: "Europe/Berlin", chatsPerWeek: 2, interests: ["mentoring", "engineering_culture", "hiring", "baking"],
    blocks: [[1, 12 * 60, 13 * 60], [2, 12 * 60, 13 * 60], [4, 16 * 60, 17 * 60]],
  },
  {
    name: "Felipe Torres", title: "Frontend Engineer", company: "Playa Digital",
    field: "software", languages: ["English", "Español"], intents: ["peers", "collaborate"],
    timezone: "America/Mexico_City", chatsPerWeek: 1, interests: ["react", "design_systems", "typography", "skateboarding"],
    blocks: [[1, 17 * 60, 19 * 60], [3, 17 * 60, 19 * 60]],
  },
  {
    name: "Grace Liu", title: "Data Scientist", company: "Meridian Health",
    field: "data", languages: ["English"], intents: ["peers", "find_mentor"],
    timezone: "America/New_York", chatsPerWeek: 2, interests: ["machine_learning", "data_viz", "data", "yoga"],
    blocks: [[2, 8 * 60, 9 * 60 + 30], [4, 8 * 60, 9 * 60 + 30], [5, 15 * 60, 16 * 60 + 30]],
  },
  {
    name: "Henrik Dahl", title: "Platform Engineer", company: "Fjord Cloud",
    field: "software", languages: ["English"], intents: ["mentor", "collaborate"],
    timezone: "Europe/Copenhagen", chatsPerWeek: 1, interests: ["kubernetes", "distributed_systems", "rust", "sailing"],
    blocks: [[1, 14 * 60, 15 * 60 + 30], [3, 14 * 60, 15 * 60 + 30]],
  },
  {
    name: "Isla Murray", title: "Product Manager", company: "Bramble",
    field: "product", languages: ["English"], intents: ["explore_field", "peers"],
    timezone: "Europe/Dublin", chatsPerWeek: 2, interests: ["product_discovery", "design_systems", "hiking", "podcasts"],
    blocks: [[2, 12 * 60, 13 * 60], [4, 12 * 60, 13 * 60]],
  },
  {
    name: "Jonas Weber", title: "SRE", company: "Kantina",
    field: "software", languages: ["English", "Deutsch"], intents: ["peers", "job_seeking"],
    timezone: "Europe/Berlin", chatsPerWeek: 1, interests: ["kubernetes", "observability", "distributed_systems", "bouldering"],
    blocks: [[1, 8 * 60, 9 * 60], [3, 8 * 60, 9 * 60], [5, 13 * 60, 15 * 60]],
  },
  {
    name: "Keiko Tanaka", title: "UX Researcher", company: "Sakura Soft",
    field: "design", languages: ["English", "日本語"], intents: ["peers", "collaborate"],
    timezone: "Asia/Tokyo", chatsPerWeek: 1, interests: ["user_research", "design_systems", "tea", "pottery"],
    blocks: [[2, 9 * 60, 10 * 60 + 30], [4, 9 * 60, 10 * 60 + 30]],
  },
  {
    name: "Lucas Almeida", title: "Mobile Engineer", company: "Praia Apps",
    field: "software", languages: ["English", "Português"], intents: ["find_mentor", "job_seeking"],
    timezone: "America/Sao_Paulo", chatsPerWeek: 2, interests: ["swift", "kotlin", "design_systems", "surfing"],
    blocks: [[2, 10 * 60, 11 * 60 + 30], [4, 10 * 60, 11 * 60 + 30]],
  },
  {
    name: "Maya Patel", title: "Growth Engineer", company: "Chai & Code",
    field: "product", languages: ["English", "हिन्दी"], intents: ["collaborate", "hiring"],
    timezone: "Asia/Kolkata", chatsPerWeek: 1, interests: ["react", "growth", "product_discovery", "chai"],
    blocks: [[1, 11 * 60, 12 * 60 + 30], [3, 11 * 60, 12 * 60 + 30], [5, 11 * 60, 12 * 60]],
  },
  {
    name: "Noah Berg", title: "CTO", company: "Fjord Cloud",
    field: "software", languages: ["English"], intents: ["mentor", "hiring"],
    timezone: "America/Los_Angeles", chatsPerWeek: 1, interests: ["mentoring", "engineering_culture", "rust", "skiing"],
    blocks: [[2, 8 * 60, 9 * 60], [4, 8 * 60, 9 * 60]],
  },
  {
    name: "Olivia Ross", title: "Frontend Engineer", company: "Meridian Health",
    field: "software", languages: ["English"], intents: ["find_mentor", "peers"],
    timezone: "America/Chicago", chatsPerWeek: 2, interests: ["react", "data_viz", "accessibility", "climbing"],
    blocks: [[1, 12 * 60, 13 * 60], [3, 12 * 60, 13 * 60], [5, 9 * 60, 10 * 60 + 30]],
  },
  {
    name: "Pedro Santos", title: "Data Engineer", company: "Chai & Code",
    field: "data", languages: ["English", "Español"], intents: ["peers", "explore_field"],
    timezone: "Europe/Madrid", chatsPerWeek: 1, interests: ["data", "dbt", "observability", "padel"],
    blocks: [[2, 16 * 60, 17 * 60 + 30], [4, 16 * 60, 17 * 60 + 30]],
  },
  {
    name: "Quinn Harper", title: "Security Engineer", company: "Northwind",
    field: "software", languages: ["English"], intents: ["peers", "collaborate"],
    timezone: "America/New_York", chatsPerWeek: 1, interests: ["appsec", "distributed_systems", "rust", "chess"],
    blocks: [[1, 15 * 60, 16 * 60 + 30], [3, 15 * 60, 16 * 60 + 30]],
  },
  {
    name: "Rosa Delgado", title: "Design Lead", company: "Studio Prata",
    field: "design", languages: ["English", "Español"], intents: ["mentor", "explore_field"],
    timezone: "America/New_York", chatsPerWeek: 2, interests: ["mentoring", "design_systems", "illustration", "museums"],
    blocks: [[2, 10 * 60, 11 * 60 + 30], [4, 14 * 60, 15 * 60 + 30]],
  },
  {
    name: "Sam Whitaker", title: "Founder", company: "Indie",
    field: "product", languages: ["English"], intents: ["collaborate", "find_mentor", "hiring"],
    timezone: "America/Los_Angeles", chatsPerWeek: 2, interests: ["product_discovery", "growth", "engineering_culture", "running"],
    blocks: [[1, 9 * 60, 10 * 60], [2, 9 * 60, 10 * 60], [3, 9 * 60, 10 * 60], [4, 15 * 60, 16 * 60 + 30]],
  },
  {
    name: "Tara Nair", title: "Backend Engineer", company: "Meridian Health",
    field: "software", languages: ["English", "हिन्दी"], intents: ["find_mentor", "job_seeking"],
    timezone: "Asia/Kolkata", chatsPerWeek: 1, interests: ["rust", "distributed_systems", "observability", "cycling"],
    blocks: [[2, 19 * 60, 20 * 60 + 30], [4, 19 * 60, 20 * 60 + 30]],
  },
];

export const devSeed = internalMutation({
  args: {},
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx) => {
    if (process.env.CONVO_DEV_SEED !== "1") {
      throw createError.forbidden(
        "The dev seed refuses to run unless CONVO_DEV_SEED=1 is set on the deployment",
      );
    }

    // Idempotent: an existing seed user's marker email short-circuits.
    const marker = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "ana.duarte@dev.connvo.local"))
      .unique();
    if (marker) return { inserted: 0 };

    const now = Date.now();
    let inserted = 0;
    for (const [i, person] of PEOPLE.entries()) {
      const userId = await ctx.db.insert("users", {
        workosUserId: `dev-seed-${i}-${person.name.toLowerCase().replaceAll(" ", "-")}`,
        email: `${person.name.toLowerCase().replaceAll(" ", ".")}@dev.connvo.local`,
        displayName: person.name,
        isActive: true,
        onboardingComplete: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("profiles", {
        userId,
        displayName: person.name,
        languages: person.languages,
        field: person.field,
        jobTitle: person.title,
        company: person.company,
        intents: person.intents,
        timezone: person.timezone,
        chatsPerWeek: person.chatsPerWeek,
        createdAt: now,
        updatedAt: now,
      });
      for (const [weekday, startMinute, endMinute] of person.blocks) {
        await ctx.db.insert("availabilityBlocks", {
          userId,
          weekday,
          startMinute,
          endMinute,
        });
      }
      for (const interestKey of person.interests) {
        await ctx.db.insert("userInterests", {
          userId,
          interestKey,
          createdAt: now,
        });
      }
      inserted += 1;
    }
    return { inserted };
  },
});
