/**
 * Resilience and Fault Tolerance Utilities
 *
 * This module provides utilities for building resilient systems including
 * retry logic, circuit breakers, timeouts, and graceful degradation.
 *
 * Requirements: 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: (error: Error) => boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: (error: Error) => {
    // Don't retry on authentication or validation errors
    return (
      !error.message.includes("UNAUTHORIZED") &&
      !error.message.includes("FORBIDDEN") &&
      !error.message.includes("VALIDATION_ERROR")
    );
  },
};

/**
 * Executes a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on the last attempt or non-retryable errors
      if (
        attempt === config.maxAttempts ||
        (config.retryableErrors && !config.retryableErrors(lastError))
      ) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelayMs,
      );

      // Add jitter to prevent thundering herd
      const jitteredDelay = delay + Math.random() * delay * 0.1;

      console.warn(
        `Attempt ${attempt}/${config.maxAttempts} failed, retrying in ${jitteredDelay}ms:`,
        lastError.message,
      );

      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
    }
  }

  throw lastError!;
}

/**
 * Timeout wrapper for operations
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage = "Operation timed out",
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
    ),
  ]);
}

/**
 * Combines retry and timeout for robust operation execution
 */
export async function withRetryAndTimeout<T>(
  operation: () => Promise<T>,
  retryOptions: Partial<RetryOptions> = {},
  timeoutMs = 10000,
): Promise<T> {
  return withRetry(() => withTimeout(operation, timeoutMs), retryOptions);
}

/**
 * Bulkhead pattern implementation for resource isolation
 */
export class Bulkhead {
  private activeOperations = 0;
  private readonly maxConcurrent: number;
  private readonly queue: Array<{
    operation: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.activeOperations < this.maxConcurrent) {
        this.executeOperation(operation, resolve, reject);
      } else {
        this.queue.push({ operation, resolve, reject });
      }
    });
  }

  private async executeOperation<T>(
    operation: () => Promise<T>,
    resolve: (value: T) => void,
    reject: (error: any) => void,
  ): Promise<void> {
    this.activeOperations++;

    try {
      const result = await operation();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.activeOperations--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.activeOperations < this.maxConcurrent) {
      const { operation, resolve, reject } = this.queue.shift()!;
      this.executeOperation(operation, resolve, reject);
    }
  }

  getStats() {
    return {
      activeOperations: this.activeOperations,
      queueLength: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

/**
 * Graceful degradation helper
 */
export async function withFallback<T>(
  primaryOperation: () => Promise<T>,
  fallbackOperation: () => Promise<T>,
  shouldFallback: (error: Error) => boolean = () => true,
): Promise<T> {
  try {
    return await primaryOperation();
  } catch (error) {
    if (shouldFallback(error as Error)) {
      console.warn(
        "Primary operation failed, using fallback:",
        (error as Error).message,
      );
      return await fallbackOperation();
    }
    throw error;
  }
}

/**
 * Dead letter queue for failed operations
 */
export interface FailedOperation {
  id: string;
  operation: string;
  payload: any;
  error: string;
  attempts: number;
  lastAttemptAt: number;
  createdAt: number;
}

export class DeadLetterQueue {
  private failedOperations = new Map<string, FailedOperation>();

  add(operation: FailedOperation): void {
    this.failedOperations.set(operation.id, operation);
  }

  get(id: string): FailedOperation | undefined {
    return this.failedOperations.get(id);
  }

  getAll(): FailedOperation[] {
    return Array.from(this.failedOperations.values());
  }

  remove(id: string): boolean {
    return this.failedOperations.delete(id);
  }

  cleanup(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, operation] of this.failedOperations.entries()) {
      if (operation.createdAt < cutoff) {
        this.failedOperations.delete(id);
        removed++;
      }
    }

    return removed;
  }

  getStats() {
    return {
      totalFailed: this.failedOperations.size,
      oldestFailure: Math.min(
        ...Array.from(this.failedOperations.values()).map((op) => op.createdAt),
      ),
    };
  }
}

/**
 * Global instances for common use cases
 */
export const streamBulkhead = new Bulkhead(10); // Max 10 concurrent Stream operations
export const deadLetterQueue = new DeadLetterQueue();

/**
 * Health check with automatic recovery
 */
export interface HealthCheckResult {
  healthy: boolean;
  latency?: number;
  error?: string;
  timestamp: number;
}

export class HealthMonitor {
  private lastCheck: HealthCheckResult | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private checkFn: () => Promise<void>,
    private intervalMs: number = 30000,
  ) {}

  start(): void {
    this.performCheck();
    this.checkInterval = setInterval(
      () => this.performCheck(),
      this.intervalMs,
    );
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async performCheck(): Promise<void> {
    const startTime = Date.now();

    try {
      await withTimeout(this.checkFn, 5000);
      this.lastCheck = {
        healthy: true,
        latency: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.lastCheck = {
        healthy: false,
        latency: Date.now() - startTime,
        error: (error as Error).message,
        timestamp: Date.now(),
      };
    }
  }

  getStatus(): HealthCheckResult | null {
    return this.lastCheck;
  }

  isHealthy(): boolean {
    return this.lastCheck?.healthy ?? false;
  }
}
