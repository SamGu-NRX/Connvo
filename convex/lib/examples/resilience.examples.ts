/**
 * Runnable examples for the resilience module (convex/lib/resilience.ts).
 *
 * Each numbered example demonstrates one typical use of the module's main
 * exports and internally asserts what it demonstrates (throwing on an unmet
 * expectation). Everything here is deterministic and hermetic: no network,
 * no Convex deployment, no jitter randomness, and only millisecond-scale
 * real timers.
 *
 * Run directly with:  npx tsx convex/lib/examples/resilience.examples.ts
 * Or under vitest:    covered by convex/lib/resilience.test.ts, which
 *                     executes runExamples() as part of the suite.
 */

import {
  CircuitBreaker,
  CircuitBreakerConfigs,
  RetryPolicies,
  Semaphore,
  withRetry,
} from "../resilience";

/** One executed example: a short name plus a one-sentence lesson. */
export interface ExampleResult {
  name: string;
  detail: string;
}

/** Throws with a descriptive message when an example's expectation fails. */
function expectThat(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Example assertion failed: ${message}`);
  }
}

/**
 * Waits for `ms` milliseconds on a real timer. Only used with tiny values so
 * examples stay fast and hermetic.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Example 1: run a fallible call under `withRetry` — a transient failure is
 * retried and the final success is returned transparently.
 */
async function example1RetryThenSucceed(): Promise<ExampleResult> {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient network blip");
      return "payload";
    },
    // Tiny delays keep the example instant; real callers use the presets.
    {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
      backoffMultiplier: 2,
      jitterMs: 0,
    },
  );
  expectThat(result === "payload", "withRetry should return the final value");
  expectThat(calls === 3, "the operation should have run exactly 3 times");
  return {
    name: "1. withRetry retries transient failures",
    detail:
      "withRetry re-runs a failing async operation until it succeeds or attempts are exhausted, sleeping with exponential backoff between tries.",
  };
}

/**
 * Example 2: mark an error as permanent — `retryableErrors` stops retries
 * after the first attempt because the message matches no allowlisted entry.
 */
async function example2NonRetryable(): Promise<ExampleResult> {
  let calls = 0;
  try {
    await withRetry(
      async () => {
        calls++;
        throw new Error("validation rejected the payload");
      },
      RetryPolicies.externalService(),
    );
  } catch {
    // Expected: the error propagates after a single attempt.
  }
  expectThat(calls === 1, "a non-retryable error must not be retried");
  return {
    name: "2. retryableErrors short-circuits permanent failures",
    detail:
      "When the error message matches none of policy.retryableErrors, withRetry rethrows immediately instead of burning attempts.",
  };
}

/**
 * Example 3: a circuit breaker trips open after repeated failures, then
 * fails fast WITHOUT running the operation, and recovers through a
 * half-open probe once the recovery timeout passes.
 */
async function example3BreakerLifecycle(): Promise<ExampleResult> {
  const breaker = new CircuitBreaker({
    failureThreshold: 0.5,
    recoveryTimeoutMs: 20, // tiny so the example is instant
    monitoringWindowMs: 60000,
    minimumThroughput: 2,
  });
  for (let i = 0; i < 2; i++) {
    await breaker.execute(async () => {
      throw new Error("service down");
    }).catch(() => {}); // record the failures; errors are expected here
  }
  expectThat(
    breaker.getStatus().state === "open",
    "two consecutive failures should open the breaker",
  );

  let ranWhileOpen = false;
  try {
    await breaker.execute(async () => {
      ranWhileOpen = true;
      return "nope";
    });
  } catch (error) {
    expectThat(
      (error as { data?: { code?: string } }).data?.code ===
        "EXTERNAL_SERVICE_TIMEOUT",
      "an open breaker must fail fast with EXTERNAL_SERVICE_TIMEOUT",
    );
  }
  expectThat(!ranWhileOpen, "the operation must not run while open");

  await sleep(25); // past recoveryTimeoutMs: next execute becomes a probe
  const recovered = await breaker.execute(async () => "back online");
  expectThat(
    recovered === "back online" && breaker.getStatus().state === "closed",
    "a successful half-open probe should close the breaker",
  );
  return {
    name: "3. CircuitBreaker trips open, fails fast, then recovers",
    detail:
      "After tripping, execute() throws EXTERNAL_SERVICE_TIMEOUT without invoking the operation until the recovery timeout elapses; one successful half-open probe closes the circuit again.",
  };
}

/**
 * Example 4: compose retry and breaker by hand the way
 * convex/meetings/stream/index.ts does — each retry attempt passes through
 * the breaker separately.
 */
async function example4StreamStyleComposition(): Promise<ExampleResult> {
  const breaker = new CircuitBreaker(CircuitBreakerConfigs.videoService());
  let calls = 0;
  try {
    await withRetry(
      async () => {
        calls++;
        return breaker.execute(async () => {
          throw new Error("getstream 503");
        });
      },
      { ...RetryPolicies.externalService(), jitterMs: 0, baseDelayMs: 1, maxDelayMs: 2 },
    );
  } catch {
    // Exhausted retries — expected for this demonstration.
  }
  expectThat(calls === 4, "externalService policy makes 4 attempts");
  expectThat(
    breaker.getStatus().failureCount === 3,
    "the first three attempts each record a breaker failure; the fourth fails fast on the now-open breaker without recording one",
  );
  return {
    name: "4. stream-style composition: retry OUTSIDE the breaker",
    detail:
      "Wrapping withRetry around breaker.execute counts every attempt as its own breaker request — four failed retries put four failures on the breaker, unlike ResilienceUtils.withResiliency which records one.",
  };
}

/**
 * Example 5: preset factories return fresh config objects each call, with
 * the documented values.
 */
async function example5Presets(): Promise<ExampleResult> {
  const policy = RetryPolicies.externalService();
  const config = CircuitBreakerConfigs.transcriptionService();
  expectThat(policy.maxAttempts === 4, "externalService retries 4 times");
  expectThat(
    Array.isArray(policy.retryableErrors) &&
      policy.retryableErrors.includes("ECONNRESET"),
    "externalService allowlists transport-style errors",
  );
  expectThat(
    config.failureThreshold === 0.4 && config.minimumThroughput === 4,
    "transcriptionService opens at a 40% failure rate after 4 requests",
  );
  policy.maxAttempts = 99; // fresh objects are safe to mutate
  expectThat(
    RetryPolicies.externalService().maxAttempts === 4,
    "each factory call returns an independent object",
  );
  return {
    name: "5. Presets are factories, not shared instances",
    detail:
      "RetryPolicies and CircuitBreakerConfigs return a brand-new object per call, so tweaking one result never leaks into the next call.",
  };
}

/**
 * Example 6: a Semaphore caps concurrency — the third acquirer of a
 * 2-permit semaphore waits until a holder releases.
 */
async function example6Semaphore(): Promise<ExampleResult> {
  const semaphore = new Semaphore(2);
  await semaphore.acquire();
  await semaphore.acquire(); // both immediate — 2 permits available
  let thirdAcquired = false;
  const third = semaphore.acquire().then(() => {
    thirdAcquired = true;
  });
  await Promise.resolve();
  expectThat(!thirdAcquired, "the third acquire must wait for a permit");
  semaphore.release(); // hands the permit straight to the queued third
  await third;
  expectThat(thirdAcquired, "release hands the permit to the FIFO waiter");
  semaphore.release();
  semaphore.release(); // restore the semaphore to its initial state
  return {
    name: "6. Semaphore caps concurrent holders",
    detail:
      "acquire() resolves immediately while permits remain and otherwise queues FIFO; release() hands the permit to the oldest waiter or increments the count.",
  };
}

/**
 * Runs all resilience examples in order and returns what each one
 * demonstrated. Throws on the first unmet expectation.
 */
export async function runExamples(): Promise<ExampleResult[]> {
  return [
    await example1RetryThenSucceed(),
    await example2NonRetryable(),
    await example3BreakerLifecycle(),
    await example4StreamStyleComposition(),
    await example5Presets(),
    await example6Semaphore(),
  ];
}

// When executed directly with tsx, run the examples and print the lessons.
if (typeof process !== "undefined" && process.argv?.[1]?.includes("examples")) {
  runExamples().then((results) => {
    for (const result of results) {
      console.log(`${result.name}: ${result.detail}`);
    }
  });
}
