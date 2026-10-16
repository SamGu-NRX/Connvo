// Eval-only seed for the local anonymous backend used by
// tools/call-eval (CONTRACT.md): users A/B/C + outsider O (WorkOS subjects
// local-test-a/b/c/o) and one active meeting with A–C as participants (A
// host). N (local-test-n, "Nina New") is also seeded but deliberately stays
// un-onboarded: she is the brand-new user a developer walks through
// onboarding with (token route ?user=N -> /onboarding?as=N). Env-gated:
// refuses to run unless CONNVO_LOCAL_TEST_JWKS is set on
// the deployment — the harness sets it only on the local backend. It is an
// internalMutation, so no client can call it on any deployment; only the CLI
// (`npx convex run devEval/seed`) and other server functions can.
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

const SEED_USERS = [
  { subject: "local-test-a", email: "a@connvo-local.test", name: "Alice Anderson", onboardingComplete: true },
  { subject: "local-test-b", email: "b@connvo-local.test", name: "Bob Brown", onboardingComplete: true },
  { subject: "local-test-c", email: "c@connvo-local.test", name: "Carol Chen", onboardingComplete: true },
  { subject: "local-test-o", email: "o@connvo-local.test", name: "Owen Outsider", onboardingComplete: true },
  { subject: "local-test-n", email: "n@connvo-local.test", name: "Nina New", onboardingComplete: false },
];

const MEETING_TITLE = "Eval harness smoke meeting";

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    // D2 gate: the local-test JWT provider is only configured on the eval
    // backend (tools/call-eval/scripts/local-backend.mjs step 3/6). Without
    // it these identities cannot authenticate anywhere.
    if (!process.env.CONNVO_LOCAL_TEST_JWKS) {
      throw new Error(
        "devEval/seed refuses to run: CONNVO_LOCAL_TEST_JWKS is not set on this deployment; " +
          "eval seeding is restricted to the local anonymous backend",
      );
    }

    const now = Date.now();

    // Idempotent on users: look them up by the WorkOS subject the harness
    // mints tokens for (by_workos_id index).
    const idBySubject: Record<string, Id<"users">> = {};
    for (const u of SEED_USERS) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", u.subject))
        .first();
      if (existing) {
        idBySubject[u.subject] = existing._id;
        continue;
      }
      idBySubject[u.subject] = await ctx.db.insert("users", {
        workosUserId: u.subject,
        email: u.email,
        displayName: u.name,
        isActive: true,
        onboardingComplete: u.onboardingComplete,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    const organizer = idBySubject["local-test-a"];
    const existingMeeting = await ctx.db
      .query("meetings")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizer))
      .filter((q) => q.eq(q.field("title"), MEETING_TITLE))
      .first();
    if (existingMeeting) {
      return { meetingId: existingMeeting._id, userIds: idBySubject };
    }

    const meetingId = await ctx.db.insert("meetings", {
      organizerId: organizer,
      title: MEETING_TITLE,
      description: "Seeded by tools/call-eval for the local eval backend (H-scenario fixtures).",
      scheduledAt: now,
      duration: 30 * 60_000,
      webrtcEnabled: true,
      state: "active",
      participantCount: 3,
      createdAt: now,
      updatedAt: now,
    });

    const participants: Array<{ subject: string; role: "host" | "participant" }> = [
      { subject: "local-test-a", role: "host" },
      { subject: "local-test-b", role: "participant" },
      { subject: "local-test-c", role: "participant" },
    ];
    for (const p of participants) {
      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId: idBySubject[p.subject],
        role: p.role,
        presence: "joined",
        joinedAt: now,
        createdAt: now,
      });
    }

    await ctx.db.insert("meetingState", {
      meetingId,
      active: true,
      startedAt: now,
      topics: [],
      recordingEnabled: false,
      updatedAt: now,
    });

    return { meetingId, userIds: idBySubject };
  },
});

// Default export so `npx convex run devEval/seed` (the orchestrator's
// invocation) resolves; `devEval/seed:seed` also works via the named export.
export default seed;

// Dev-only reset used to walk onboarding more than once: clears every
// onboarding artifact for one seeded identity so /onboarding shows the form
// again, exactly as it would for a brand-new sign-up. Guarded exactly like
// the seed (internalMutation + the local-backend env check), so no client
// can call it on any deployment; only the CLI can.
export const resetOnboarding = internalMutation({
  args: { subject: v.string() },
  handler: async (ctx, { subject }) => {
    if (!process.env.CONNVO_LOCAL_TEST_JWKS) {
      throw new Error(
        "devEval/seed:resetOnboarding refuses to run: CONNVO_LOCAL_TEST_JWKS is not set on this deployment; " +
          "eval seeding is restricted to the local anonymous backend",
      );
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", subject))
      .first();
    if (!user) {
      throw new Error(`devEval/seed:resetOnboarding: no user with subject ${subject}`);
    }
    for (const table of ["profiles", "userInterests", "availabilityBlocks"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.patch(user._id, {
      onboardingComplete: false,
      onboardingCompletedAt: undefined,
      updatedAt: Date.now(),
    });
    return { userId: user._id, subject };
  },
});
