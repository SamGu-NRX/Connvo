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
 * Retry policy configuration
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
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeoutMs: number;
  monitoringWindowMs: number;
  minimumThroughput: number;
}

/**
 * Circuit breaker states
 */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime?: number;
  nextRetryTime?: number;
}

/**
 * Retry with exponential backoff and jitter
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
 * Circuit breaker implementation
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
 * Predefined retry policies
 */
export const RetryPolicies = {
  /**
   * Conservative retry for critical operations
   */
  conservative: (): RetryPolicy => ({
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterMs: 500,
  }),

  /**
   * Aggressive retry for non-critical operations
   */
  aggressive: (): RetryPolicy => ({
    maxAttempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 1.5,
    jitterMs: 1000,
  }),

  /**
   * Quick retry for real-time operations
   */
  realtime: (): RetryPolicy => ({
    maxAttempts: 2,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    jitterMs: 100,
  }),

  /**
   * External service retry with common retryable errors
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
 * Predefined circuit breaker configurations
 */
export const CircuitBreakerConfigs = {
  /**
   * Configuration for external API calls
   */
  externalApi: (): CircuitBreakerConfig => ({
    failureThreshold: 0.5, // 50% failure rate
    recoveryTimeoutMs: 30000, // 30 seconds
    monitoringWindowMs: 60000, // 1 minute window
    minimumThroughput: 5, // Minimum 5 requests
  }),

  /**
   * Configuration for video service calls
   */
  videoService: (): CircuitBreakerConfig => ({
    failureThreshold: 0.3, // 30% failure rate (more sensitive)
    recoveryTimeoutMs: 60000, // 1 minute
    monitoringWindowMs: 120000, // 2 minute window
    minimumThroughput: 3, // Minimum 3 requests
  }),

  /**
   * Configuration for transcription services
   */
  transcriptionService: (): CircuitBreakerConfig => ({
    failureThreshold: 0.4, // 40% failure rate
    recoveryTimeoutMs: 45000, // 45 seconds
    monitoringWindowMs: 90000, // 1.5 minute window
    minimumThroughput: 4, // Minimum 4 requests
  }),
};

/**
 * Global circuit breakers for different services
 */
export const CircuitBreakers = {
  getstream: new CircuitBreaker(CircuitBreakerConfigs.videoService()),
  whisper: new CircuitBreaker(CircuitBreakerConfigs.transcriptionService()),
  assemblyai: new CircuitBreaker(CircuitBreakerConfigs.transcriptionService()),
  workos: new CircuitBreaker(CircuitBreakerConfigs.externalApi()),
};

/**
 * Utility functions for resilience patterns
 */
export const ResilienceUtils = {
  /**
   * Combines retry and circuit breaker patterns
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
   * Creates a timeout wrapper for operations
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
   * Implements bulkhead pattern for resource isolation
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
   * Gets health status of all circuit breakers
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
 * Simple semaphore implementation for bulkhead pattern
 */
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

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
 * Global semaphores for different resource types
 */
export const Semaphores = {
  videoOperations: new Semaphore(10), // Max 10 concurrent video operations
  transcriptionOperations: new Semaphore(5), // Max 5 concurrent transcription operations
  externalApiCalls: new Semaphore(20), // Max 20 concurrent external API calls
};