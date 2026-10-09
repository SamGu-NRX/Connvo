/**
 * Typical-use examples for convex/lib/rateLimiter.ts.
 *
 * Each example runs against a hand-rolled in-memory fake of the Convex
 * `ctx` (no deployment, no network) and internally asserts what it
 * demonstrates, throwing when an expectation is unmet. Run with
 * `npx tsx convex/lib/examples/rateLimiter.examples.ts` or from vitest.
 */

import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { ErrorCodes } from "@convex/lib/errors";
import {
  BurstRateLimiter,
  cleanupOldRateLimits,
  enforceUserLimit,
  getRateLimitStatus,
} from "@convex/lib/rateLimiter";

export interface ExampleResult {
  name: string;
  detail: string;
}

interface FakeRow {
  _id: string;
  userId: string;
  action: string;
  windowStartMs: number;
  count: number;
  createdAt: number;
  updatedAt: number;
}

interface MockIndexQuery {
  eq(field: string, value: unknown): MockIndexQuery;
}

/** Minimal in-memory stand-in for ctx.db covering the module's usage. */
function makeFakeCtx() {
  const rows: FakeRow[] = [];
  let nextId = 1;
  const db = {
    query(_table: string) {
      return {
        withIndex(_indexName: string, bind: (q: MockIndexQuery) => unknown) {
          const constraints = new Map<string, unknown>();
          bind({
            eq(field, value) {
              constraints.set(field, value);
              return this;
            },
          });
          return {
            async unique() {
              const matches = rows.filter((row) =>
                [...constraints].every(
                  ([field, value]) => row[field as keyof FakeRow] === value,
                ),
              );
              return matches[0] ?? null;
            },
          };
        },
        filter(
          predicate: (q: {
            field(name: "updatedAt" | "count" | "createdAt" | "windowStartMs"): {
              __field: "updatedAt" | "count" | "createdAt" | "windowStartMs";
            };
            lt(
              a: { __field: "updatedAt" | "count" | "createdAt" | "windowStartMs" },
              b: number,
            ): (row: FakeRow) => boolean;
          }) => (row: FakeRow) => boolean,
        ) {
          const rowPredicate = predicate({
            field: (name) => ({ __field: name }),
            lt: (a, b) => (row) =>
              row[a.__field] < b,
          });
          return {
            async collect() {
              return rows.filter(rowPredicate);
            },
          };
        },
      };
    },
    async patch(id: string, updates: Partial<FakeRow>) {
      const row = rows.find((r) => r._id === id);
      if (!row) throw new Error(`patch: unknown id ${id}`);
      Object.assign(row, updates);
    },
    async insert(_table: string, doc: Omit<FakeRow, "_id">) {
      const row: FakeRow = { ...doc, _id: `rl_${nextId++}` };
      rows.push(row);
      return row._id;
    },
    async delete(id: string) {
      const index = rows.findIndex((r) => r._id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
  return {
    ctx: { db } as unknown as MutationCtx,
    queryCtx: { db } as unknown as QueryCtx,
    rows,
  };
}

const USER = "user_demo" as Id<"users">;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Example expectation unmet: ${message}`);
}

/** Example 1 - enforcing a limit consumes quota and stores a counter row. */
async function example1_enforceConsumesQuota(): Promise<ExampleResult> {
  const { ctx, rows } = makeFakeCtx();
  const config = { windowMs: 60_000, maxRequests: 3 };

  const first = await enforceUserLimit(ctx, "transcriptIngestion", USER, {
    config,
  });
  const second = await enforceUserLimit(ctx, "transcriptIngestion", USER, {
    config,
  });

  assert(first.allowed && second.allowed, "both calls should be admitted");
  assert(
    first.remaining === 2 && second.remaining === 1,
    "remaining should drop from 2 to 1 after each admitted call",
  );
  assert(rows.length === 1 && rows[0].count === 2, "one row counting both calls");
  return {
    name: "1. enforceUserLimit consumes quota per call",
    detail:
      "Each admitted call increments a rateLimits row for (user, action, window); remaining reports the post-increment quota, so callers can pass it to clients for throttling.",
  };
}

/** Example 2 - the fixed window reopens when the boundary passes. */
async function example2_fixedWindowReopens(): Promise<ExampleResult> {
  const { ctx, rows } = makeFakeCtx();
  const config = { windowMs: 50, maxRequests: 1 };

  const only = await enforceUserLimit(ctx, "matchingQueue", USER, { config });
  const blocked = await enforceUserLimit(ctx, "matchingQueue", USER, {
    config,
  });
  await new Promise((resolve) => setTimeout(resolve, 60)); // cross the boundary
  const nextWindow = await enforceUserLimit(ctx, "matchingQueue", USER, {
    config,
  });

  assert(only.allowed, "first call admitted");
  assert(!blocked.allowed, "second call in the same window rejected");
  assert(nextWindow.allowed, "call after the boundary admitted again");
  assert(rows.length === 2, "each window gets its own counter row");
  return {
    name: "2. fixed windows reopen on the boundary",
    detail:
      "Windows are fixed slices (floor(now/windowMs)*windowMs): when the boundary passes a brand-new row counts from zero, which also means a client can burst up to ~2x maxRequests across a boundary.",
  };
}

/** Example 3 - enforceUserLimit can throw a ConvexError with retry hints. */
async function example3_throwsWithRetryMetadata(): Promise<ExampleResult> {
  const { ctx } = makeFakeCtx();
  const config = { windowMs: 60_000, maxRequests: 1 };
  await enforceUserLimit(ctx, "promptGeneration", USER, { config });

  let caught: unknown;
  try {
    await enforceUserLimit(ctx, "promptGeneration", USER, {
      config,
      throws: true,
    });
  } catch (error) {
    caught = error;
  }

  const data = (caught as { data?: { code?: string; metadata?: Record<string, unknown> } }).data;
  assert(caught !== undefined, "the sixth call should throw");
  assert(data?.code === ErrorCodes.RATE_LIMIT_EXCEEDED, "error carries the rate-limit code");
  assert(typeof data?.metadata?.retryAfterSeconds === "number", "error carries retryAfterSeconds");
  return {
    name: "3. throws:true turns exhaustion into a ConvexError",
    detail:
      "With throws:true an exhausted limit raises createError.rateLimitExceeded whose data.metadata includes retryAfterSeconds, resetTime, windowStart, limit, and action - without it you just get allowed:false.",
  };
}

/** Example 4 - cleanupOldRateLimits deletes only stale counter rows. */
async function example4_cleanupRemovesStaleRows(): Promise<ExampleResult> {
  const { ctx, rows } = makeFakeCtx();

  // A row backdated beyond the cutoff (as an old window's row would be).
  rows.push({
    _id: "rl_old",
    userId: USER,
    action: "apiCalls",
    windowStartMs: Date.now() - 60_000,
    count: 60,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
  });
  await enforceUserLimit(ctx, "apiCalls", USER); // fresh row, updatedAt = now

  const deleted = await cleanupOldRateLimits(ctx, 30_000);

  assert(deleted === 1, "only the stale row is deleted");
  assert(rows.length === 1, "the fresh row survives");
  return {
    name: "4. cleanupOldRateLimits prunes stale counters",
    detail:
      "Rows whose updatedAt predates Date.now()-olderThanMs are deleted (count returned); nothing schedules this today, so production callers must invoke it from a cron or mutation or the table grows unbounded.",
  };
}

/** Example 5 - getRateLimitStatus maps actions to read-only quota state. */
async function example5_statusMapIsReadOnly(): Promise<ExampleResult> {
  const { queryCtx, rows } = makeFakeCtx();

  const status = await getRateLimitStatus(queryCtx, USER);

  assert(
    Object.keys(status).length === 5 && Object.values(status).every((r) => r.allowed),
    "every default action reports allowed for a fresh user",
  );
  assert(rows.length === 0, "status checks wrote nothing");
  return {
    name: "5. getRateLimitStatus reads quota without spending it",
    detail:
      "Status is read-only (safe in queries) and defaults to all DEFAULT_RATE_LIMITS actions; unknown actions quietly return an allowed:true placeholder instead of failing, so treat surprises with suspicion.",
  };
}

/** Example 6 - BurstRateLimiter smooths spikes within one process. */
async function example6_tokenBucket(): Promise<ExampleResult> {
  const limiter = new BurstRateLimiter(3, 1_000); // refills 1000 tokens/sec

  assert(
    limiter.consume() && limiter.consume() && limiter.consume(),
    "a full bucket admits capacity calls",
  );
  assert(!limiter.consume(), "an empty bucket rejects");
  await new Promise((resolve) => setTimeout(resolve, 5)); // ~5 tokens refill
  assert(limiter.getTokens() > 0, "tokens refill with elapsed time");
  return {
    name: "6. BurstRateLimiter is an in-process token bucket",
    detail:
      "Tokens start at capacity and refill continuously; because state lives on the instance it resets with every Convex isolate, so it only smooths bursts inside one invocation, never across requests.",
  };
}

/**
 * Runs every rateLimiter example in order and returns what each
 * demonstrated, throwing if any internal expectation is unmet.
 */
export async function runExamples(): Promise<ExampleResult[]> {
  return [
    await example1_enforceConsumesQuota(),
    await example2_fixedWindowReopens(),
    await example3_throwsWithRetryMetadata(),
    await example4_cleanupRemovesStaleRows(),
    await example5_statusMapIsReadOnly(),
    await example6_tokenBucket(),
  ];
}

// Direct execution (npx tsx convex/lib/examples/rateLimiter.examples.ts)
// prints one line per example; importing the module (vitest) does nothing.
if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.endsWith("rateLimiter.examples.ts")
) {
  runExamples()
    .then((results) => {
      for (const result of results) {
        console.log(`${result.name} - ${result.detail}`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
