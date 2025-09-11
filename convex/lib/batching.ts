/**
 * Advanced Batching and Coalescing System for High-Frequency Operations
 *
 * This module provides server-side batching with configurable windows and sizes,
 * client-side debouncing, and bandwidth management for real-time subscriptions.
 *
 * Requirements: 5.3, 4.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

/**
 * Configuration for different operation types
 */
export const BATCH_CONFIGS = {
  transcripts: {
    maxBatchSize: 20,
    maxWaitMs: 100,
    coalescingWindow: 100,
  },
  noteOps: {
    maxBatchSize: 10,
    maxWaitMs: 250,
    coalescingWindow: 250,
  },
  meetingState: {
    maxBatchSize: 1,
    maxWaitMs: 500,
    coalescingWindow: 500,
  },
  presenceUpdates: {
    maxBatchSize: 5,
    maxWaitMs: 1000,
    coalescingWindow: 1000,
  },
} as const;

/**
 * Batch processor for high-frequency operations
 */
export class BatchProcessor<T> {
  protected batch: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly maxBatchSize: number;
  private readonly maxWaitMs: number;
  private readonly processor: (items: T[]) => Promise<void>;
  private readonly onError?: (error: Error, items: T[]) => void;
  private processing = false;

  constructor(
    maxBatchSize: number,
    maxWaitMs: number,
    processor: (items: T[]) => Promise<void>,
    onError?: (error: Error, items: T[]) => void,
  ) {
    this.maxBatchSize = maxBatchSize;
    this.maxWaitMs = maxWaitMs;
    this.processor = processor;
    this.onError = onError;
  }

  async add(item: T): Promise<void> {
    // Don't add items while processing to avoid race conditions
    if (this.processing) {
      // Queue for next batch
      setTimeout(() => this.add(item), 10);
      return;
    }

    this.batch.push(item);

    if (this.batch.length >= this.maxBatchSize) {
      await this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
    }
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.batch.length === 0) return;

    const items = [...this.batch];
    this.batch = [];
    this.processing = true;

    try {
      await this.processor(items);
    } catch (error) {
      console.error("Batch processing failed:", error);
      if (this.onError) {
        this.onError(error as Error, items);
      } else {
        // Re-queue items for retry with exponential backoff
        setTimeout(
          () => {
            items.forEach((item) => this.add(item));
          },
          Math.min(1000 * Math.pow(2, items.length), 10000),
        );
      }
    } finally {
      this.processing = false;
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }

  getQueueSize(): number {
    return this.batch.length;
  }
}

/**
 * Coalescing strategy for different operation types
 */
export interface CoalescingStrategy<T> {
  shouldCoalesce: (existing: T, incoming: T) => boolean;
  coalesce: (existing: T, incoming: T) => T;
}

/**
 * Transcript coalescing - merge consecutive chunks from same speaker
 */
export const transcriptCoalescing: CoalescingStrategy<{
  meetingId: Id<"meetings">;
  speakerId?: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}> = {
  shouldCoalesce: (existing, incoming) =>
    existing.meetingId === incoming.meetingId &&
    existing.speakerId === incoming.speakerId &&
    Math.abs(existing.endMs - incoming.startMs) < 1000, // Within 1 second

  coalesce: (existing, incoming) => ({
    ...existing,
    text: existing.text + " " + incoming.text,
    endMs: incoming.endMs,
    confidence: (existing.confidence + incoming.confidence) / 2,
  }),
};

/**
 * Note operations coalescing - merge consecutive operations from same author
 */
export const noteOpsCoalescing: CoalescingStrategy<{
  meetingId: Id<"meetings">;
  authorId: Id<"users">;
  operation: {
    type: "insert" | "delete" | "retain";
    position: number;
    content?: string;
    length?: number;
  };
  timestamp: number;
}> = {
  shouldCoalesce: (existing, incoming) =>
    existing.meetingId === incoming.meetingId &&
    existing.authorId === incoming.authorId &&
    existing.operation.type === incoming.operation.type &&
    Math.abs(existing.timestamp - incoming.timestamp) < 250, // Within 250ms

  coalesce: (existing, incoming) => {
    if (
      existing.operation.type === "insert" &&
      incoming.operation.type === "insert"
    ) {
      // Merge consecutive inserts
      return {
        ...existing,
        operation: {
          ...existing.operation,
          content:
            (existing.operation.content || "") +
            (incoming.operation.content || ""),
        },
        timestamp: incoming.timestamp,
      };
    }
    // For other operations, take the latest
    return incoming;
  },
};

