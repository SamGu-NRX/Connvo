/**
 * Client-Side Optimization Utilities for Real-Time Applications
 *
 * This module provides client-side debouncing, throttling, optimistic updates,
 * and exponential backoff for high-performance real-time interactions.
 *
 * Requirements: 5.3, 4.2
 * Compliance: steering/convex_rules.mdc - Client-side utilities
 */

/**
 * Optimistic update manager for real-time operations
 */
export class OptimisticUpdateManager<T> {
  private pendingUpdates = new Map<
    string,
    {
      optimisticState: T;
      originalState: T;
      timestamp: number;
      retryCount: number;
    }
  >();

  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(maxRetries = 3, timeoutMs = 5000) {
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Apply optimistic update and track for rollback
   */
  applyOptimistic(updateId: string, currentState: T, optimisticState: T): T {
    this.pendingUpdates.set(updateId, {
      optimisticState,
      originalState: currentState,
      timestamp: Date.now(),
      retryCount: 0,
    });

    // Auto-cleanup after timeout
    setTimeout(() => {
      if (this.pendingUpdates.has(updateId)) {
        console.warn(`Optimistic update ${updateId} timed out, rolling back`);
        this.rollback(updateId);
      }
    }, this.timeoutMs);

    return optimisticState;
  }

  /**
   * Confirm optimistic update was successful
   */
  confirm(updateId: string): void {
    this.pendingUpdates.delete(updateId);
  }

  /**
   * Rollback optimistic update on failure
   */
  rollback(updateId: string): T | null {
    const pending = this.pendingUpdates.get(updateId);
    if (pending) {
      this.pendingUpdates.delete(updateId);
      return pending.originalState;
    }
    return null;
  }

  /**
   * Retry failed optimistic update
   */
  retry(updateId: string): boolean {
    const pending = this.pendingUpdates.get(updateId);
    if (pending && pending.retryCount < this.maxRetries) {
      pending.retryCount++;
      pending.timestamp = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get all pending updates
   */
  getPendingUpdates(): Array<{ id: string; state: T; age: number }> {
    const now = Date.now();
    return Array.from(this.pendingUpdates.entries()).map(([id, update]) => ({
      id,
      state: update.optimisticState,
      age: now - update.timestamp,
    }));
  }

  /**
   * Clear all pending updates
   */
  clear(): void {
    this.pendingUpdates.clear();
  }
}

/**
 * Debounced function executor with configurable strategies
 */
export class DebouncedExecutor<T extends (...args: any[]) => any> {
  private timeoutId: NodeJS.Timeout | null = null;
  private lastArgs: Parameters<T> | null = null;
  private readonly func: T;
  private readonly waitMs: number;
  private readonly strategy: "leading" | "trailing" | "both";

  constructor(
    func: T,
    waitMs: number,
    strategy: "leading" | "trailing" | "both" = "trailing",
  ) {
    this.func = func;
    this.waitMs = waitMs;
    this.strategy = strategy;
  }

  execute(...args: Parameters<T>): void {
    this.lastArgs = args;

    // Leading edge execution
    if (this.strategy === "leading" || this.strategy === "both") {
      if (!this.timeoutId) {
        this.func(...args);
      }
    }

    // Clear existing timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    // Trailing edge execution
    if (this.strategy === "trailing" || this.strategy === "both") {
      this.timeoutId = setTimeout(() => {
        if (this.lastArgs) {
          this.func(...this.lastArgs);
        }
        this.timeoutId = null;
        this.lastArgs = null;
      }, this.waitMs);
    } else {
      // For leading-only, just reset the timeout
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null;
        this.lastArgs = null;
      }, this.waitMs);
    }
  }

  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
      this.lastArgs = null;
    }
  }

  flush(): void {
    if (this.timeoutId && this.lastArgs) {
      clearTimeout(this.timeoutId);
      this.func(...this.lastArgs);
      this.timeoutId = null;
      this.lastArgs = null;
    }
  }
}

