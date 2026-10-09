/**
 * Resilience and Retry Management System
 *
 * This module provides circuit breakers, retry policies, and backoff strategies
 * for handling transient failures in external service integrations.
 *
 * Requirements: 6.5, 19.3
 * Compliance: steering/convex_rules.mdc - Uses proper error handling patterns
 */

import { ActionCtx, MutationCtx } from "@convex/_generated/server";
import { createError } from "@convex/lib/errors";

/**
 * Retry policy configuration for `withRetry`.
 *
 * Fields:
 * - `maxAttempts`: Total attempts including the first. `1` disables retrying;
 *   `0` or a negative value is degenerate — the operation never runs and a
 *   generic `Error("Max retry attempts exceeded")` is thrown.
 * - `baseDelayMs`: Backoff portion of the delay before the second attempt.
 * - `maxDelayMs`: Upper bound applied to the backoff portion of each delay
 *   (jitter is added afterwards and is not capped).
 * - `backoffMultiplier`: Growth factor; before retry N (1-based) the code
 *   waits `min(baseDelayMs * backoffMultiplier ** (N - 1), maxDelayMs)`.
 * - `jitterMs`: Optional. Adds `Math.random() * jitterMs` to every delay,
 *   making timing non-deterministic (not seeded).
 * - `retryableErrors`: Optional allowlist of substrings. When non-empty, an
 *   error is retried only if `error.message` or `error.name` contains at
 *   least one entry (case-sensitive substring match). When omitted or empty,
 *   every error is treated as retryable.
 */
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs?: number;
  retryableErrors?: string[];
}

/**
 * Circuit breaker configuration for the `CircuitBreaker` class.
 *
 * Fields:
 * - `failureThreshold`: Failure RATE (a fraction in [0, 1], not a count) at
 *   which the breaker opens, computed as `failureCount / requestCount` over
 *   the current monitoring window. `0.5` means "open at 50% failures".
 * - `recoveryTimeoutMs`: How long an open circuit refuses calls before it
 *   allows a half-open probe.
 * - `monitoringWindowMs`: Age at which the failure/success/request counters
 *   lazily reset to zero (checked after each recorded outcome).
 * - `minimumThroughput`: Minimum requests in the current window before the
 *   breaker may open; below this the circuit stays closed regardless of
 *   failure rate, protecting low-traffic services from a single blip.
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeoutMs: number;
  monitoringWindowMs: number;
  minimumThroughput: number;
}

/**
 * Circuit breaker lifecycle states.
 *
 * - `closed`: normal operation; every call runs.
 * - `open`: tripped; `execute` fails fast with a
 *   `createError.externalServiceTimeout` ConvexError until
 *   `recoveryTimeoutMs` has elapsed since the trip.
 * - `half-open`: recovery deadline passed; calls run as probes — one success
 *   closes the circuit, any failure reopens it.
 */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/**
 * Point-in-time snapshot of a `CircuitBreaker`'s observable state, returned
 * by `CircuitBreaker.getStatus`.
 *
 * - `state`: current lifecycle state.
 * - `failureCount`: failures recorded in the current monitoring window
 *   (reset when the window rolls over).
 * - `lastFailureTime`: `Date.now()` timestamp of the most recent failure;
 *   undefined before the first failure.
 * - `nextRetryTime`: earliest `Date.now()` value at which an open circuit
 *   transitions to half-open; set when the circuit opens and cleared only by
 *   a successful half-open probe.
 */
export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime?: number;
  nextRetryTime?: number;
}

