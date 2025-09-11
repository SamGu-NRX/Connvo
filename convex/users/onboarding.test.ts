import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";

describe("Onboarding Mutation", () => {
  let t = convexTest(schema);

  beforeEach(() => {
    t = convexTest(schema);
  });

  test("happy path saves profile, interests, onboarding state", async () => {
    // Seed interests directly
    await t.run(async (ctx) => {
      const now = Date.now();
      const defaults = [
        { key: "software-engineering", label: "Software Engineering", category: "industry" },
        { key: "data-science", label: "Data Science", category: "industry" },
        { key: "product-management", label: "Product Management", category: "industry" },
        { key: "ai-ml", label: "AI / ML", category: "academic" },
        { key: "startups", label: "Startups", category: "personal" },
        { key: "design", label: "Design", category: "skill" },
      ];
      for (const d of defaults) {
        await ctx.db.insert("interests", { ...d, usageCount: 0, createdAt: now });
      }
    });

    // Upsert user
    const userId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "workos_1",
      email: "test@example.com",
      displayName: "Test User",
    });

    const res = await t.mutation(api.users.mutations.saveOnboarding, {
      age: 25,
      gender: "prefer-not-to-say",
      field: "Software",
      jobTitle: "Engineer",
      company: "Acme",
      linkedinUrl: "https://linkedin.com/in/test",
      bio: "Hello, I build things.",
      interests: [
        { id: "software-engineering", name: "Software Engineering", category: "industry" },
        { id: "startups", name: "Startups", category: "personal" },
      ],
      idempotencyKey: "fixed-key-1",
    });

    expect(res.userId).toBeDefined();
    expect(res.profileId).toBeDefined();
    expect(res.interestsCount).toBe(2);
    expect(res.onboardingCompleted).toBe(true);

    const user = (await t.run(async (ctx) =>
      ctx.db.get(res.userId as Id<"users">),
    )) as Doc<"users"> | null;
    expect(user?.onboardingComplete).toBe(true);
    expect(typeof user?.onboardingCompletedAt).toBe("number");

    const profile = (await t.run(async (ctx) =>
      ctx.db.get(res.profileId as Id<"profiles">),
    )) as Doc<"profiles"> | null;
    expect(profile?.bio).toContain("build");
    expect(profile?.jobTitle).toBe("Engineer");

    const userInterests = await t.run(async (ctx) =>
      ctx.db
        .query("userInterests")
        .withIndex("by_user", (q) => q.eq("userId", res.userId))
        .collect(),
    );
    expect(userInterests.length).toBe(2);
  });

  test("rejects invalid interest when not custom/personal", async () => {
    await t.run(async (ctx) => {
      const now = Date.now();
      const defaults = [
        { key: "software-engineering", label: "Software Engineering", category: "industry" },
        { key: "data-science", label: "Data Science", category: "industry" },
        { key: "product-management", label: "Product Management", category: "industry" },
        { key: "ai-ml", label: "AI / ML", category: "academic" },
        { key: "startups", label: "Startups", category: "personal" },
        { key: "design", label: "Design", category: "skill" },
      ];
      for (const d of defaults) await ctx.db.insert("interests", { ...d, usageCount: 0, createdAt: now });
    });
    const userId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "workos_2",
      email: "t2@example.com",
      displayName: "User Two",
    });

    try {
      await t.mutation(api.users.mutations.saveOnboarding, {
        age: 30,
        gender: "male",
        field: "Data",
        jobTitle: "Scientist",
        company: "Beta",
        bio: "I love data.",
        interests: [
          { id: "nonexistent", name: "Bad", category: "industry" },
        ],
      });
      expect.fail("Expected validation error");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain("Invalid interest key");
    }
  });

  test("idempotent by idempotencyKey", async () => {
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("interests", { key: "design", label: "Design", category: "skill", usageCount: 0, createdAt: now });
    });
    const userId = await t.mutation(api.users.mutations.upsertUser, {
      workosUserId: "workos_3",
      email: "t3@example.com",
      displayName: "User Three",
    });

    const payload = {
      age: 28,
      gender: "female" as const,
      field: "PM",
      jobTitle: "PM",
      company: "Gamma",
      bio: "Ship it.",
      interests: [
        { id: "design", name: "Design", category: "skill" as const },
      ],
      idempotencyKey: "same-key",
    };

    const first = await t.mutation(api.users.mutations.saveOnboarding, payload);
    const second = await t.mutation(api.users.mutations.saveOnboarding, payload);

    expect(first.userId).toBe(second.userId);
    expect(first.profileId).toBe(second.profileId);
    expect(second.interestsCount).toBe(1);
  });
});