/**
 * Throttled function executor with burst handling
 */
export class ThrottledExecutor<T extends (...args: any[]) => any> {
  private lastExecution = 0;
  private timeoutId: NodeJS.Timeout | null = null;
  private lastArgs: Parameters<T> | null = null;
  private readonly func: T;
  private readonly limitMs: number;
  private readonly trailing: boolean;

  constructor(func: T, limitMs: number, trailing = true) {
    this.func = func;
    this.limitMs = limitMs;
    this.trailing = trailing;
  }

  execute(...args: Parameters<T>): void {
    const now = Date.now();
    this.lastArgs = args;

    if (now - this.lastExecution >= this.limitMs) {
      // Execute immediately
      this.lastExecution = now;
      this.func(...args);

      // Clear any pending trailing execution
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
    } else if (this.trailing) {
      // Schedule trailing execution
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
      }

      const remainingTime = this.limitMs - (now - this.lastExecution);
      this.timeoutId = setTimeout(() => {
        if (this.lastArgs) {
          this.lastExecution = Date.now();
          this.func(...this.lastArgs);
        }
        this.timeoutId = null;
      }, remainingTime);
    }
  }

  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.lastArgs = null;
  }
}

/**
 * Exponential backoff retry manager
 */
export class RetryManager {
  private attempts = new Map<
    string,
    {
      count: number;
      lastAttempt: number;
      nextDelay: number;
    }
  >();

  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly jitterFactor: number;

  constructor(
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    maxAttempts = 5,
    jitterFactor = 0.1,
  ) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxAttempts = maxAttempts;
    this.jitterFactor = jitterFactor;
  }

  /**
   * Check if operation should be retried
   */
  shouldRetry(operationId: string): boolean {
    const attempt = this.attempts.get(operationId);
    if (!attempt) return true;

    return (
      attempt.count < this.maxAttempts &&
      Date.now() >= attempt.lastAttempt + attempt.nextDelay
    );
  }

  /**
   * Get delay before next retry
   */
  getRetryDelay(operationId: string): number {
    const attempt = this.attempts.get(operationId);
    if (!attempt) return 0;

    const now = Date.now();
    const elapsed = now - attempt.lastAttempt;
    return Math.max(0, attempt.nextDelay - elapsed);
  }

  /**
   * Record retry attempt
   */
  recordAttempt(operationId: string): void {
    const existing = this.attempts.get(operationId);
    const count = existing ? existing.count + 1 : 1;

    // Calculate next delay with exponential backoff and jitter
    const baseDelay = Math.min(
      this.baseDelayMs * Math.pow(2, count - 1),
      this.maxDelayMs,
    );

    const jitter = baseDelay * this.jitterFactor * (Math.random() - 0.5);
    const nextDelay = Math.max(0, baseDelay + jitter);

    this.attempts.set(operationId, {
      count,
      lastAttempt: Date.now(),
      nextDelay,
    });
  }

  /**
   * Mark operation as successful
   */
  recordSuccess(operationId: string): void {
    this.attempts.delete(operationId);
  }

  /**
   * Reset retry state for operation
   */
  reset(operationId: string): void {
    this.attempts.delete(operationId);
  }

  /**
   * Get retry statistics
   */
  getStats(): {
    activeRetries: number;
    totalAttempts: number;
    avgAttempts: number;
  } {
    const attempts = Array.from(this.attempts.values());
    const totalAttempts = attempts.reduce((sum, a) => sum + a.count, 0);

    return {
      activeRetries: attempts.length,
      totalAttempts,
      avgAttempts: attempts.length > 0 ? totalAttempts / attempts.length : 0,
    };
  }

  /**
   * Cleanup old retry attempts
   */
  cleanup(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [id, attempt] of this.attempts.entries()) {
      if (now - attempt.lastAttempt > staleThreshold) {
        this.attempts.delete(id);
      }
    }
  }
}