/**
 * Runs an async operation up to `policy.maxAttempts` times, retrying failures
 * with exponential backoff and jitter.
 *
 * On each failure the error is checked against `policy.retryableErrors`
 * (case-sensitive substring match on `error.message` or `error.name`; every
 * error is retryable when the list is omitted or empty). Non-retryable errors
 * are rethrown immediately without further attempts. The delay before retry N
 * is `min(baseDelayMs * backoffMultiplier ** (N - 1), maxDelayMs)` plus
 * `Math.random() * jitterMs`, waited out on a real `setTimeout`. The final
 * attempt does not sleep; its error propagates when the loop ends. With
 * `maxAttempts <= 0` the operation never runs and a generic
 * `Error("Max retry attempts exceeded")` is thrown instead.
 *
 * Side effects: logs `Retry attempt N/M ...` via `console.log` before each
 * retry delay; consumes wall-clock time on real timers; never touches the
 * Convex `ctx`. The thrown error is the last error verbatim — for a
 * `ConvexError` carrying an object payload, `.message` is the JSON-serialized
 * payload, so `retryableErrors` matching runs over that JSON text (e.g. a
 * 504 payload matches the substring `"504"` but not the word `timeout`).
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (policy.retryableErrors && policy.retryableErrors.length > 0) {
        const isRetryable = policy.retryableErrors.some(
          (retryableError) =>
            lastError?.message.includes(retryableError) ||
            lastError?.name.includes(retryableError),
        );

        if (!isRetryable) {
          throw lastError;
        }
      }

      // Don't delay on the last attempt
      if (attempt === policy.maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
        policy.maxDelayMs,
      );

      const jitter = policy.jitterMs ? Math.random() * policy.jitterMs : 0;
      const delay = baseDelay + jitter;

      console.log(
        `Retry attempt ${attempt}/${policy.maxAttempts} after ${delay}ms delay`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Max retry attempts exceeded");
}

/**
 * Circuit breaker guarding calls to a fallible service behind a
 * closed/open/half-open state machine.
 *
 * `execute` runs the operation and records the outcome:
 * - `closed`: every call runs. The circuit opens once the current window has
 *   at least `minimumThroughput` requests AND a failure rate of at least
 *   `failureThreshold` (see `onFailure` / `shouldOpenCircuit`).
 * - `open`: calls fail fast — `execute` throws a
 *   `createError.externalServiceTimeout` ConvexError (code
 *   `EXTERNAL_SERVICE_TIMEOUT`, status 504) WITHOUT invoking the operation —
 *   until `recoveryTimeoutMs` has passed since the trip; state then becomes
 *   `half-open` and the call proceeds as a probe. Concurrent `execute` calls
 *   can all probe: there is no single-probe lock on half-open state.
 * - `half-open`: a success closes the circuit and clears the failure and
 *   retry timestamps; a failure reopens it for another `recoveryTimeoutMs`.
 *
 * Counters (failures/successes/requests) reset lazily once the window is
 * older than `monitoringWindowMs`; the reset runs after an outcome is
 * recorded, so the outcome that trips (or avoids) a trip can be wiped by the
 * same window roll it triggers.
 *
 * All state is per-instance, in-memory, and never shared across processes.
 * In Convex each function invocation runs in its own isolate, so breaker
 * state does not survive between invocations — it smooths failures within a
 * single invocation but is not a deployment-wide breaker.
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private lastFailureTime?: number;
  private nextRetryTime?: number;
  private successCount = 0;
  private requestCount = 0;
  private windowStartTime = Date.now();

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Runs `operation` under the breaker. Fails fast while the circuit is open
   * by throwing the `EXTERNAL_SERVICE_TIMEOUT` ConvexError WITHOUT invoking
   * `operation`; transitions open→half-open once the recovery deadline has
   * passed, then invokes and records the outcome (success closes the
   * circuit, failure reopens it). Resolves with the operation's value or
   * rejects with the operation's own error verbatim on the failure path.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === "open") {
      if (Date.now() < (this.nextRetryTime || 0)) {
        throw createError.externalServiceTimeout(
          "Circuit breaker",
          this.config.recoveryTimeoutMs,
        );
      }

      // Transition to half-open
      this.state = "half-open";
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.successCount++;
    this.requestCount++;

    if (this.state === "half-open") {
      // Successful call in half-open state, close the circuit
      this.state = "closed";
      this.failureCount = 0;
      this.lastFailureTime = undefined;
      this.nextRetryTime = undefined;
    }

    this.resetWindowIfNeeded();
  }

  private onFailure(): void {
    this.failureCount++;
    this.requestCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // Failure in half-open state, open the circuit again
      this.openCircuit();
    } else if (this.shouldOpenCircuit()) {
      this.openCircuit();
    }

    this.resetWindowIfNeeded();
  }

  private shouldOpenCircuit(): boolean {
    // Check if we have minimum throughput
    if (this.requestCount < this.config.minimumThroughput) {
      return false;
    }

    // Check failure rate
    const failureRate = this.failureCount / this.requestCount;
    return failureRate >= this.config.failureThreshold;
  }

  private openCircuit(): void {
    this.state = "open";
    this.nextRetryTime = Date.now() + this.config.recoveryTimeoutMs;
  }

  private resetWindowIfNeeded(): void {
    const now = Date.now();
    if (now - this.windowStartTime >= this.config.monitoringWindowMs) {
      this.windowStartTime = now;
      this.failureCount = 0;
      this.successCount = 0;
      this.requestCount = 0;
    }
  }

  /**
   * Returns a read-only snapshot of the breaker's state, window failure
   * count, last failure time, and next retry time. Does not roll the
   * monitoring window or mutate anything.
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextRetryTime: this.nextRetryTime,
    };
  }
}

/**
 * Predefined retry policies for `withRetry`. Each property is a factory that
 * returns a FRESH policy object per call — mutating one result never affects
 * the next, and there is no shared state between calls.
 */