/**
 * Presence updates coalescing - latest state wins
 */
export const presenceCoalescing: CoalescingStrategy<{
  userId: Id<"users">;
  meetingId: Id<"meetings">;
  presence: "joined" | "left";
  timestamp: number;
}> = {
  shouldCoalesce: (existing, incoming) =>
    existing.userId === incoming.userId &&
    existing.meetingId === incoming.meetingId,

  coalesce: (existing, incoming) => incoming, // Latest state wins
};

/**
 * Coalescing batch processor that merges similar operations
 */
export class CoalescingBatchProcessor<T> extends BatchProcessor<T> {
  private readonly strategy: CoalescingStrategy<T>;

  constructor(
    maxBatchSize: number,
    maxWaitMs: number,
    processor: (items: T[]) => Promise<void>,
    strategy: CoalescingStrategy<T>,
    onError?: (error: Error, items: T[]) => void,
  ) {
    super(maxBatchSize, maxWaitMs, processor, onError);
    this.strategy = strategy;
  }

  async add(item: T): Promise<void> {
    // Try to coalesce with existing items
    const existingIndex = this.batch.findIndex((existing) =>
      this.strategy.shouldCoalesce(existing, item),
    );

    if (existingIndex >= 0) {
      // Coalesce with existing item
      this.batch[existingIndex] = this.strategy.coalesce(
        this.batch[existingIndex],
        item,
      );
    } else {
      // Add as new item
      await super.add(item);
    }
  }
}

/**
 * Bandwidth management for subscription updates
 */
export class BandwidthManager {
  private readonly subscriptions = new Map<
    string,
    {
      lastUpdate: number;
      updateCount: number;
      windowStart: number;
      priority: "critical" | "high" | "normal" | "low";
    }
  >();

  private readonly maxUpdatesPerSecond = 10;
  private readonly windowMs = 1000;

  canSendUpdate(
    subscriptionId: string,
    priority: "critical" | "high" | "normal" | "low" = "normal",
  ): boolean {
    const now = Date.now();
    const sub = this.subscriptions.get(subscriptionId);

    if (!sub) {
      // First update for this subscription
      this.subscriptions.set(subscriptionId, {
        lastUpdate: now,
        updateCount: 1,
        windowStart: now,
        priority,
      });
      return true;
    }

    // Reset window if needed
    if (now - sub.windowStart >= this.windowMs) {
      sub.windowStart = now;
      sub.updateCount = 0;
    }

    // Critical updates always go through
    if (priority === "critical") {
      sub.lastUpdate = now;
      sub.updateCount++;
      return true;
    }

    // Check rate limit
    if (sub.updateCount >= this.maxUpdatesPerSecond) {
      return false;
    }

    sub.lastUpdate = now;
    sub.updateCount++;
    sub.priority = priority;
    return true;
  }

  recordUpdate(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.lastUpdate = Date.now();
    }
  }

  cleanup(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [id, sub] of this.subscriptions.entries()) {
      if (now - sub.lastUpdate > staleThreshold) {
        this.subscriptions.delete(id);
      }
    }
  }

  getStats(): { activeSubscriptions: number; totalUpdates: number } {
    let totalUpdates = 0;
    for (const sub of this.subscriptions.values()) {
      totalUpdates += sub.updateCount;
    }

    return {
      activeSubscriptions: this.subscriptions.size,
      totalUpdates,
    };
  }
}

/**
 * Circuit breaker for overloaded clients
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  private readonly failureThreshold: number;
  private readonly recoveryTimeMs: number;

  constructor(failureThreshold = 5, recoveryTimeMs = 30000) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeMs = recoveryTimeMs;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.recoveryTimeMs) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open");
      }
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
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "open";
    }
  }

  getState(): "closed" | "open" | "half-open" {
    return this.state;
  }
}

/**
 * Client-side debouncing utilities
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  waitMs: number,
): T {
  let timeoutId: NodeJS.Timeout | null = null;

  return ((...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
    }, waitMs);
  }) as T;
}

/**
 * Throttle function to limit execution frequency
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limitMs: number,
): T {
  let lastExecution = 0;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastExecution >= limitMs) {
      lastExecution = now;
      return func(...args);
    }
  }) as T;
}

/**
 * Exponential backoff utility
 */
export function exponentialBackoff(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
}

/**
 * Global bandwidth manager instance
 */
export const globalBandwidthManager = new BandwidthManager();

// Cleanup stale subscriptions every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      globalBandwidthManager.cleanup();
    },
    5 * 60 * 1000,
  );
}
