import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../../convex-tests/test/setup.js";
import { api } from "@convex/_generated/api";
import { Doc, Id } from "@convex/_generated/dataModel";
import {
  createTestEnvironment,
  createCompleteTestUser,
  createTestInterest,
  setupTestMocks,
  cleanupTestMocks,
  resetAllMocks,
} from "../../convex-tests/test/helpers.js";

describe("Onboarding Mutation", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
    setupTestMocks();
    resetAllMocks();
  });

  afterEach(() => {
    cleanupTestMocks();
  });

  test("happy path saves profile, interests, onboarding state", async () => {
    // Create test interests using helper
    await createTestInterest(
      t,
      "software-engineering",
      "Software Engineering",
      "industry",
    );
    await createTestInterest(t, "data-science", "Data Science", "industry");
    await createTestInterest(
      t,
      "product-management",
      "Product Management",
      "industry",
    );
    await createTestInterest(t, "ai-ml", "AI / ML", "academic");
    await createTestInterest(t, "startups", "Startups", "personal");
    await createTestInterest(t, "design", "Design", "skill");

    // Create test user using helper
    const { userId, workosUserId } = await createCompleteTestUser(t, {
      email: "test@example.com",
      displayName: "Test User",
    });

    const authedT = t.withIdentity({
      subject: workosUserId,
      email: "test@example.com",
      name: "Test User",
    });

    const res = await authedT.mutation(api.users.mutations.saveOnboarding, {
      age: 25,
      gender: "prefer-not-to-say",
      field: "Software",
      jobTitle: "Engineer",
      company: "Acme",
      linkedinUrl: "https://linkedin.com/in/test",
      bio: "Hello, I build things.",
      interests: [
        {
          id: "software-engineering",
          name: "Software Engineering",
          category: "industry",
        },
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
        {
          key: "software-engineering",
          label: "Software Engineering",
          category: "industry",
        },
        { key: "data-science", label: "Data Science", category: "industry" },
        {
          key: "product-management",
          label: "Product Management",
          category: "industry",
        },
        { key: "ai-ml", label: "AI / ML", category: "academic" },
        { key: "startups", label: "Startups", category: "personal" },
        { key: "design", label: "Design", category: "skill" },
      ];
      for (const d of defaults)
        await ctx.db.insert("interests", {
          ...d,
          usageCount: 0,
          createdAt: now,
        });
    });
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        workosUserId: "workos_2",
        email: "t2@example.com",
        displayName: "User Two",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const authedT = t.withIdentity({
      subject: "workos_2",
      email: "t2@example.com",
      name: "User Two",
    });

    try {
      await authedT.mutation(api.users.mutations.saveOnboarding, {
        age: 30,
        gender: "male",
        field: "Data",
        jobTitle: "Scientist",
        company: "Beta",
        bio: "I love data.",
        interests: [{ id: "nonexistent", name: "Bad", category: "industry" }],
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
      await ctx.db.insert("interests", {
        key: "design",
        label: "Design",
        category: "skill",
        usageCount: 0,
        createdAt: now,
      });
    });
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        workosUserId: "workos_3",
        email: "t3@example.com",
        displayName: "User Three",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const authedT = t.withIdentity({
      subject: "workos_3",
      email: "t3@example.com",
      name: "User Three",
    });

    const payload = {
      age: 28,
      gender: "female" as const,
      field: "PM",
      jobTitle: "PM",
      company: "Gamma",
      bio: "Ship it to production!",
      interests: [{ id: "design", name: "Design", category: "skill" as const }],
      idempotencyKey: "same-key",
    };

    const first = await authedT.mutation(
      api.users.mutations.saveOnboarding,
      payload,
    );
    const second = await authedT.mutation(
      api.users.mutations.saveOnboarding,
      payload,
    );

    expect(first.userId).toBe(second.userId);
    expect(first.profileId).toBe(second.profileId);
    expect(second.interestsCount).toBe(1);
  });

  test("bio validation should pass with correct bio", async () => {
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        workosUserId: "workos_4",
        email: "t4@example.com",
        displayName: "User Four",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const authedT = t.withIdentity({
      subject: "workos_4",
      email: "t4@example.com",
      name: "User Four",
    });

    const payload = {
      age: 28,
      gender: "female" as const,
      field: "PM",
      jobTitle: "PM",
      company: "Gamma",
      bio: "This is a bio that is long enough.",
      interests: [],
      idempotencyKey: "some-key",
    };

    await authedT.mutation(api.users.mutations.saveOnboarding, payload);
  });
});