export const RetryPolicies = {
  /**
   * Conservative retry for critical operations: 3 attempts, 1s initial
   * delay, 2x backoff capped at 5s, up to 500ms jitter; retries every error.
   */
  conservative: (): RetryPolicy => ({
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterMs: 500,
  }),

  /**
   * Aggressive retry for non-critical operations: 5 attempts, 0.5s initial
   * delay, 1.5x backoff capped at 10s, up to 1s jitter; retries every error.
   */
  aggressive: (): RetryPolicy => ({
    maxAttempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 1.5,
    jitterMs: 1000,
  }),

  /**
   * Quick retry for real-time operations: 2 attempts, 100ms initial delay,
   * 2x backoff capped at 1s, up to 100ms jitter; retries every error.
   */
  realtime: (): RetryPolicy => ({
    maxAttempts: 2,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    jitterMs: 100,
  }),

  /**
   * External service retry: 4 attempts, 1s initial delay, 2x backoff capped
   * at 8s, 500ms jitter, and a `retryableErrors` allowlist of
   * transport-style failure markers (`timeout`, `ECONNRESET`, `ENOTFOUND`,
   * `ECONNREFUSED`, `500`-`504`) matched case-sensitively against
   * `error.message` / `error.name`. Note the numeric entries also match HTTP
   * status codes embedded in JSON-serialized ConvexError messages (e.g. a
   * breaker-open error carrying `"statusCode":504` matches `"504"`), while a
   * plain-text "timed out" message does NOT match "timeout".
   */
  externalService: (): RetryPolicy => ({
    maxAttempts: 4,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    backoffMultiplier: 2,
    jitterMs: 500,
    retryableErrors: [
      "timeout",
      "ECONNRESET",
      "ENOTFOUND",
      "ECONNREFUSED",
      "500",
      "502",
      "503",
      "504",
    ],
  }),
};

/**
 * Predefined circuit breaker configurations for `new CircuitBreaker(...)`.
 * Each property is a factory returning a fresh config object per call.
 * Remember `failureThreshold` is a failure RATE (0-1), not a request count.
 */
export const CircuitBreakerConfigs = {
  /**
   * Configuration for external API calls: opens at a 50% failure rate once
   * at least 5 requests ran in the last minute, recovers after 30s.
   */
  externalApi: (): CircuitBreakerConfig => ({
    failureThreshold: 0.5, // 50% failure rate
    recoveryTimeoutMs: 30000, // 30 seconds
    monitoringWindowMs: 60000, // 1 minute window
    minimumThroughput: 5, // Minimum 5 requests
  }),

  /**
   * Configuration for video service calls (used by the shared `getstream`
   * breaker): more sensitive — opens at a 30% failure rate once at least 3
   * requests ran in the last 2 minutes, recovers after 60s.
   */
  videoService: (): CircuitBreakerConfig => ({
    failureThreshold: 0.3, // 30% failure rate (more sensitive)
    recoveryTimeoutMs: 60000, // 1 minute
    monitoringWindowMs: 120000, // 2 minute window
    minimumThroughput: 3, // Minimum 3 requests
  }),

  /**
   * Configuration for transcription services: opens at a 40% failure rate
   * once at least 4 requests ran in the last 90s, recovers after 45s.
   */
  transcriptionService: (): CircuitBreakerConfig => ({
    failureThreshold: 0.4, // 40% failure rate
    recoveryTimeoutMs: 45000, // 45 seconds
    monitoringWindowMs: 90000, // 1.5 minute window
    minimumThroughput: 4, // Minimum 4 requests
  }),
};

/**
 * Named, module-level circuit breaker singletons for external services
 * (`getstream`, `whisper`, `assemblyai`, `workos`), instantiated once at
 * module load with the matching `CircuitBreakerConfigs` presets.
 *
 * All callers within one isolate share a single state machine per service —
 * but in Convex each function invocation can run in a fresh isolate, so this
 * state is per-isolate and resets between invocations: it smooths repeated
 * failures within one invocation yet is NOT a deployment-wide breaker.
 * Currently only `getstream` is consumed (convex/meetings/stream/index.ts);
 * the other three breakers are instantiated but unused.
 */
