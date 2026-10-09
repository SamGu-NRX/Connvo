import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  BurstRateLimiter,
  DistributedRateLimiter,
  RateLimiter,
  RateLimitConfigs,
  createRateLimitMiddleware,
  withRateLimit,
  type RateLimitConfig,
} from "./rateLimit";
import { runExamples } from "./examples/rateLimit.examples";

/**
 * Hand-rolled fake Convex document database covering just the operations
 * convex/lib/rateLimit.ts performs: indexed equality lookups, filtered
 * scans, insert, patch, and delete. Rows are plain objects in per-table
 * arrays; the real deployment's schema validation is NOT reproduced, so
 * tests assert logic, not validator behavior.
 */
type Row = { _id: string } & Record<string, unknown>;

type IndexBuilder = {
  eq: (field: string, value: unknown) => IndexBuilder;
};

type FilterHelpers = {
  field: (name: string) => { __field: string };
  lt: (a: unknown, b: unknown) => boolean;
  gte: (a: unknown, b: unknown) => boolean;
  eq: (a: unknown, b: unknown) => boolean;
};

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

  const resolve = (x: unknown, row: Row): unknown =>
    typeof x === "object" && x !== null && "__field" in x
      ? row[(x as { __field: string }).__field]
      : x;

  const helpersFor = (row: Row): FilterHelpers => ({
    field: (name) => ({ __field: name }),
    lt: (a, b) => Number(resolve(a, row)) < Number(resolve(b, row)),
    gte: (a, b) => Number(resolve(a, row)) >= Number(resolve(b, row)),
    eq: (a, b) => resolve(a, row) === resolve(b, row),
  });

  const terminal = (rows: Row[]) => ({
    unique: async () => {
      if (rows.length > 1) {
        throw new Error("unique: multiple rows matched");
      }
      return rows[0];
    },
    first: async () => rows[0],
    collect: async () => [...rows],
  });

  const db = {
    query: (table: string) => ({
      withIndex: (
        _indexName: string,
        build: (q: IndexBuilder) => IndexBuilder,
      ) => {
        const eqs: Array<[string, unknown]> = [];
        const builder: IndexBuilder = {
          eq: (field, value) => {
            eqs.push([field, value]);
            return builder;
          },
        };
        build(builder);
        return terminal(
          rowsOf(table).filter((row) =>
            eqs.every(([field, value]) => row[field] === value),
          ),
        );
      },
      filter: (predicate: (q: FilterHelpers) => unknown) =>
        terminal(
          rowsOf(table).filter((row) => Boolean(predicate(helpersFor(row)))),
        ),
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
    delete: async (id: string) => {
      for (const rows of tables.values()) {
        const index = rows.findIndex((r) => r._id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
  };

  return {
    db,
    rows: (table: string) => rowsOf(table),
    seed: (table: string, doc: Record<string, unknown>) => {
      rowsOf(table).push({ ...doc, _id: `${table}_seed_${++nextId}` });
    },
  };
}

type FakeDb = ReturnType<typeof makeFakeDb>;

// The lib module declares these params as Convex ctx types; the fakes
// implement only the surface the module actually touches.
type MutationCtxLike = Parameters<typeof RateLimiter.checkRateLimit>[0];
type QueryCtxLike = Parameters<typeof RateLimiter.getRateLimitStatus>[0];
type ActionCtxLike = Parameters<typeof RateLimiter.enforceFromAction>[0];
type UserIdLike = Parameters<typeof RateLimiter.checkRateLimit>[1];

const asUser = (id: string): UserIdLike => id as UserIdLike;
const asMutationCtx = (db: FakeDb["db"]) =>
  ({ db }) as unknown as MutationCtxLike;
const asQueryCtx = (db: FakeDb["db"]) => ({ db }) as unknown as QueryCtxLike;
const windowStartOf = (windowMs: number) =>
  Math.floor(Date.now() / windowMs) * windowMs;

function applyDecorator(
  fn: (ctx: MutationCtxLike, tag: string) => Promise<string>,
  config: RateLimitConfig,
): (ctx: MutationCtxLike, tag: string) => Promise<string> {
  const target: Record<string, unknown> = {};
  const descriptor: TypedPropertyDescriptor<typeof fn> = {
    value: fn,
    writable: true,
    enumerable: true,
    configurable: true,
  };
  withRateLimit(config)(target, "handle", descriptor);
  Object.defineProperty(target, "handle", descriptor);
  return target.handle as typeof fn;
}

describe("RateLimitConfigs presets", () => {
  it("defines positive per-minute limits with a keyPrefix each", () => {
    for (const config of Object.values(RateLimitConfigs)) {
      expect(config.windowMs).toBe(60_000);
      expect(config.maxRequests).toBeGreaterThan(0);
      expect(config.keyPrefix?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("RateLimiter.checkRateLimit", () => {
  const config: RateLimitConfig = {
    maxRequests: 2,
    windowMs: 60_000,
    keyPrefix: "demo",
  };

  it("allows the first request and records totalHits 1", async () => {
    const fake = makeFakeDb();
    const result = await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(result.allowed).toBe(true);
    expect(result.totalHits).toBe(1);
    expect(result.remaining).toBe(1);
    // resetTime is the end of the current fixed window: a windowMs multiple.
    expect(result.resetTime % config.windowMs).toBe(0);
  });

  it("stores the key as `${keyPrefix}_${action}`", async () => {
    const fake = makeFakeDb();
    await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].action).toBe("demo_ingest");
  });

  it("increments the same row for repeated hits inside one window", async () => {
    const fake = makeFakeDb();
    await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    const second = await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(second.allowed).toBe(true);
    expect(second.totalHits).toBe(2);
    expect(second.remaining).toBe(0);
    expect(fake.rows("rateLimits")).toHaveLength(1);
  });

  it("denies past maxRequests without writing", async () => {
    const fake = makeFakeDb();
    await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    const denied = await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.totalHits).toBe(2);
    // Exactly one row, unchanged by the denied call.
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].count).toBe(2);
  });

  it("keeps separate counters per action", async () => {
    const fake = makeFakeDb();
    await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    const other = await RateLimiter.checkRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "publish",
      config,
    );
    expect(other.allowed).toBe(true);
    expect(other.totalHits).toBe(1);
    expect(fake.rows("rateLimits")).toHaveLength(2);
  });

  it("propagates the .unique() failure when duplicate rows exist", async () => {
    const fake = makeFakeDb();
    const now = Date.now();
    const windowStart = windowStartOf(config.windowMs);
    for (let i = 0; i < 2; i++) {
      fake.seed("rateLimits", {
        userId: "user_a",
        action: "demo_ingest",
        windowStartMs: windowStart,
        count: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    await expect(
      RateLimiter.checkRateLimit(
        asMutationCtx(fake.db),
        asUser("user_a"),
        "ingest",
        config,
      ),
    ).rejects.toThrowError(/multiple rows matched/);
  });
});

describe("RateLimiter.enforceRateLimit", () => {
  const config: RateLimitConfig = {
    maxRequests: 1,
    windowMs: 60_000,
    keyPrefix: "demo",
  };

  it("returns the result while under the limit", async () => {
    const fake = makeFakeDb();
    const result = await RateLimiter.enforceRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(result.allowed).toBe(true);
  });

  it("throws a 429 ConvexError once the window is exhausted", async () => {
    const fake = makeFakeDb();
    await RateLimiter.enforceRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    const error = await RateLimiter.enforceRateLimit(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    ).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const data = (error as { data?: { code?: string; statusCode?: number } })
      .data;
    expect(data?.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data?.statusCode).toBe(429);
  });
});

describe("RateLimiter.enforceFromAction", () => {
  const config: RateLimitConfig = {
    maxRequests: 10,
    windowMs: 60_000,
    keyPrefix: "demo",
  };

  function actionCtxReturning(
    result: { remaining: number; resetAt: number },
    captured: Array<Record<string, unknown>>,
  ): ActionCtxLike {
    return {
      runMutation: async (
        _ref: unknown,
        args: Record<string, unknown>,
      ) => {
        captured.push(args);
        return result;
      },
    } as unknown as ActionCtxLike;
  }

  it("maps the internal mutation result and passes the built key", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const ctx = actionCtxReturning(
      { remaining: 7, resetAt: 1_234_567 },
      captured,
    );
    const result = await RateLimiter.enforceFromAction(
      ctx,
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(result).toEqual({
      allowed: true,
      remaining: 7,
      resetTime: 1_234_567,
      totalHits: 3, // maxRequests - remaining
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].action).toBe("demo_ingest");
    expect(captured[0].windowMs).toBe(config.windowMs);
    expect(captured[0].maxCount).toBe(config.maxRequests);
  });

  it("reports any internal failure as a rate limit error", async () => {
    const ctx = {
      runMutation: async () => {
        throw new Error("deployment unreachable");
      },
    } as unknown as ActionCtxLike;
    const error = await RateLimiter.enforceFromAction(
      ctx,
      asUser("user_a"),
      "ingest",
      config,
    ).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const data = (error as { data?: { code?: string } }).data;
    expect(data?.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});

describe("RateLimiter.getRateLimitStatus", () => {
  const config: RateLimitConfig = {
    maxRequests: 2,
    windowMs: 60_000,
    keyPrefix: "demo",
  };

  it("reports zero usage for an unknown key", async () => {
    const fake = makeFakeDb();
    const status = await RateLimiter.getRateLimitStatus(
      asQueryCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(status.allowed).toBe(true);
    expect(status.totalHits).toBe(0);
    expect(status.remaining).toBe(2);
  });

  it("reads without consuming quota after exhaustion", async () => {
    const fake = makeFakeDb();
    const mutationCtx = asMutationCtx(fake.db);
    await RateLimiter.checkRateLimit(
      mutationCtx,
      asUser("user_a"),
      "ingest",
      config,
    );
    await RateLimiter.checkRateLimit(
      mutationCtx,
      asUser("user_a"),
      "ingest",
      config,
    );
    const status = await RateLimiter.getRateLimitStatus(
      asQueryCtx(fake.db),
      asUser("user_a"),
      "ingest",
      config,
    );
    expect(status.allowed).toBe(false);
    expect(status.totalHits).toBe(2);
    // The status read must not have written anything.
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].count).toBe(2);
  });
});

describe("RateLimiter.cleanupExpiredLimits", () => {
  it("deletes only records older than the cutoff and returns the count", async () => {
    const fake = makeFakeDb();
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    fake.seed("rateLimits", {
      userId: "user_a",
      action: "old",
      windowStartMs: now - 25 * hour,
      count: 3,
      createdAt: now,
      updatedAt: now,
    });
    fake.seed("rateLimits", {
      userId: "user_a",
      action: "recent",
      windowStartMs: now - 1 * hour,
      count: 3,
      createdAt: now,
      updatedAt: now,
    });
    const deleted = await RateLimiter.cleanupExpiredLimits(
      asMutationCtx(fake.db),
    );
    expect(deleted).toBe(1);
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].action).toBe("recent");
  });
});

describe("RateLimiter.getRateLimitStats", () => {
  it("aggregates totals, unique users, and top actions", async () => {
    const fake = makeFakeDb();
    const seed = (userId: string, action: string, count: number) =>
      fake.seed("rateLimits", {
        userId,
        action,
        windowStartMs: Date.now(),
        count,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    seed("user_a", "a", 3);
    seed("user_a", "b", 2);
    seed("user_b", "a", 1);

    const stats = await RateLimiter.getRateLimitStats(asQueryCtx(fake.db));
    expect(stats.totalRequests).toBe(6);
    expect(stats.uniqueUsers).toBe(2);
    expect(stats.topActions[0]).toEqual({ action: "a", requests: 4 });
  });

  it("counts exhausted windows via the count >= 50 heuristic", async () => {
    const fake = makeFakeDb();
    fake.seed("rateLimits", {
      userId: "user_a",
      action: "heavy",
      windowStartMs: Date.now(),
      count: 60,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    fake.seed("rateLimits", {
      userId: "user_a",
      action: "light",
      windowStartMs: Date.now(),
      count: 49,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const stats = await RateLimiter.getRateLimitStats(asQueryCtx(fake.db));
    // Only the row with count 60 counts as a "hit" — even though no real
    // limit of 50 exists (the heuristic, not a precise measurement).
    expect(stats.rateLimitHits).toBe(1);
  });
});

describe("withRateLimit decorator", () => {
  const config: RateLimitConfig = {
    maxRequests: 1,
    windowMs: 60_000,
    keyPrefix: "lim",
  };

  function ctxWithIdentity(fake: FakeDb, identity: unknown) {
    return {
      auth: { getUserIdentity: async () => identity },
      db: fake.db,
    } as unknown as MutationCtxLike;
  }

  it("enforces and increments for an identity carrying userId", async () => {
    const fake = makeFakeDb();
    const handle = applyDecorator(
      async () => "ran",
      config,
    );
    const result = await handle(ctxWithIdentity(fake, { userId: "u1" }), "x");
    expect(result).toBe("ran");
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].userId).toBe("u1");
    expect(fake.rows("rateLimits")[0].action).toBe("lim_handle");
  });

  it("resolves the user by workosUserId when identity.userId is absent", async () => {
    const fake = makeFakeDb();
    fake.seed("users", { workosUserId: "workos_abc" });
    const handle = applyDecorator(async () => "ran", config);
    const result = await handle(
      ctxWithIdentity(fake, { subject: "workos_abc" }),
      "x",
    );
    expect(result).toBe("ran");
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].userId).toBe(
      fake.rows("users")[0]._id,
    );
  });

  it("silently skips enforcement when no identity is resolvable", async () => {
    const fake = makeFakeDb();
    const handle = applyDecorator(async () => "ran", config);
    const result = await handle(ctxWithIdentity(fake, {}), "x");
    expect(result).toBe("ran");
    expect(fake.rows("rateLimits")).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("never blocks: an exhausted limit logs a warning but the method still runs", async () => {
    const fake = makeFakeDb();
    // Pre-exhaust the window for action "lim_handle".
    fake.seed("rateLimits", {
      userId: "u1",
      action: "lim_handle",
      windowStartMs: windowStartOf(config.windowMs),
      count: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const handle = applyDecorator(async () => "ran", config);
    const result = await handle(ctxWithIdentity(fake, { userId: "u1" }), "x");
    expect(result).toBe("ran");
    expect(warnSpy).toHaveBeenCalled();
    // The counter was not incremented by the denied attempt either.
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].count).toBe(1);
  });
});

describe("createRateLimitMiddleware", () => {
  const config: RateLimitConfig = { maxRequests: 2, windowMs: 60_000 };

  it("returns a preconfigured enforcer that throws when exhausted", async () => {
    const fake = makeFakeDb();
    const middleware = createRateLimitMiddleware(config);
    const first = await middleware(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "call",
    );
    expect(first.allowed).toBe(true);
    await middleware(asMutationCtx(fake.db), asUser("user_a"), "call");
    const error = await middleware(
      asMutationCtx(fake.db),
      asUser("user_a"),
      "call",
    ).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { data?: { code?: string } }).data?.code,
    ).toBe("RATE_LIMIT_EXCEEDED");
  });
});

describe("BurstRateLimiter.checkBurstLimit", () => {
  it("allows below the burst size without consuming tokens", async () => {
    const fake = makeFakeDb();
    const burstConfig = { bucketSize: 10, refillRate: 1, burstSize: 3 };
    const fresh = await BurstRateLimiter.checkBurstLimit(
      asQueryCtx(fake.db),
      asUser("user_a"),
      "spike",
      burstConfig,
    );
    expect(fresh.allowed).toBe(true);
    expect(fresh.tokensRemaining).toBe(3);
    // Read-only: nothing was written, so nothing was consumed.
    expect(fake.rows("rateLimits")).toHaveLength(0);
  });

  it("denies once the stored count reaches burstSize", async () => {
    const fake = makeFakeDb();
    fake.seed("rateLimits", {
      userId: "user_a",
      action: "burst_spike",
      windowStartMs: Date.now(),
      count: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const result = await BurstRateLimiter.checkBurstLimit(
      asQueryCtx(fake.db),
      asUser("user_a"),
      "spike",
      { bucketSize: 10, refillRate: 1, burstSize: 3 },
    );
    expect(result.allowed).toBe(false);
    expect(result.tokensRemaining).toBe(-2); // can go negative: no consumption
  });
});

describe("DistributedRateLimiter.checkDistributedLimit", () => {
  it("forwards to the fixed-window counter using the raw key as userId", async () => {
    const fake = makeFakeDb();
    const result = await DistributedRateLimiter.checkDistributedLimit(
      asMutationCtx(fake.db),
      "user_42",
      { maxRequests: 5, windowMs: 60_000, keyPrefix: "dist" },
    );
    expect(result.allowed).toBe(true);
    expect(fake.rows("rateLimits")).toHaveLength(1);
    expect(fake.rows("rateLimits")[0].userId).toBe("user_42");
    // The hardcoded "distributed" action still gets the keyPrefix applied.
    expect(fake.rows("rateLimits")[0].action).toBe("dist_distributed");
    // NOTE: the fake db performs no schema validation. Real Convex rejects
    // this insert because userId must satisfy v.id("users").
  });
});

describe("bundled usage examples", () => {
  it("runs all examples with their internal assertions passing", async () => {
    const results = await runExamples();
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (const result of results) {
      expect(result.name.length).toBeGreaterThan(0);
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });
});

function silenceConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  };
}
let logSpy: ReturnType<typeof silenceConsole>["log"];
let warnSpy: ReturnType<typeof silenceConsole>["warn"];

beforeEach(() => {
  // The module logs on every check in non-production environments.
  const spies = silenceConsole();
  logSpy = spies.log;
  warnSpy = spies.warn;
});

afterEach(() => {
  vi.restoreAllMocks();
});
