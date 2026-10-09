/**
 * Unit tests for the resilience module (circuit breakers, retry policies,
 * semaphores, and utility compositions).
 *
 * These are plain unit tests against the exported classes/functions with
 * hand-rolled fakes — no network, no Convex deployment, no leaked timers:
 * delays are kept to single-digit milliseconds and spies are restored in
 * `afterEach`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createError } from "./errors";
import {
  CircuitBreaker,
  CircuitBreakerConfigs,
  CircuitBreakers,
  ResilienceUtils,
  RetryPolicies,
  Semaphore,
  Semaphores,
  withRetry,
  type CircuitBreakerConfig,
  type RetryPolicy,
} from "./resilience";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Fast retry policy for tests: retries everything, waits at most ~2ms. */
function fastPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxAttempts: 3,
    baseDelayMs: 1,
    maxDelayMs: 2,
    backoffMultiplier: 2,
    ...overrides,
  };
}

/** Breaker config for tests: opens at 50% failures after 2 requests. */
const testBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 0.5,
  recoveryTimeoutMs: 1000,
  monitoringWindowMs: 60000,
  minimumThroughput: 2,
};

/** Trips the test breaker open with two recorded failures. */
async function tripBreaker(breaker: CircuitBreaker): Promise<void> {
  await expect(
    breaker.execute(async () => {
      throw new Error("f1");
    }),
  ).rejects.toThrow("f1");
  await expect(
    breaker.execute(async () => {
      throw new Error("f2");
    }),
  ).rejects.toThrow("f2");
  expect(breaker.getStatus().state).toBe("open");
}

describe("withRetry", () => {
  it("returns the operation's value on first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    }, fastPolicy());
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries transient failures until the operation succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("flaky");
      return "third";
    }, fastPolicy());
    expect(result).toBe("third");
    expect(calls).toBe(3);
  });

  it("throws the last error after exhausting all attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("always fails");
      }, fastPolicy()),
    ).rejects.toThrow("always fails");
    expect(calls).toBe(3);
  });

  it("throws a generic error without running the operation when maxAttempts is 0", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        return "never";
      }, fastPolicy({ maxAttempts: 0 })),
    ).rejects.toThrow("Max retry attempts exceeded");
    expect(calls).toBe(0);
  });

  it("does not retry errors excluded by retryableErrors", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("permanent validation problem");
      }, fastPolicy({ retryableErrors: ["timeout", "ECONNRESET"] })),
    ).rejects.toThrow("permanent validation problem");
    expect(calls).toBe(1);
  });

  it("retries errors matching retryableErrors by message substring", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("ECONNRESET: connection reset by peer");
      }, fastPolicy({ retryableErrors: ["ECONNRESET"] })),
    ).rejects.toThrow("ECONNRESET");
    expect(calls).toBe(3);
  });

  it("retries errors matching retryableErrors by error name", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new TypeError("cannot read properties of undefined");
      }, fastPolicy({ retryableErrors: ["TypeError"] })),
    ).rejects.toThrow("cannot read properties");
    expect(calls).toBe(3);
  });

  it("retries a breaker-open ConvexError whose JSON payload embeds a listed status code", async () => {
    // createError.externalServiceTimeout builds a ConvexError whose .message
    // is the JSON payload (containing "statusCode":504) — the "504" entry of
    // the externalService allowlist matches it even though the plain word
    // "timeout" would not match the "timed out" phrasing.
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw createError.externalServiceTimeout("Circuit breaker", 30000);
      }, fastPolicy({
        ...RetryPolicies.externalService(),
        baseDelayMs: 1,
        maxDelayMs: 2,
        jitterMs: 0,
      })),
    ).rejects.toMatchObject({ data: { code: "EXTERNAL_SERVICE_TIMEOUT" } });
    expect(calls).toBe(4);
  });

  it("backs off exponentially and adds deterministic jitter between attempts", async () => {
    // Capture the requested delays and run the timer callbacks
    // synchronously so no real time is consumed.
    const delays: number[] = [];
    type SetTimeout = typeof globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        handler();
        return 0 as unknown as ReturnType<SetTimeout>;
      }) as unknown as SetTimeout,
    );
    vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter = 0.5 * jitterMs

    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("flaky");
      return "done";
    }, fastPolicy({
      baseDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitterMs: 50,
    }));

    expect(result).toBe("done");
    // Retry 1: 100 * 2^0 + 0.5*50 = 125; retry 2: 100 * 2^1 + 25 = 225.
    expect(delays).toEqual([125, 225]);
  });

  it("caps the backoff portion of the delay at maxDelayMs", async () => {
    const delays: number[] = [];
    type SetTimeout = typeof globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        handler();
        return 0 as unknown as ReturnType<SetTimeout>;
      }) as unknown as SetTimeout,
    );
    vi.spyOn(Math, "random").mockReturnValue(0); // no jitter

    let calls = 0;
    await withRetry(async () => {
      calls++;
      if (calls < 4) throw new Error("flaky");
      return "done";
    }, fastPolicy({
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 1200,
      backoffMultiplier: 3,
      jitterMs: 0,
    }));

    // Uncapped would be 1000, 3000, 9000: attempt 2 and 3 are capped to
    // 1200, while attempt 1 (1000) is below the cap and passes through.
    expect(delays).toEqual([1000, 1200, 1200]);
  });
});