export const CircuitBreakers = {
  getstream: new CircuitBreaker(CircuitBreakerConfigs.videoService()),
  whisper: new CircuitBreaker(CircuitBreakerConfigs.transcriptionService()),
  assemblyai: new CircuitBreaker(CircuitBreakerConfigs.transcriptionService()),
  workos: new CircuitBreaker(CircuitBreakerConfigs.externalApi()),
};

/**
 * Utility functions composing the resilience primitives above (retry,
 * breaker, timeout, bulkhead) plus a system-health snapshotter. All are
 * pure orchestrators over their arguments — none touches the Convex `ctx`.
 */
export const ResilienceUtils = {
  /**
   * Composes retry INSIDE the breaker: `circuitBreaker.execute` wraps
   * `withRetry(operation, retryPolicy)`, so N retries count as ONE breaker
   * request — success after retries records a single success, and only
   * exhausting all retries records a single failure. This is the inverse of
   * the composition used in convex/meetings/stream/index.ts, where each
   * retry attempt passes through the breaker separately.
   */
  async withResiliency<T>(
    operation: () => Promise<T>,
    circuitBreaker: CircuitBreaker,
    retryPolicy: RetryPolicy,
  ): Promise<T> {
    return await circuitBreaker.execute(async () => {
      return await withRetry(operation, retryPolicy);
    });
  },

  /**
   * Races `operation` against a real `setTimeout` of `timeoutMs`. The loser
   * is never cancelled: when the timeout wins, the returned promise rejects
   * with a `createError.externalServiceTimeout` ConvexError while the
   * operation keeps running in the background (no AbortSignal); when the
   * operation settles first, the pending timer is cleared. The
   * `timeoutMessage` parameter is accepted but UNUSED — the error message
   * always comes from `createError` ("Operation request timed out ...").
   */
  async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage = "Operation timed out",
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(createError.externalServiceTimeout("Operation", timeoutMs));
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  },

  /**
   * Applies the bulkhead pattern for resource isolation: awaits
   * `semaphore.acquire()`, runs `operation`, and always calls
   * `semaphore.release()` in a `finally` — an operation failure still
   * releases the permit. Accepts a `Semaphore` instance or any object with a
   * compatible `{ acquire, release }` pair.
   */
  async withBulkhead<T>(
    operation: () => Promise<T>,
    semaphore: { acquire: () => Promise<void>; release: () => void },
  ): Promise<T> {
    await semaphore.acquire();
    try {
      return await operation();
    } finally {
      semaphore.release();
    }
  },

  /**
   * Returns a `getStatus()` snapshot for all four named breakers in
   * `CircuitBreakers` (getstream, whisper, assemblyai, workos), keyed by
   * service name. Read-only; reflects the current isolate's breaker state.
   */
  getSystemHealth() {
    return {
      getstream: CircuitBreakers.getstream.getStatus(),
      whisper: CircuitBreakers.whisper.getStatus(),
      assemblyai: CircuitBreakers.assemblyai.getStatus(),
      workos: CircuitBreakers.workos.getStatus(),
    };
  },
};

/**
 * Minimal counting semaphore for the bulkhead pattern (see
 * `ResilienceUtils.withBulkhead`): at most `permits` holders run
 * concurrently; excess `acquire()` calls queue FIFO and resolve in order as
 * `release()` hands permits over. No timeout, no cancellation, unbounded
 * wait queue — a holder that never releases starves every waiter. There is
 * also no upper-bound check, so extra `release()` calls inflate the permit
 * total above the constructor value.
 */
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Takes one permit: resolves immediately when one is available,
   * otherwise queues FIFO until a `release()` hands the caller a permit.
   * Never rejects.
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Frees one permit: hands it directly to the oldest waiter if any (the
   * waiter's `acquire` resolves; the available count is unchanged),
   * otherwise increments the available count. Calling it more times than
   * `acquire()` inflates the total permits beyond the constructor value.
   */
  release(): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

/**
 * Named, module-level semaphore singletons capping concurrent resource use:
 * `videoOperations` (10 permits), `transcriptionOperations` (5), and
 * `externalApiCalls` (20). Like `CircuitBreakers`, these are per-isolate —
 * state lives only for the lifetime of one Convex function invocation's
 * isolate, so they do not throttle across invocations or deployments. No
 * module outside this one currently uses them.
 */
export const Semaphores = {
  videoOperations: new Semaphore(10), // Max 10 concurrent video operations
  transcriptionOperations: new Semaphore(5), // Max 5 concurrent transcription operations
  externalApiCalls: new Semaphore(20), // Max 20 concurrent external API calls
};