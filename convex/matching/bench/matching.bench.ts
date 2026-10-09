/**
 * Load harness for the hot paths in convex/matching.
 *
 * Run with (one command, from the repo root):
 *   bash convex/matching/bench/run.sh <tag>
 *
 * Environment knobs:
 *   MATCHING_BENCH_N        users in the queue per cycle (default 32)
 *   MATCHING_BENCH_REPEATS  measured repetitions per scenario (default 5)
 *   MATCHING_BENCH_PURE     "1" also runs the pure pair-scoring micro bench
 *                           (only meaningful on branches that export
 *                           prepareScoringData/scorePairPrepared; skipped
 *                           automatically when missing)
 *
 * The harness drives the real Convex functions through convex-test:
 *   - runMatchingCycle end to end (shard partition -> scoring -> match creation)
 *   - getShardQueueEntries (per-shard queue scan)
 *   - calculateCompatibilityScoreInternal (per-pair action path)
 * It prints medians over repeats and emits one machine-readable line
 * (`MATCHING_BENCH_JSON:{...}`) that run.sh parses into results/<tag>.json
 * together with the machine's load average. Seeding is intentionally outside
 * the timed sections.
 */

import { describe, expect, it } from "vitest";
import { internal } from "@convex/_generated/api";
import { VectorUtils } from "@convex/types/entities/embedding";
import { createTestEnvironment } from "../../../test/convex/helpers";

const N = Number(process.env.MATCHING_BENCH_N ?? 32);
const REPEATS = Math.max(1, Number(process.env.MATCHING_BENCH_REPEATS ?? 5));
const RUN_PURE = process.env.MATCHING_BENCH_PURE === "1";

const VECTOR_DIMS = 256;
const HOURS = 60 * 60 * 1000;

type TestServer = ReturnType<typeof createTestEnvironment>;

/** Deterministic PRNG so every run scores identical inputs. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xc0ffee);

const INTEREST_POOL = [
  "technology",
  "ai",
  "startups",
  "design",
  "marketing",
  "finance",
  "healthcare",
  "education",
  "climate",
  "robotics",
];
const FIELDS = ["Technology", "Business", "Design", "Healthcare"];
const EXPERIENCES = ["junior", "mid", "senior", "lead", "executive"];
const LANGUAGES = [["English"], ["English", "Spanish"], ["German"], ["French", "English"]];
const ROLES = [["mentor"], ["mentee"], ["founder"], ["technical"], ["investor"]];

async function seedUsers(t: TestServer, n: number): Promise<string[]> {
  const userIds = await t.run(async (ctx) => {
    const ids: string[] = [];
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const userId = await ctx.db.insert("users", {
        workosUserId: `bench-user-${i}`,
        email: `bench-${i}@example.com`,
        displayName: `Bench User ${i}`,
        orgId: i % 3 === 0 ? "bench-org-a" : "bench-org-b",
        orgRole: "member",
        isActive: true,
        lastSeenAt: now,
        onboardingComplete: true,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("profiles", {
        userId,
        displayName: `Bench User ${i}`,
        bio: "bench",
        goals: "bench",
        languages: LANGUAGES[i % LANGUAGES.length],
        experience: EXPERIENCES[i % EXPERIENCES.length],
        field: FIELDS[i % FIELDS.length],
        company: `bench-company-${i % 5}`,
        createdAt: now,
        updatedAt: now,
      });

      for (const interest of pickInterests(i)) {
        await ctx.db.insert("userInterests", {
          userId,
          interestKey: interest,
          createdAt: now,
        });
      }

      // Deterministic Float32 vector -> deterministic scores.
      const vec = new Float32Array(VECTOR_DIMS);
      for (let d = 0; d < VECTOR_DIMS; d++) {
        vec[d] = rand();
      }
      await ctx.db.insert("embeddings", {
        sourceType: "user",
        sourceId: userId,
        vector: VectorUtils.floatArrayToBuffer(vec),
        model: "text-embedding-3-small",
        dimensions: VECTOR_DIMS,
        version: "bench-1",
        metadata: {},
        createdAt: now,
      });

      ids.push(userId);
    }
    return ids;
  });
  return userIds.map(String);
}

function pickInterests(i: number): string[] {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    out.push(INTEREST_POOL[(i * 3 + k) % INTEREST_POOL.length]);
  }
  return out;
}

function constraintsFor(i: number) {
  return {
    interests: pickInterests(i),
    roles: ROLES[i % ROLES.length],
    orgConstraints: i % 4 === 0 ? "different_org" : undefined,
  };
}

/** Insert N waiting queue entries with fully overlapping availability windows. */
async function seedQueue(t: TestServer, userIds: string[]): Promise<void> {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < userIds.length; i++) {
      await ctx.db.insert("matchingQueue", {
        userId: userIds[i] as never,
        availableFrom: now - 1000, // already available -> maximal pair loop
        availableTo: now + HOURS,
        constraints: constraintsFor(i),
        status: "waiting",
        createdAt: now - (userIds.length - i), // FIFO ordering
        updatedAt: now,
      });
    }
  });
}

function stats(timesMs: number[]) {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    iterations: sorted.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    meanMs: sum / sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
  };
}

