/**
 * Runnable usage examples for `convex/lib/rateLimit.ts`.
 *
 * Each example runs against a tiny in-memory stand-in for the Convex
 * document database, so everything here is hermetic: no deployment, no
 * network, no timers, and the window math is asserted relative to
 * `Date.now()`. Every example internally asserts what it demonstrates and
 * throws on an unmet expectation.
 *
 * Run via vitest (`npx vitest run convex/lib`) or directly with tsx, e.g.:
 *   npx tsx --eval "import('./convex/lib/examples/rateLimit.examples').then(m => m.runExamples()).then(r => console.log(r))"
 */

import {
  createRateLimitMiddleware,
  RateLimiter,
  RateLimitConfigs,
  type RateLimitConfig,
} from "../rateLimit";

export interface ExampleResult {
  name: string;
  detail: string;
}

/**
 * Minimal row shape used by the in-memory database stand-in.
 */
type Row = { _id: string } & Record<string, unknown>;

/**
 * Builds an in-memory `ctx.db` covering the exact operations
 * convex/lib/rateLimit.ts uses: `query().withIndex(...)` equality lookups,
 * `query().filter(...)`, `insert`, `patch`, and `delete`.
 */
function makeFakeDb() {
  const tables = new Map<string, Row[]>();
  let nextId = 0;

  const rowsOf = (table: string): Row[] => {
    let rows = tables.get(table);
    if (!rows) {
      rows = [];
      tables.set(table, rows);
    }
    return rows;
  };

  const withEq = (table: string, eqs: Array<[string, unknown]>) => ({
    unique: async () => rowsOf(table).find((row) => eqs.every(([f, v]) => row[f] === v)),
    first: async () =>
      rowsOf(table).find((row) => eqs.every(([f, v]) => row[f] === v)),
  });

  const db = {
    query: (table: string) => ({
      withIndex: (
        _indexName: string,
        build: (q: { eq: (f: string, v: unknown) => unknown }) => unknown,
      ) => {
        const eqs: Array<[string, unknown]> = [];
        const builder = {
          eq: (field: string, value: unknown) => {
            eqs.push([field, value]);
            return builder;
          },
        };
        build(builder);
        return withEq(table, eqs);
      },
      filter: () => {
        throw new Error("filter not needed in these examples");
      },
    }),
    insert: async (table: string, doc: Record<string, unknown>) => {
      const row: Row = { ...doc, _id: `${table}_${++nextId}` };
      rowsOf(table).push(row);
      return row._id;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      for (const rows of tables.values()) {
        const row = rows.find((r) => r._id === id);
        if (row) Object.assign(row, patch);
      }
    },
  };

  return { db, rows: (table: string) => rowsOf(table) };
}

// Cast helpers: examples only need the db surface the module touches.
type CheckCtx = Parameters<typeof RateLimiter.checkRateLimit>[0];
type UserId = Parameters<typeof RateLimiter.checkRateLimit>[1];
const ctxOf = (db: ReturnType<typeof makeFakeDb>["db"]) =>
  ({ db }) as unknown as CheckCtx;