describe("CircuitBreaker", () => {
  it("starts closed and passes results through", async () => {
    const breaker = new CircuitBreaker(testBreakerConfig);
    expect(breaker.getStatus().state).toBe("closed");
    await expect(breaker.execute(async () => 42)).resolves.toBe(42);
  });

  it("opens once the failure rate reaches the threshold with enough throughput", async () => {
    const breaker = new CircuitBreaker(testBreakerConfig);
    await tripBreaker(breaker); // 2/2 failures = 100% >= 50%, throughput 2 >= 2
  });

  it("stays closed below minimumThroughput even with all requests failing", async () => {
    const breaker = new CircuitBreaker({
      ...testBreakerConfig,
      minimumThroughput: 3,
    });
    await expect(
      breaker.execute(async () => {
        throw new Error("f1");
      }),
    ).rejects.toThrow("f1");
    expect(breaker.getStatus().state).toBe("closed"); // 1 request < 3
  });

  it("fails fast while open with EXTERNAL_SERVICE_TIMEOUT without running the operation", async () => {
    const breaker = new CircuitBreaker(testBreakerConfig);
    await tripBreaker(breaker);

    let ran = false;
    await expect(
      breaker.execute(async () => {
        ran = true;
        return "should not run";
      }),
    ).rejects.toMatchObject({ data: { code: "EXTERNAL_SERVICE_TIMEOUT" } });
    expect(ran).toBe(false);

    const status = breaker.getStatus();
    expect(status.nextRetryTime).toBeDefined();
    expect(status.lastFailureTime).toBeDefined();
  });

  it("moves open → half-open → closed through a successful probe", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(testBreakerConfig);
    await tripBreaker(breaker);

    await vi.advanceTimersByTime(1001); // past recoveryTimeoutMs

    await expect(breaker.execute(async () => "probe")).resolves.toBe("probe");
    const status = breaker.getStatus();
    expect(status.state).toBe("closed");
    expect(status.failureCount).toBe(0);
    expect(status.nextRetryTime).toBeUndefined();
  });

  it("reopens when the half-open probe fails", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(testBreakerConfig);
    await tripBreaker(breaker);
    const prevNextRetry = breaker.getStatus().nextRetryTime!;

    await vi.advanceTimersByTime(1001);
    await expect(
      breaker.execute(async () => {
        throw new Error("probe failed");
      }),
    ).rejects.toThrow("probe failed");

    const status = breaker.getStatus();
    expect(status.state).toBe("open");
    expect(status.nextRetryTime).toBeGreaterThan(prevNextRetry);
  });

  it("propagates the operation's own error while counting the failure", async () => {
    const breaker = new CircuitBreaker(testBreakerConfig);
    const boom = new Error("boom");
    await expect(
      breaker.execute(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(breaker.getStatus().failureCount).toBe(1);
  });

  it("resets window counters after the monitoring window rolls over", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      ...testBreakerConfig,
      monitoringWindowMs: 50,
      recoveryTimeoutMs: 30,
    });
    await tripBreaker(breaker);

    await vi.advanceTimersByTime(80); // past both window (50) and recovery (30)
    await expect(breaker.execute(async () => "probe")).resolves.toBe("probe");

    const status = breaker.getStatus();
    expect(status.state).toBe("closed");
    expect(status.failureCount).toBe(0); // window reset wiped the failures
  });
});

describe("RetryPolicies and CircuitBreakerConfigs", () => {
  it("return fresh preset objects on every call", () => {
    const a = RetryPolicies.externalService();
    const b = RetryPolicies.externalService();
    expect(b).toEqual(a);
    expect(b).not.toBe(a); // distinct object, safe to mutate

    const c1 = CircuitBreakerConfigs.videoService();
    const c2 = CircuitBreakerConfigs.videoService();
    expect(c2).toEqual(c1);
    expect(c2).not.toBe(c1);
  });

  it("exposes the documented preset values", () => {
    expect(RetryPolicies.conservative().maxAttempts).toBe(3);
    expect(RetryPolicies.aggressive().maxAttempts).toBe(5);
    expect(RetryPolicies.realtime().maxAttempts).toBe(2);
    expect(RetryPolicies.externalService().retryableErrors).toContain("timeout");

    expect(CircuitBreakerConfigs.externalApi().failureThreshold).toBe(0.5);
    expect(CircuitBreakerConfigs.videoService().minimumThroughput).toBe(3);
    expect(CircuitBreakerConfigs.transcriptionService().recoveryTimeoutMs).toBe(
      45000,
    );
  });
});

