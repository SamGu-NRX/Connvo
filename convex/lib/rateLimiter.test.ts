/**
 * Rate Limiter Utilities Tests
 *
 * Unit tests for convex/lib/rateLimiter.ts. These are hermetic: the Convex
 * `ctx` is a hand-rolled in-memory fake implementing only the db methods the
 * module touches (query/withIndex/unique, query/filter/collect, patch,
 * insert, delete), and time is controlled with fake timers so fixed-window
 * boundaries are deterministic. No network and no Convex deployment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { ErrorCodes } from "@convex/lib/errors";
import {
  BurstRateLimiter,
  DEFAULT_RATE_LIMITS,
  checkUserLimit,
  cleanupOldRateLimits,
  enforceGlobalLimit,
  enforceIPLimit,
  enforceUserLimit,
  getRateLimitStatus,
  withRateLimit,
} from "@convex/lib/rateLimiter";

/** Epoch ms that is a multiple of 1000 and 60000 so window math is exact. */
const T_BASE = 1_700_000_040_000;
const USER = "user_test" as Id<"users">;

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

/**
 * Builds a fake MutationCtx/QueryCtx whose `db` keeps rows in memory.
 * Constraints passed to withIndex are applied as exact-match filters,
 * matching how the module queries by (userId, action, windowStartMs).
 */