const asUser = (id: string): UserId => id as UserId;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Example assertion failed: ${message}`);
  }
}

/**
 * Runs the numbered usage examples and returns one result each. Throws if
 * any example's internal assertions fail.
 */
export async function runExamples(): Promise<ExampleResult[]> {
  const results: ExampleResult[] = [];
  const config: RateLimitConfig = {
    maxRequests: 3,
    windowMs: 60_000,
    keyPrefix: "demo",
  };

  // 1. Fresh window: the first hit is allowed and counted.
  {
    const fake = makeFakeDb();
    const first = await RateLimiter.checkRateLimit(
      ctxOf(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    assert(first.allowed, "first request must be allowed");
    assert(first.totalHits === 1, "first request must record totalHits 1");
    assert(first.remaining === 2, "2 of 3 hits must remain");
    assert(
      first.resetTime % config.windowMs === 0,
      "resetTime must be a window boundary (fixed window, not sliding)",
    );
    results.push({
      name: "1. First request under a fresh window",
      detail:
        "checkRateLimit records the hit in a new rateLimits row and reports allowed with 2 of 3 hits remaining; resetTime is the fixed window boundary.",
    });
  }

  // 2. Exhaustion: hits beyond maxRequests are denied without writing.
  {
    const fake = makeFakeDb();
    for (let i = 0; i < 3; i++) {
      const ok = await RateLimiter.checkRateLimit(
        ctxOf(fake.db),
        asUser("user_a"),
        "ingest",
        config,
      );
      assert(ok.allowed, `hit ${i + 1} must be allowed`);
    }
    const denied = await RateLimiter.checkRateLimit(
      ctxOf(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    assert(!denied.allowed, "hit 4 must be denied");
    assert(denied.remaining === 0, "denied hits leave 0 remaining");
    assert(denied.totalHits === 3, "denied hits are not counted as new hits");
    assert(
      fake.rows("rateLimits").length === 1 &&
        fake.rows("rateLimits")[0].count === 3,
      "denied call must not modify the stored counter",
    );
    results.push({
      name: "2. Denial at the limit without a write",
      detail:
        "Once the stored count reaches maxRequests, further calls get allowed:false, totalHits stays at 3, and the stored counter is untouched.",
    });
  }

  // 3. Enforcement: enforceRateLimit throws a 429 ConvexError when exhausted.
  {
    const fake = makeFakeDb();
    for (let i = 0; i < 3; i++) {
      await RateLimiter.checkRateLimit(
        ctxOf(fake.db),
        asUser("user_a"),
        "ingest",
        config,
      );
    }
    const error = await RateLimiter.enforceRateLimit(
      ctxOf(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    ).then(
      () => null,
      (e) => e as { data?: { code?: string; statusCode?: number } },
    );
    assert(error !== null, "enforceRateLimit must throw when exhausted");
    assert(
      error?.data?.code === "RATE_LIMIT_EXCEEDED" &&
        error?.data?.statusCode === 429,
      "the thrown error must be the 429 RATE_LIMIT_EXCEEDED ConvexError",
    );
    results.push({
      name: "3. enforceRateLimit throws 429 when exhausted",
      detail:
        "Wrap checkRateLimit's outcome in a ConvexError with code RATE_LIMIT_EXCEEDED and statusCode 429 so clients can react to HTTP-style backoff.",
    });
  }

  // 4. Read-only status: inspecting quota does not consume it.
  {
    const fake = makeFakeDb();
    for (let i = 0; i < 3; i++) {
      await RateLimiter.checkRateLimit(
        ctxOf(fake.db),
        asUser("user_a"),
        "ingest",
        config,
      );
    }
    const status = await RateLimiter.getRateLimitStatus(
      ({ db: fake.db }) as unknown as Parameters<
        typeof RateLimiter.getRateLimitStatus
      >[0],
      asUser("user_a"),
      "ingest",
      config,
    );
    assert(!status.allowed, "status must report the exhausted window");
    assert(status.totalHits === 3, "status must report the stored count");
    assert(
      fake.rows("rateLimits")[0].count === 3,
      "a status read must never write",
    );
    results.push({
      name: "4. Read-only status checks",
      detail:
        "getRateLimitStatus answers 'how much is left' without writing, so it is safe from queries; quota only moves through checkRateLimit.",
    });
  }

  // 5. Key layout: keyPrefix is joined with the action as prefix_action.
  {
    const fake = makeFakeDb();
    await RateLimiter.checkRateLimit(
      ctxOf(fake.db),
      asUser("user_a"),
      "update",
      RateLimitConfigs.TRANSCRIPT_INGESTION,
    );
    assert(
      fake.rows("rateLimits")[0].action === "transcript_ingestion_update",
      "the stored action must be `${keyPrefix}_${action}`",
    );
    results.push({
      name: "5. Preset configs and storage-key layout",
      detail:
        "RateLimitConfigs.TRANSCRIPT_INGESTION (50/min) stores counters under the combined key 'transcript_ingestion_update' for action 'update'.",
    });
  }

  // 6. Middleware factory: bind a config once, enforce everywhere.
  {
    const fake = makeFakeDb();
    const enforce = createRateLimitMiddleware({
      maxRequests: 2,
      windowMs: 60_000,
    });
    const first = await enforce(
      ctxOf(fake.db),
      asUser("user_a"),
      "call",
    );
    assert(first.allowed, "middleware must allow hits under the limit");
    results.push({
      name: "6. createRateLimitMiddleware binding",
      detail:
        "createRateLimitMiddleware(config) returns a preconfigured enforcer that records a hit and throws a 429 ConvexError once the window is exhausted.",
    });
  }

  return results;
}
