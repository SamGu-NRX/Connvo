/**
 * Performance Monitoring and Tracing for Convex Functions
 *
 * This module provides comprehensive performance monitoring, tracing,
 * and SLO validation for real-time subscriptions and high-frequency operations.
 *
 * Requirements: 14.1, 14.2, 14.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

/**
 * Performance metrics collection
 */
export interface PerformanceMetrics {
  functionName: string;
  executionTimeMs: number;
  success: boolean;
  errorType?: string;
  userId?: Id<"users">;
  meetingId?: Id<"meetings">;
  resourceType?: string;
  metadata?: any;
  timestamp: number;
  traceId: string;
}

/**
 * SLO targets from requirements
 */
export const SLO_TARGETS = {
  queryP95Ms: 120,
  queryP99Ms: 250,
  websocketUpdateP95Ms: 150,
  maxUpdatesPerSecond: 10,
  authOverheadMs: 5,
} as const;

/**
 * Performance tracker for function execution
 */
export class PerformanceTracker {
  private static metrics: PerformanceMetrics[] = [];
  private static readonly maxMetrics = 10000; // Keep last 10k metrics in memory

  static startTrace(functionName: string): string {
    const traceId = `${functionName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return traceId;
  }

  static recordMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);

    // Keep only recent metrics to prevent memory leaks
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log performance issues immediately
    if (metric.executionTimeMs > SLO_TARGETS.queryP95Ms) {
      console.warn(
        `Performance SLO breach: ${metric.functionName} took ${metric.executionTimeMs}ms (target: ${SLO_TARGETS.queryP95Ms}ms)`,
        {
          traceId: metric.traceId,
          metadata: metric.metadata,
        },
      );
    }
  }

  static getMetrics(
    functionName?: string,
    since?: number,
    limit = 1000,
  ): PerformanceMetrics[] {
    let filtered = this.metrics;

    if (functionName) {
      filtered = filtered.filter((m) => m.functionName === functionName);
    }

    if (since) {
      filtered = filtered.filter((m) => m.timestamp >= since);
    }

    return filtered.slice(-limit);
  }

  static getAggregatedStats(
    functionName?: string,
    windowMs = 60000, // 1 minute window
  ): {
    count: number;
    successRate: number;
    p50: number;
    p95: number;
    p99: number;
    avgExecutionTime: number;
    sloBreaches: number;
  } {
    const since = Date.now() - windowMs;
    const metrics = this.getMetrics(functionName, since);

    if (metrics.length === 0) {
      return {
        count: 0,
        successRate: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        avgExecutionTime: 0,
        sloBreaches: 0,
      };
    }

    const executionTimes: number[] = metrics
      .map((m) => m.executionTimeMs)
      .sort((a: number, b: number) => a - b);
    const successCount = metrics.filter((m) => m.success).length;
    const sloBreaches = metrics.filter(
      (m) => m.executionTimeMs > SLO_TARGETS.queryP95Ms,
    ).length;

    return {
      count: metrics.length,
      successRate: successCount / metrics.length,
      p50: percentile(executionTimes, 0.5),
      p95: percentile(executionTimes, 0.95),
      p99: percentile(executionTimes, 0.99),
      avgExecutionTime:
        executionTimes.reduce((a: number, b: number) => a + b, 0) /
          executionTimes.length,
      sloBreaches,
    };
  }

  static clearMetrics(): void {
    this.metrics = [];
  }
}

/**
 * Function wrapper for automatic performance tracking
 */
export function withTrace<T extends (...args: any[]) => Promise<any>>(
  functionName: string,
  func: T,
): T {
  return (async (...args: Parameters<T>) => {
    const traceId = PerformanceTracker.startTrace(functionName);
    const startTime = Date.now();
    let success = true;
    let errorType: string | undefined;

    try {
      const result = await func(...args);
      return result;
    } catch (error) {
      success = false;
      errorType =
        error instanceof Error ? error.constructor.name : "UnknownError";
      throw error;
    } finally {
      const executionTimeMs = Date.now() - startTime;

      PerformanceTracker.recordMetric({
        functionName,
        executionTimeMs,
        success,
        errorType,
        timestamp: Date.now(),
        traceId,
        // Extract context from args if available
        userId: extractUserId(args),
        meetingId: extractMeetingId(args),
        resourceType: extractResourceType(args),
        metadata: {
          argsCount: args.length,
          hasContext: args[0] && typeof args[0] === "object" && "db" in args[0],
        },
      });
    }
  }) as T;
}

/**
 * WebSocket subscription performance tracker
 */
export class SubscriptionPerformanceTracker {
  private static subscriptions: Map<
    string,
    {
      establishedAt: number;
      updateCount: number;
      lastUpdate: number;
      totalLatency: number;
      errors: number;
    }
  > = new Map();

  static trackSubscriptionEstablished(subscriptionId: string): void {
    this.subscriptions.set(subscriptionId, {
      establishedAt: Date.now(),
      updateCount: 0,
      lastUpdate: Date.now(),
      totalLatency: 0,
      errors: 0,
    });
  }

  static trackUpdate(subscriptionId: string, latencyMs: number): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.updateCount++;
      sub.lastUpdate = Date.now();
      sub.totalLatency += latencyMs;

      // Check WebSocket SLO
      if (latencyMs > SLO_TARGETS.websocketUpdateP95Ms) {
        console.warn(
          `WebSocket SLO breach: ${subscriptionId} update took ${latencyMs}ms (target: ${SLO_TARGETS.websocketUpdateP95Ms}ms)`,
        );
      }
    }
  }

  static trackError(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.errors++;
    }
  }

  static getSubscriptionStats(subscriptionId: string) {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return null;

    const now = Date.now();
    const durationMs = now - sub.establishedAt;
    const avgLatency =
      sub.updateCount > 0 ? sub.totalLatency / sub.updateCount : 0;
    const updatesPerSecond = sub.updateCount / (durationMs / 1000);

    return {
      durationMs,
      updateCount: sub.updateCount,
      avgLatency,
      updatesPerSecond,
      errors: sub.errors,
      lastUpdate: sub.lastUpdate,
      sloCompliant:
        avgLatency <= SLO_TARGETS.websocketUpdateP95Ms &&
        updatesPerSecond <= SLO_TARGETS.maxUpdatesPerSecond,
    };
  }

  static cleanup(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [id, sub] of this.subscriptions.entries()) {
      if (now - sub.lastUpdate > staleThreshold) {
        this.subscriptions.delete(id);
      }
    }
  }

  static getAllStats(): Array<{ subscriptionId: string; stats: any }> {
    const results = [];
    for (const [id, _] of this.subscriptions.entries()) {
      const stats = this.getSubscriptionStats(id);
      if (stats) {
        results.push({ subscriptionId: id, stats });
      }
    }
    return results;
  }
}

/**
 * Circuit breaker with performance monitoring
 */
export class PerformanceCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private readonly name: string;

  private readonly failureThreshold: number;
  private readonly recoveryTimeMs: number;
  private readonly performanceThresholdMs: number;

  constructor(
    name: string,
    failureThreshold = 5,
    recoveryTimeMs = 30000,
    performanceThresholdMs: number = SLO_TARGETS.queryP95Ms,
  ) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeMs = recoveryTimeMs;
    this.performanceThresholdMs = performanceThresholdMs;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.recoveryTimeMs) {
        this.state = "half-open";
      } else {
        throw new Error(`Circuit breaker ${this.name} is open`);
      }
    }

    const startTime = Date.now();
    try {
      const result = await operation();
      const executionTime = Date.now() - startTime;

      // Consider slow operations as soft failures
      if (executionTime > this.performanceThresholdMs) {
        this.onSoftFailure();
      } else {
        this.onSuccess();
      }

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
      console.error(
        `Circuit breaker ${this.name} opened after ${this.failures} failures`,
      );
    }
  }

  private onSoftFailure(): void {
    // Soft failures (performance issues) count as half failures
    this.failures += 0.5;
    this.lastFailure = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "open";
      console.warn(
        `Circuit breaker ${this.name} opened due to performance issues`,
      );
    }
  }

  getState(): { state: "closed" | "open" | "half-open"; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}

/**
 * Helper functions for extracting context from function arguments
 */
function extractUserId(args: any[]): Id<"users"> | undefined {
  // Try to extract userId from various argument patterns
  if (args.length > 1 && args[1] && typeof args[1] === "object") {
    return args[1].userId || args[1].authorId;
  }
  return undefined;
}

function extractMeetingId(args: any[]): Id<"meetings"> | undefined {
  if (args.length > 1 && args[1] && typeof args[1] === "object") {
    return args[1].meetingId;
  }
  return undefined;
}

function extractResourceType(args: any[]): string | undefined {
  if (args.length > 1 && args[1] && typeof args[1] === "object") {
    return args[1].resourceType;
  }
  return undefined;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0;

  const index = Math.ceil(sortedArray.length * p) - 1;
  return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
}

/**
 * Cleanup function to be called periodically
 */
export function performanceCleanup(): void {
  SubscriptionPerformanceTracker.cleanup();
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(performanceCleanup, 5 * 60 * 1000);
}