function makeFakeCtx() {
  const rows: FakeRow[] = [];
  let nextId = 1;

  const db = {
    query(_table: string) {
      return {
        withIndex(
          _indexName: string,
          bind: (q: MockIndexQuery) => unknown,
        ) {
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
              if (matches.length > 1) {
                throw new Error(
                  `unique() found ${matches.length} matching rows`,
                );
              }
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

describe("rateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T_BASE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("DEFAULT_RATE_LIMITS", () => {
    it("exposes a sane policy for each well-known action", () => {
      const actionNames = [
        "transcriptIngestion",
        "noteOperations",
        "promptGeneration",
        "matchingQueue",
        "apiCalls",
      ];
      for (const action of actionNames) {
        const config = DEFAULT_RATE_LIMITS[action];
        expect(config, `missing policy for ${action}`).toBeDefined();
        expect(config.windowMs).toBeGreaterThan(0);
        expect(config.maxRequests).toBeGreaterThan(0);
      }
      // Unknown actions have no policy, which is what triggers the
      // "No rate limit configuration" error paths.
      expect(DEFAULT_RATE_LIMITS["noSuchAction"]).toBeUndefined();
    });
  });

  describe("enforceUserLimit", () => {
    it("admits the first call, consumes quota, and creates a counter row", async () => {
      const { ctx, rows } = makeFakeCtx();

      const result = await enforceUserLimit(ctx, "apiCalls", USER);

      expect(result.allowed).toBe(true);
      // apiCalls allows 60/min; this call consumed one.
      expect(result.remaining).toBe(59);
      expect(result.windowStart).toBe(T_BASE);
      expect(result.resetTime).toBe(T_BASE + 60_000);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: USER,
        action: "apiCalls",
        windowStartMs: T_BASE,
        count: 1,
      });
    });

    it("increments the same row within a window and freezes it at the max", async () => {
      const { ctx, rows } = makeFakeCtx();
      const config = { windowMs: 60_000, maxRequests: 2 };

      const first = await enforceUserLimit(ctx, "matchingQueue", USER, {
        config,
      });
      const second = await enforceUserLimit(ctx, "matchingQueue", USER, {
        config,
      });
      const third = await enforceUserLimit(ctx, "matchingQueue", USER, {
        config,
      });

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(0); // 2 per window, both consumed
      expect(third.allowed).toBe(false);
      expect(third.remaining).toBe(0);
      // The first row was patched to the max and the rejected call did
      // not create a new row or push the count past the max.
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(2);
    });

    it("throws a ConvexError with retry metadata when throws is set", async () => {
      const { ctx } = makeFakeCtx();
      await enforceUserLimit(ctx, "matchingQueue", USER);
      await enforceUserLimit(ctx, "matchingQueue", USER);
      await enforceUserLimit(ctx, "matchingQueue", USER);
      await enforceUserLimit(ctx, "matchingQueue", USER);
      await enforceUserLimit(ctx, "matchingQueue", USER);

      let caught: unknown;
      try {
        await enforceUserLimit(ctx, "matchingQueue", USER, { throws: true });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      const data = (caught as { data?: { code?: string; message?: string; metadata?: Record<string, unknown> } })
        .data;
      expect(data?.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
      expect(data?.message).toContain("Try again in 60 seconds");
      expect(data?.metadata?.limit).toBe(5);
      expect(data?.metadata?.action).toBe("matchingQueue");
      // T_BASE is a window boundary, so the full window remains.
      expect(data?.metadata?.retryAfterSeconds).toBe(60);
      expect(data?.metadata?.resetTime).toBe(T_BASE + 60_000);
      expect(data?.metadata?.windowStart).toBe(T_BASE);
    });

    it("returns allowed:false without throwing when throws is unset", async () => {
      const { ctx } = makeFakeCtx();
      for (let i = 0; i < 5; i++) {
        await enforceUserLimit(ctx, "matchingQueue", USER);
      }

      const result = await enforceUserLimit(ctx, "matchingQueue", USER);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("throws a plain error for an unknown action with no explicit config", async () => {
      const { ctx } = makeFakeCtx();

      await expect(
        enforceUserLimit(ctx, "noSuchAction", USER),
      ).rejects.toThrow(/No rate limit configuration found/);
    });

    it("accepts an explicit config for an action with no default", async () => {
      const { ctx, rows } = makeFakeCtx();

      const result = await enforceUserLimit(ctx, "noSuchAction", USER, {
        config: { windowMs: 1_000, maxRequests: 2 },
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("noSuchAction");
    });

    it("opens a fresh window (and a new row) after the boundary", async () => {
      const { ctx, rows } = makeFakeCtx();
      const config = { windowMs: 1_000, maxRequests: 1 };

      const first = await enforceUserLimit(ctx, "custom", USER, { config });
      vi.setSystemTime(T_BASE + 1_000);
      const second = await enforceUserLimit(ctx, "custom", USER, { config });

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(second.windowStart).toBe(T_BASE + 1_000);
      expect(second.resetTime).toBe(T_BASE + 2_000);
      expect(rows).toHaveLength(2);
    });
  });

  describe("checkUserLimit", () => {
    it("reports full quota for a user with no history without writing rows", async () => {
      const { queryCtx, rows } = makeFakeCtx();

      const result = await checkUserLimit(queryCtx, "apiCalls", USER);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(60);
      expect(rows).toHaveLength(0); // read-only
    });

    it("reflects consumed quota without consuming more", async () => {
      const { ctx, queryCtx, rows } = makeFakeCtx();
      await enforceUserLimit(ctx, "matchingQueue", USER);
      await enforceUserLimit(ctx, "matchingQueue", USER);

      const first = await checkUserLimit(queryCtx, "matchingQueue", USER);
      const second = await checkUserLimit(queryCtx, "matchingQueue", USER);

      expect(first.remaining).toBe(3);
      expect(second).toEqual(first); // idempotent read
      expect(rows[0].count).toBe(2); // unchanged by the checks
      expect(rows).toHaveLength(1);
    });

    it("throws for an unknown action with no explicit config", async () => {
      const { queryCtx } = makeFakeCtx();

      await expect(
        checkUserLimit(queryCtx, "noSuchAction", USER),
      ).rejects.toThrow(/No rate limit configuration found/);
    });
  });

  describe("cleanupOldRateLimits", () => {
    it("deletes only rows older than the cutoff and reports the count", async () => {
      const { ctx, rows } = makeFakeCtx();
      await enforceUserLimit(ctx, "apiCalls", USER);
      vi.setSystemTime(T_BASE + 2 * 60 * 60 * 1000); // 2 hours later
      await enforceUserLimit(ctx, "apiCalls", USER);
      expect(rows).toHaveLength(2);

      const deleted = await cleanupOldRateLimits(ctx, 60 * 60 * 1000);

      expect(deleted).toBe(1);
      expect(rows).toHaveLength(1);
      // The surviving row is the fresh one.
      expect(rows[0].windowStartMs).toBe(T_BASE + 2 * 60 * 60 * 1000);
    });

    it("returns zero when there is nothing to delete", async () => {
      const { ctx, rows } = makeFakeCtx();
      await enforceUserLimit(ctx, "apiCalls", USER);

      const deleted = await cleanupOldRateLimits(ctx, 60 * 60 * 1000);

      expect(deleted).toBe(0);
      expect(rows).toHaveLength(1);
    });
  });

  describe("getRateLimitStatus", () => {
    it("returns fresh status for every default action without consuming quota", async () => {
      const { queryCtx, rows } = makeFakeCtx();

      const status = await getRateLimitStatus(queryCtx, USER);

      expect(Object.keys(status).sort()).toEqual(
        Object.keys(DEFAULT_RATE_LIMITS).sort(),
      );
      for (const result of Object.values(status)) {
        expect(result.allowed).toBe(true);
      }
      expect(rows).toHaveLength(0); // status checks are read-only
    });

    it("checks only the requested actions", async () => {
      const { queryCtx } = makeFakeCtx();

      const status = await getRateLimitStatus(queryCtx, USER, ["apiCalls"]);

      expect(Object.keys(status)).toEqual(["apiCalls"]);
    });

    it("falls back to an allowed placeholder for unknown actions instead of throwing", async () => {
      const { queryCtx } = makeFakeCtx();

      const status = await getRateLimitStatus(queryCtx, USER, ["noSuchAction"]);

      expect(status.noSuchAction).toEqual({
        allowed: true,
        remaining: 100,
        resetTime: T_BASE + 60_000,
        windowStart: T_BASE,
      });
    });
  });

  describe("withRateLimit", () => {
    it("passes the call through to the original method without enforcing anything", async () => {
      let calls = 0;
      const target = {
        value: (n: number) => {
          calls += 1;
          return n * 2;
        },
      };
      const descriptor = {
        value: target.value,
      };

      const decorated = withRateLimit("apiCalls", {
        windowMs: 1_000,
        maxRequests: 1,
      })(target, "value", descriptor);

      // The limit is maxRequests: 1, but nothing blocks repeated calls.
      const results = [];
      for (let i = 1; i <= 3; i++) {
        results.push(await descriptor.value!(i));
      }

      expect(results).toEqual([2, 4, 6]);
      expect(calls).toBe(3);
      expect(decorated).toBe(descriptor);
    });

    it("makes the decorated method async even when the original was sync", async () => {
      const target = { compute: () => 42 };
      const descriptor: TypedPropertyDescriptor<() => number> = {
        value: () => 42,
        writable: true,
        enumerable: true,
        configurable: true,
      };

      withRateLimit("apiCalls")(target, "compute", descriptor);

      // The wrapper stores an async function into descriptor.value while
      // the declared type still claims a sync number - read via unknown.
      const returned: unknown = descriptor.value!();
      // A raw sync return value would not be a thenable.
      expect(typeof (returned as Promise<unknown>).then).toBe("function");
      await expect(returned as Promise<unknown>).resolves.toBe(42);
    });
  });

  describe("BurstRateLimiter", () => {
    it("starts full, admits up to capacity, then rejects", () => {
      const limiter = new BurstRateLimiter(3, 10);

      expect(limiter.consume()).toBe(true);
      expect(limiter.consume()).toBe(true);
      expect(limiter.consume()).toBe(true);
      expect(limiter.consume()).toBe(false); // bucket empty
    });

    it("does not spend tokens on a rejected consume", () => {
      const limiter = new BurstRateLimiter(2, 10);

      expect(limiter.consume(2)).toBe(true);
      expect(limiter.consume(1)).toBe(false);
      expect(limiter.getTokens()).toBe(0); // unchanged by the rejection
    });

    it("refills with elapsed time and caps at capacity", () => {
      const limiter = new BurstRateLimiter(5, 10); // 10 tokens/second

      expect(limiter.consume(5)).toBe(true);
      vi.setSystemTime(T_BASE + 200); // +200ms -> +2 tokens
      expect(limiter.getTokens()).toBe(2);
      expect(limiter.consume(2)).toBe(true);
      vi.setSystemTime(T_BASE + 60_000); // refill far past capacity
      expect(limiter.getTokens()).toBe(5); // capped
    });

    it("refuses requests larger than the whole capacity", () => {
      const limiter = new BurstRateLimiter(3, 10);

      expect(limiter.consume(4)).toBe(false);
      expect(limiter.getTokens()).toBe(3); // nothing was spent
    });
  });

  describe("enforceIPLimit", () => {
    it("keys the counter by the IP-derived synthetic user id", async () => {
      const { ctx, rows } = makeFakeCtx();

      const result = await enforceIPLimit(ctx, "192.0.2.1", "apiCalls");

      expect(result.allowed).toBe(true);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe("ip_192_0_2_1");
      expect(rows[0].action).toBe("apiCalls");
    });

    it("gives distinct IPs distinct counters", async () => {
      const { ctx, rows } = makeFakeCtx();
      const limited = { windowMs: 60_000, maxRequests: 1 };

      await enforceIPLimit(ctx, "192.0.2.1", "apiCalls", limited);
      const other = await enforceIPLimit(
        ctx,
        "203.0.113.7",
        "apiCalls",
        limited,
      );

      expect(other.allowed).toBe(true); // not throttled by the first IP
      expect(rows).toHaveLength(2);
    });
  });

  describe("enforceGlobalLimit", () => {
    it("shares one counter under the 'global' user id across all callers", async () => {
      const { ctx, rows } = makeFakeCtx();
      const config = { windowMs: 60_000, maxRequests: 2 };

      const first = await enforceGlobalLimit(ctx, "matchingQueue", config);
      const second = await enforceGlobalLimit(ctx, "matchingQueue", config);
      const third = await enforceGlobalLimit(ctx, "matchingQueue", config);

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(third.allowed).toBe(false); // shared budget exhausted
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe("global");
      expect(rows[0].count).toBe(2); // frozen at the max
    });
  });
});