/**
 * Batch operation collector for client-side batching
 */
export class BatchCollector<T> {
  private batch: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly maxBatchSize: number;
  private readonly maxWaitMs: number;
  private readonly processor: (items: T[]) => Promise<void>;

  constructor(
    maxBatchSize: number,
    maxWaitMs: number,
    processor: (items: T[]) => Promise<void>,
  ) {
    this.maxBatchSize = maxBatchSize;
    this.maxWaitMs = maxWaitMs;
    this.processor = processor;
  }

  add(item: T): void {
    this.batch.push(item);

    if (this.batch.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.batch.length === 0) return;

    const items = [...this.batch];
    this.batch = [];

    this.processor(items).catch((error) => {
      console.error("Batch processing failed:", error);
      // Re-add items to batch for retry
      this.batch.unshift(...items);
    });
  }

  getBatchSize(): number {
    return this.batch.length;
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.batch = [];
  }
}

/**
 * Connection state manager with automatic reconnection
 */
export class ConnectionManager {
  private state: "connected" | "connecting" | "disconnected" = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly maxReconnectAttempts: number;
  private readonly baseReconnectDelayMs: number;
  private readonly onStateChange?: (state: string) => void;

  constructor(
    maxReconnectAttempts = 10,
    baseReconnectDelayMs = 1000,
    onStateChange?: (state: string) => void,
  ) {
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.baseReconnectDelayMs = baseReconnectDelayMs;
    this.onStateChange = onStateChange;
  }

  setState(newState: "connected" | "connecting" | "disconnected"): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);

      if (newState === "connected") {
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      } else if (newState === "disconnected") {
        this.scheduleReconnect();
      }
    }
  }

  getState(): string {
    return this.state;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(
      this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      30000, // Max 30 seconds
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.setState("connecting");
      // Actual reconnection logic would be handled by the caller
    }, delay);
  }

  forceReconnect(): void {
    this.reconnectAttempts = 0;
    this.setState("connecting");
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.setState("disconnected");
  }
}

/**
 * Utility functions for common client-side optimizations
 */
export const ClientOptimizations = {
  /**
   * Create a debounced version of a function
   */
  debounce<T extends (...args: any[]) => any>(
    func: T,
    waitMs: number,
    strategy: "leading" | "trailing" | "both" = "trailing",
  ): DebouncedExecutor<T> {
    return new DebouncedExecutor(func, waitMs, strategy);
  },

  /**
   * Create a throttled version of a function
   */
  throttle<T extends (...args: any[]) => any>(
    func: T,
    limitMs: number,
    trailing = true,
  ): ThrottledExecutor<T> {
    return new ThrottledExecutor(func, limitMs, trailing);
  },

  /**
   * Create an optimistic update manager
   */
  createOptimisticManager<T>(
    maxRetries = 3,
    timeoutMs = 5000,
  ): OptimisticUpdateManager<T> {
    return new OptimisticUpdateManager<T>(maxRetries, timeoutMs);
  },

  /**
   * Create a retry manager with exponential backoff
   */
  createRetryManager(
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    maxAttempts = 5,
  ): RetryManager {
    return new RetryManager(baseDelayMs, maxDelayMs, maxAttempts);
  },

  /**
   * Create a batch collector for client-side batching
   */
  createBatchCollector<T>(
    maxBatchSize: number,
    maxWaitMs: number,
    processor: (items: T[]) => Promise<void>,
  ): BatchCollector<T> {
    return new BatchCollector(maxBatchSize, maxWaitMs, processor);
  },

  /**
   * Create a connection manager
   */
  createConnectionManager(
    maxReconnectAttempts = 10,
    baseReconnectDelayMs = 1000,
    onStateChange?: (state: string) => void,
  ): ConnectionManager {
    return new ConnectionManager(
      maxReconnectAttempts,
      baseReconnectDelayMs,
      onStateChange,
    );
  },
};