describe("ResilienceUtils", () => {
  it("withResiliency counts all retries as a single breaker request", async () => {
    const breaker = new CircuitBreaker(testBreakerConfig);
    let calls = 0;
    await expect(
      ResilienceUtils.withResiliency(
        async () => {
          calls++;
          throw new Error("always fails");
        },
        breaker,
        fastPolicy(),
      ),
    ).rejects.toThrow("always fails");
    expect(calls).toBe(3); // retried 3 times inside the breaker...
    expect(breaker.getStatus().failureCount).toBe(1); // ...but ONE breaker failure
  });

  it("withResiliency resolves through the breaker after retries", async () => {
    const breaker = new CircuitBreaker(testBreakerConfig);
    let calls = 0;
    const result = await ResilienceUtils.withResiliency(
      async () => {
        calls++;
        if (calls < 3) throw new Error("flaky");
        return "eventual";
      },
      breaker,
      fastPolicy(),
    );
    expect(result).toBe("eventual");
    expect(breaker.getStatus().state).toBe("closed");
    expect(breaker.getStatus().failureCount).toBe(0);
  });

  it("withTimeout resolves with the operation's value when it beats the timeout", async () => {
    const result = await ResilienceUtils.withTimeout(async () => "fast", 1000);
    expect(result).toBe("fast");
  });

  it("withTimeout rejects with EXTERNAL_SERVICE_TIMEOUT when the timeout wins", async () => {
    let settle: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      settle = resolve;
    });
    await expect(
      ResilienceUtils.withTimeout(() => slow, 20),
    ).rejects.toMatchObject({ data: { code: "EXTERNAL_SERVICE_TIMEOUT" } });
    settle("late"); // let the abandoned operation finish; result is ignored
  });

  it("withTimeout propagates the operation's own error when it fails before the timeout", async () => {
    await expect(
      ResilienceUtils.withTimeout(async () => {
        throw new Error("boom");
      }, 1000),
    ).rejects.toThrow("boom");
  });

  it("withBulkhead releases the permit even when the operation fails", async () => {
    const semaphore = new Semaphore(1);
    await expect(
      ResilienceUtils.withBulkhead(async () => {
        throw new Error("task failed");
      }, semaphore),
    ).rejects.toThrow("task failed");
    // The permit was returned: a follow-up acquire succeeds immediately.
    await expect(semaphore.acquire()).resolves.toBeUndefined();
  });
});

describe("Semaphore", () => {
  it("queues excess acquires and hands permits over FIFO on release", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire(); // takes the only permit

    const order: number[] = [];
    const first = semaphore.acquire().then(() => order.push(1));
    const second = semaphore.acquire().then(() => order.push(2));

    semaphore.release(); // hands the permit to the first waiter
    semaphore.release(); // then to the second
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it("leaves a queued acquire pending until a release hands it a permit", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    let done = false;
    const queued = semaphore.acquire().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false); // no permit available yet
    semaphore.release();
    await queued;
    expect(done).toBe(true);
  });

  it("inflates the permit total when released more times than acquired", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    semaphore.release(); // balanced
    semaphore.release(); // extra release — no upper-bound check
    await semaphore.acquire();
    await semaphore.acquire(); // both succeed because the count is now 2
  });
});

describe("module-level singletons", () => {
  it("exposes four named service breakers in a healthy initial state", () => {
    const health = ResilienceUtils.getSystemHealth();
    expect(Object.keys(health).sort()).toEqual([
      "assemblyai",
      "getstream",
      "whisper",
      "workos",
    ]);
    for (const status of Object.values(health)) {
      expect(status.state).toBe("closed");
      expect(status.failureCount).toBe(0);
    }
  });

  it("caps the videoOperations semaphore at 10 concurrent holders", async () => {
    const semaphore = Semaphores.videoOperations;
    for (let i = 0; i < 10; i++) {
      await semaphore.acquire();
    }
    let eleventhDone = false;
    const eleventh = semaphore.acquire().then(() => {
      eleventhDone = true;
    });
    await Promise.resolve();
    expect(eleventhDone).toBe(false); // the 11th holder must wait
    semaphore.release(); // hand the permit to the 11th
    await eleventh;
    expect(eleventhDone).toBe(true);
    // Restore the shared singleton: release the 10 permits this test holds.
    for (let i = 0; i < 10; i++) {
      semaphore.release();
    }
  });
});

describe("runnable examples", () => {
  it("executes all resilience examples with their assertions passing", async () => {
    const { runExamples } = await import("./examples/resilience.examples");
    const results = await runExamples();
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.length).toBeLessThanOrEqual(6);
    for (const result of results) {
      expect(result.name).toEqual(expect.stringMatching(/^\d/));
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });
});