describe("convex/matching load harness", () => {
  it(
    "measures matching hot paths",
    async () => {
      expect(N).toBeGreaterThan(1);
      const scenarios: Array<{ name: string; timesMs: number[] }> = [];
      const heapStart = (globalThis as { performance?: { memory?: { heapUsed: number } } })
        .performance?.memory?.heapUsed;

      // --- Scenario A: runMatchingCycle end to end -------------------------
      {
        const times: number[] = [];
        let lastResult: { totalMatches: number; averageScore: number } | null = null;
        for (let r = 0; r < REPEATS; r++) {
          const t = createTestEnvironment();
          const userIds = await seedUsers(t, N);
          await seedQueue(t, userIds);
          const start = Date.now();
          lastResult = await t.action(internal.matching.engine.runMatchingCycle, {
            shardCount: 4,
            minScore: 0.2,
            maxMatches: N / 2,
          });
          times.push(Date.now() - start);
        }
        expect(lastResult).not.toBeNull();
        scenarios.push({ name: "runMatchingCycle (end to end, 4 shards)", timesMs: times });
      }

      // --- Scenario B: getShardQueueEntries per-shard scan -----------------
      {
        const times: number[] = [];
        for (let r = 0; r < REPEATS; r++) {
          const t = createTestEnvironment();
          const userIds = await seedUsers(t, N);
          await seedQueue(t, userIds);
          const start = Date.now();
          await t.query(internal.matching.engine.getShardQueueEntries, {
            shard: 0,
            shardCount: 4,
            limit: N,
          });
          times.push(Date.now() - start);
        }
        scenarios.push({ name: "getShardQueueEntries (shard 0 of 4)", timesMs: times });
      }

      // --- Scenario C: per-pair scoring via the internal action ------------
      {
        const t = createTestEnvironment();
        const userIds = await seedUsers(t, 2);
        const times: number[] = [];
        for (let r = 0; r < REPEATS; r++) {
          const start = Date.now();
          const res = await t.action(
            internal.matching.scoring.calculateCompatibilityScoreInternal,
            {
              user1Id: userIds[0] as never,
              user2Id: userIds[1] as never,
              user1Constraints: constraintsFor(0),
              user2Constraints: constraintsFor(1),
            },
          );
          times.push(Date.now() - start);
          expect(res.score).toBeGreaterThanOrEqual(0);
        }
        scenarios.push({
          name: "calculateCompatibilityScoreInternal (1 pair, action path)",
          timesMs: times,
        });
      }

      // --- Scenario D (opt-in): pure prepared pair scoring -----------------
      if (RUN_PURE) {
        try {
          const mod = (await import("../scoring")) as {
            prepareScoringData?: (d: unknown) => unknown;
            scorePairPrepared?: (...args: unknown[]) => { score: number };
          };
          if (mod.prepareScoringData && mod.scorePairPrepared) {
            // Pure math on synthetic data; no Convex environment needed.
            const fakeData = (i: number) => ({
              user: { _id: `u${i}`, displayName: `u${i}`, orgId: "o", orgRole: "member" },
              profile: {
                experience: EXPERIENCES[i % EXPERIENCES.length],
                languages: LANGUAGES[i % LANGUAGES.length],
                field: FIELDS[i % FIELDS.length],
                company: `c${i % 5}`,
              },
              interests: pickInterests(i),
              embedding: (() => {
                const vec = new Float32Array(VECTOR_DIMS);
                for (let d = 0; d < VECTOR_DIMS; d++) vec[d] = rand();
                return { vector: VectorUtils.floatArrayToBuffer(vec), model: "m" };
              })(),
            });
            const a = mod.prepareScoringData(fakeData(0));
            const b = mod.prepareScoringData(fakeData(1));
            const inner = REPEATS * 20;
            const times: number[] = [];
            for (let r = 0; r < REPEATS; r++) {
              const start = Date.now();
              for (let k = 0; k < inner; k++) {
                mod.scorePairPrepared!(a, b, constraintsFor(0), constraintsFor(1));
              }
              times.push(Date.now() - start);
            }
            scenarios.push({
              name: `scorePairPrepared pure (${inner} pairs/batch)`,
              timesMs: times,
            });
          }
        } catch {
          console.warn(
            "[bench] pure path not available on this branch; skipping scenario D",
          );
        }
      }

      // --- Report -----------------------------------------------------------
      const heapEnd = (globalThis as { performance?: { memory?: { heapUsed: number } } })
        .performance?.memory?.heapUsed;
      const payload = {
        tag: process.env.MATCHING_BENCH_TAG ?? "run",
        n: N,
        repeats: REPEATS,
        node: process.version,
        date: new Date().toISOString(),
        memory: {
          heapUsedStartMB: heapStart ? Math.round(heapStart / 1048576) : null,
          heapUsedEndMB: heapEnd ? Math.round(heapEnd / 1048576) : null,
        },
        scenarios: scenarios.map((s) => ({ name: s.name, ...stats(s.timesMs) })),
      };

      console.log("\n=== convex/matching bench ===");
      for (const s of payload.scenarios) {
        console.log(
          `${s.name}: median ${s.medianMs}ms (mean ${s.meanMs.toFixed(1)}ms, ` +
            `min ${s.minMs}ms, max ${s.maxMs}ms, n=${s.iterations})`,
        );
      }
      console.log(`load average is captured by run.sh; heap ${payload.memory.heapUsedStartMB}MB -> ${payload.memory.heapUsedEndMB}MB`);
      console.log(`MATCHING_BENCH_JSON:${JSON.stringify(payload)}`);
    },
    REPEATS * 60_000 + 120_000,
  );
});
