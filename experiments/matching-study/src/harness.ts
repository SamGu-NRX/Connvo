/**
 * Study harness (node side): builds a convex-test environment over the
 * hand-built module map and materializes population plans into it.
 *
 * The vitest bridge constructs its own equivalent environment (setup.ts
 * modules + fake-timer clock) and reuses everything else from the study code.
 */

import { convexTest } from "convex-test";
import type { Id } from "@convex/_generated/dataModel";
import schema from "../../../convex/schema.js";
import { buildModuleMap } from "./modules.js";
import { installPatchedClock } from "./clock.js";
import type {
  PlannedEntry,
  PopulationPlan,
  ScenarioContext,
  StudyEnv,
  SyntheticIdentity,
} from "./types.js";
import { api } from "@convex/_generated/api";

type TestInstance = ReturnType<typeof convexTest>;

export interface StudyRuntime {
  env: StudyEnv;
  clock: ReturnType<typeof installPatchedClock>;
  defaults: { minScore: number; maxMatches: number; shardCount: number };
  runtime: TestInstance;
}

function adapt(t: TestInstance): StudyEnv {
  return {
    run: (fn) => t.run(fn as never),
    action: (fn, args) => t.action(fn as never, args as never),
    mutation: (fn, args) => t.mutation(fn as never, args as never),
    withIdentity: (identity: SyntheticIdentity) => {
      const authed = t.withIdentity(identity);
      return {
        mutation: (fn, args) => authed.mutation(fn as never, args as never),
        query: (fn, args) => authed.query(fn as never, args as never),
      };
    },
  };
}

/** Creates a fresh study runtime with a patched logical clock. */
export function createStudyRuntime(
  startMs: number,
  defaults: { minScore: number; maxMatches: number; shardCount: number },
): StudyRuntime {
  const clock = installPatchedClock(startMs);
  const t = convexTest(schema, buildModuleMap());
  return { env: adapt(t), clock, defaults, runtime: t };
}

export interface MaterializeResult {
  userIds: Id<"users">[];
  queueIds: Id<"matchingQueue">[];
  skippedRejoins: number;
}

/**
 * Materializes a population plan: creates users/profiles/interests/embeddings
 * and enters queue entries at their planned enqueue times (clock advances per
 * arrival). Pure w.r.t. the plan; db writes are convex-test in-memory.
 */
export async function materializePopulation(
  runtime: StudyRuntime,
  plan: PopulationPlan,
  opts: { queue: boolean },
): Promise<MaterializeResult> {
  const { env, clock } = runtime;
  const userIds: Id<"users">[] = [];

  for (const entry of plan.entries) {
    clock.advance(entry.enqueueAt - clock.now());
    const id = await createUser(runtime, entry);
    entry.userId = id;
    userIds.push(id);
  }

  const queueIds: Id<"matchingQueue">[] = [];
  let skippedRejoins = 0;
  if (opts.queue) {
    for (const entry of plan.entries) {
      clock.advance(entry.enqueueAt - clock.now());
      const authed = runtime.env.withIdentity(entry.identity);
      const queueId = (await authed.mutation(api.matching.queue.enterMatchingQueue, {
        availableFrom: entry.availableFrom,
        availableTo: entry.availableTo,
        constraints: entry.constraints,
      })) as unknown as Id<"matchingQueue">;
      queueIds.push(queueId);
    }
  }
  return { userIds, queueIds, skippedRejoins };
}

/** Re-enters a user into the queue (used for planned rejoins). */
export async function reenterQueue(
  runtime: StudyRuntime,
  entry: PlannedEntry,
  windowMs: number,
): Promise<Id<"matchingQueue"> | null> {
  const now = runtime.clock.now();
  const authed = runtime.env.withIdentity(entry.identity);
  // A second waiting entry is rejected; callers only invoke this when the
  // user's previous entry is no longer waiting.
  try {
    const queueId = (await authed.mutation(api.matching.queue.enterMatchingQueue, {
      availableFrom: now + 1000,
      availableTo: now + 1000 + windowMs,
      constraints: entry.constraints,
    })) as unknown as Id<"matchingQueue">;
    return queueId;
  } catch {
    return null;
  }
}

/** Creates a synthetic user with profile, interests, and embedding row. */
export async function createUser(runtime: StudyRuntime, entry: PlannedEntry): Promise<Id<"users">> {
  const now = runtime.clock.now();
  const id = (await runtime.env.run(async (ctx) => {
    const userId = (await ctx.db.insert("users", {
      workosUserId: entry.identity.subject,
      email: entry.identity.email,
      displayName: entry.profile.displayName,
      orgId: entry.orgId,
      orgRole: "member",
      isActive: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })) as unknown as Id<"users">;

    await ctx.db.insert("profiles", {
      userId,
      displayName: entry.profile.displayName,
      bio: "Synthetic study profile (declared objectives; not social ground truth)",
      languages: entry.profile.languages,
      experience: entry.profile.experience,
      field: entry.profile.field,
      ...(entry.profile.company ? { company: entry.profile.company } : {}),
      createdAt: now,
      updatedAt: now,
    });

    for (const interest of entry.interests) {
      await ctx.db.insert("userInterests", {
        userId,
        interestKey: interest,
        createdAt: now,
      });
    }

    // Users without a planned embedding get NO embeddings row (production
    // semantics). Inserting an empty vector would make cosineSimilarity
    // return NaN (0/0, no zero-guard) and silently kill every score.
    if (entry.embedding.length > 0) {
      const f32 = new Float32Array(entry.embedding);
      await ctx.db.insert("embeddings", {
        sourceType: "user",
        sourceId: userId,
        vector: f32.buffer as ArrayBuffer,
        model: "synthetic-hashed-v1",
        dimensions: entry.embedding.length,
        version: "1",
        metadata: { synthetic: "true" },
        createdAt: now,
      });
    }

    return userId;
  })) as unknown as Id<"users">;
  return id;
}

/** Convenience: a ScenarioContext over one runtime (freshEnv creates new runtimes). */
export function scenarioContext(
  runtime: StudyRuntime,
  makeFresh: () => StudyRuntime,
): ScenarioContext {
  return {
    env: runtime.env,
    clock: runtime.clock,
    freshEnv: () => makeFresh().env,
    defaults: runtime.defaults,
  };
}
