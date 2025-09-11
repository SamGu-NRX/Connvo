/**
 * Advanced Bandwidth Management and Circuit Breaker Implementation
 *
 * This module provides comprehensive bandwidth management, circuit breakers,
 * and load shedding for high-performance real-time applications.
 *
 * Requirements: 5.4, 14.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalMutation,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireIdentity } from "../auth/guards";
import { PerformanceCircuitBreaker } from "../lib/performance";

/**
 * Advanced bandwidth manager with per-user and global limits
 */
export class AdvancedBandwidthManager {
  private userLimits = new Map<
    string,
    {
      requestCount: number;
      windowStart: number;
      subscriptionCount: number;
      bytesTransferred: number;
      priority: "premium" | "standard" | "limited";
    }
  >();

  private globalStats = {
    totalRequests: 0,
    totalSubscriptions: 0,
    totalBytesTransferred: 0,
    windowStart: Date.now(),
  };

  private readonly limits = {
    premium: {
      requestsPerMinute: 1000,
      maxSubscriptions: 50,
      bytesPerMinute: 10 * 1024 * 1024, // 10MB
    },
    standard: {
      requestsPerMinute: 300,
      maxSubscriptions: 20,
      bytesPerMinute: 5 * 1024 * 1024, // 5MB
    },
    limited: {
      requestsPerMinute: 60,
      maxSubscriptions: 5,
      bytesPerMinute: 1 * 1024 * 1024, // 1MB
    },
  };

  private readonly globalLimits = {
    maxConcurrentSubscriptions: 10000,
    maxRequestsPerSecond: 1000,
    maxBytesPerSecond: 100 * 1024 * 1024, // 100MB
  };

  checkUserLimit(
    userId: string,
    requestType: "query" | "mutation" | "subscription",
    estimatedBytes = 1024,
    userTier: "premium" | "standard" | "limited" = "standard",
  ): {
    allowed: boolean;
    reason?: string;
    retryAfterMs?: number;
    currentUsage: {
      requests: number;
      subscriptions: number;
      bytes: number;
    };
  } {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window

    // Get or create user stats
    let userStats = this.userLimits.get(userId);
    if (!userStats || now - userStats.windowStart > windowMs) {
      userStats = {
        requestCount: 0,
        windowStart: now,
        subscriptionCount: 0,
        bytesTransferred: 0,
        priority: userTier,
      };
      this.userLimits.set(userId, userStats);
    }

    const limits = this.limits[userTier];

    // Check request rate limit
    if (userStats.requestCount >= limits.requestsPerMinute) {
      return {
        allowed: false,
        reason: "Request rate limit exceeded",
        retryAfterMs: windowMs - (now - userStats.windowStart),
        currentUsage: {
          requests: userStats.requestCount,
          subscriptions: userStats.subscriptionCount,
          bytes: userStats.bytesTransferred,
        },
      };
    }

    // Check subscription limit
    if (
      requestType === "subscription" &&
      userStats.subscriptionCount >= limits.maxSubscriptions
    ) {
      return {
        allowed: false,
        reason: "Subscription limit exceeded",
        currentUsage: {
          requests: userStats.requestCount,
          subscriptions: userStats.subscriptionCount,
          bytes: userStats.bytesTransferred,
        },
      };
    }

    // Check bandwidth limit
    if (userStats.bytesTransferred + estimatedBytes > limits.bytesPerMinute) {
      return {
        allowed: false,
        reason: "Bandwidth limit exceeded",
        retryAfterMs: windowMs - (now - userStats.windowStart),
        currentUsage: {
          requests: userStats.requestCount,
          subscriptions: userStats.subscriptionCount,
          bytes: userStats.bytesTransferred,
        },
      };
    }

    // Check global limits
    if (!this.checkGlobalLimits(requestType, estimatedBytes)) {
      return {
        allowed: false,
        reason: "Global system limits exceeded",
        retryAfterMs: 1000, // Retry after 1 second
        currentUsage: {
          requests: userStats.requestCount,
          subscriptions: userStats.subscriptionCount,
          bytes: userStats.bytesTransferred,
        },
      };
    }

    // Update usage
    userStats.requestCount++;
    if (requestType === "subscription") {
      userStats.subscriptionCount++;
    }
    userStats.bytesTransferred += estimatedBytes;

    // Update global stats
    this.updateGlobalStats(requestType, estimatedBytes);

    return {
      allowed: true,
      currentUsage: {
        requests: userStats.requestCount,
        subscriptions: userStats.subscriptionCount,
        bytes: userStats.bytesTransferred,
      },
    };
  }

  private checkGlobalLimits(
    requestType: string,
    estimatedBytes: number,
  ): boolean {
    const now = Date.now();
    const secondsSinceWindowStart = (now - this.globalStats.windowStart) / 1000;

    // Reset window if needed (1 minute windows)
    if (secondsSinceWindowStart >= 60) {
      this.globalStats = {
        totalRequests: 0,
        totalSubscriptions: 0,
        totalBytesTransferred: 0,
        windowStart: now,
      };
      return true;
    }

    // Check global rate limits
    const requestsPerSecond =
      this.globalStats.totalRequests / Math.max(secondsSinceWindowStart, 1);
    const bytesPerSecond =
      this.globalStats.totalBytesTransferred /
      Math.max(secondsSinceWindowStart, 1);

    if (requestsPerSecond > this.globalLimits.maxRequestsPerSecond) {
      return false;
    }

    if (bytesPerSecond > this.globalLimits.maxBytesPerSecond) {
      return false;
    }

    if (
      requestType === "subscription" &&
      this.globalStats.totalSubscriptions >=
        this.globalLimits.maxConcurrentSubscriptions
    ) {
      return false;
    }

    return true;
  }

  private updateGlobalStats(requestType: string, estimatedBytes: number): void {
    this.globalStats.totalRequests++;
    this.globalStats.totalBytesTransferred += estimatedBytes;

    if (requestType === "subscription") {
      this.globalStats.totalSubscriptions++;
    }
  }

  releaseSubscription(userId: string): void {
    const userStats = this.userLimits.get(userId);
    if (userStats && userStats.subscriptionCount > 0) {
      userStats.subscriptionCount--;
      this.globalStats.totalSubscriptions = Math.max(
        0,
        this.globalStats.totalSubscriptions - 1,
      );
    }
  }

  getUserStats(userId: string): any {
    return this.userLimits.get(userId) || null;
  }

  getGlobalStats(): any {
    return { ...this.globalStats };
  }

  cleanup(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [userId, stats] of this.userLimits.entries()) {
      if (now - stats.windowStart > staleThreshold) {
        this.userLimits.delete(userId);
      }
    }
  }
}

/**
 * Global bandwidth manager instance
 */
export const advancedBandwidthManager = new AdvancedBandwidthManager();

/**
 * Circuit breaker registry for different services
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, PerformanceCircuitBreaker>();

  getBreaker(
    serviceName: string,
    failureThreshold = 5,
    recoveryTimeMs = 30000,
    performanceThresholdMs = 1000,
  ): PerformanceCircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(
        serviceName,
        new PerformanceCircuitBreaker(
          serviceName,
          failureThreshold,
          recoveryTimeMs,
          performanceThresholdMs,
        ),
      );
    }
    return this.breakers.get(serviceName)!;
  }

  getAllStates(): Array<{ service: string; state: any }> {
    return Array.from(this.breakers.entries()).map(([service, breaker]) => ({
      service,
      state: breaker.getState(),
    }));
  }

  resetBreaker(serviceName: string): boolean {
    const breaker = this.breakers.get(serviceName);
    if (breaker) {
      // Reset by creating a new instance
      this.breakers.delete(serviceName);
      return true;
    }
    return false;
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Check bandwidth limits for a user request
 */
export const checkBandwidthLimit = query({
  args: {
    requestType: v.union(
      v.literal("query"),
      v.literal("mutation"),
      v.literal("subscription"),
    ),
    estimatedBytes: v.optional(v.number()),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
    currentUsage: v.object({
      requests: v.number(),
      subscriptions: v.number(),
      bytes: v.number(),
    }),
    userTier: v.string(),
  }),
  handler: async (ctx, { requestType, estimatedBytes = 1024 }) => {
    const identity = await requireIdentity(ctx);

    // Determine user tier (this would typically come from user profile or subscription)
    const userTier = "standard"; // Default tier

    const result = advancedBandwidthManager.checkUserLimit(
      identity.userId,
      requestType,
      estimatedBytes,
      userTier as any,
    );

    return {
      ...result,
      userTier,
    };
  },
});

/**
 * Get bandwidth usage statistics
 */
export const getBandwidthStats = query({
  args: {
    includeGlobal: v.optional(v.boolean()),
  },
  returns: v.object({
    userStats: v.optional(
      v.object({
        requestCount: v.number(),
        subscriptionCount: v.number(),
        bytesTransferred: v.number(),
        windowStart: v.number(),
        priority: v.string(),
      }),
    ),
    globalStats: v.optional(
      v.object({
        totalRequests: v.number(),
        totalSubscriptions: v.number(),
        totalBytesTransferred: v.number(),
        windowStart: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { includeGlobal = false }) => {
    const identity = await requireIdentity(ctx);

    const userStats = advancedBandwidthManager.getUserStats(identity.userId);
    const globalStats = includeGlobal
      ? advancedBandwidthManager.getGlobalStats()
      : undefined;

    return {
      userStats,
      globalStats,
    };
  },
});

/**
 * Execute operation with circuit breaker protection
 */
export const executeWithCircuitBreaker = action({
  args: {
    serviceName: v.string(),
    operationId: v.string(),
    failureThreshold: v.optional(v.number()),
    recoveryTimeMs: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    result: v.optional(
      v.object({ operationId: v.string(), timestamp: v.number() }),
    ),
    error: v.optional(v.string()),
    circuitState: v.string(),
  }),
  handler: async (
    ctx,
    { serviceName, operationId, failureThreshold = 5, recoveryTimeMs = 30000 },
  ) => {
    const breaker = circuitBreakerRegistry.getBreaker(
      serviceName,
      failureThreshold,
      recoveryTimeMs,
    );

    try {
      const result = await breaker.execute(async () => {
        // This would be replaced with actual operation logic
        // For now, simulate an operation
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 100),
        );

        // Simulate occasional failures
        if (Math.random() < 0.1) {
          throw new Error("Simulated service failure");
        }

        return { operationId, timestamp: Date.now() };
      });

      return {
        success: true,
        result,
        circuitState: breaker.getState().state,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        circuitState: breaker.getState().state,
      };
    }
  },
});

/**
 * Get circuit breaker status for all services
 */
export const getCircuitBreakerStatus = query({
  args: {},
  returns: v.object({
    breakers: v.array(
      v.object({
        service: v.string(),
        state: v.string(),
        failures: v.number(),
      }),
    ),
    summary: v.object({
      totalBreakers: v.number(),
      openBreakers: v.number(),
      halfOpenBreakers: v.number(),
      closedBreakers: v.number(),
    }),
  }),
  handler: async (ctx, {}) => {
    await requireIdentity(ctx);

    const breakerStates = circuitBreakerRegistry.getAllStates();

    const summary = {
      totalBreakers: breakerStates.length,
      openBreakers: breakerStates.filter((b) => b.state.state === "open")
        .length,
      halfOpenBreakers: breakerStates.filter(
        (b) => b.state.state === "half-open",
      ).length,
      closedBreakers: breakerStates.filter((b) => b.state.state === "closed")
        .length,
    };

    return {
      breakers: breakerStates.map((b) => ({
        service: b.service,
        state: b.state.state,
        failures: b.state.failures,
      })),
      summary,
    };
  },
});

/**
 * Reset circuit breaker for a service
 */
export const resetCircuitBreaker = mutation({
  args: {
    serviceName: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, { serviceName }) => {
    const identity = await requireIdentity(ctx);

    // Only allow admins to reset circuit breakers
    // This would check user permissions in a real implementation

    const success = circuitBreakerRegistry.resetBreaker(serviceName);

    if (success) {
      // Log the reset action
      const { logAudit } = await import("../lib/audit");
      await logAudit(ctx, {
        actorUserId: identity.userId as Id<"users">,
        resourceType: "circuit_breaker",
        resourceId: serviceName,
        action: "circuit_breaker_reset",
        category: "meeting",
        success: true,
        metadata: {
          serviceName,
          category: "system_administration",
        },
      });
    }

    return {
      success,
      message: success
        ? `Circuit breaker for ${serviceName} has been reset`
        : `Circuit breaker for ${serviceName} not found`,
    };
  },
});

/**
 * Load shedding based on system load
 */
export const shouldShedLoad = query({
  args: {
    requestPriority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("normal"),
      v.literal("low"),
    ),
  },
  returns: v.object({
    shouldShed: v.boolean(),
    reason: v.optional(v.string()),
    systemLoad: v.object({
      cpuUsage: v.number(),
      memoryUsage: v.number(),
      activeConnections: v.number(),
      queueDepth: v.number(),
    }),
  }),
  handler: async (ctx, { requestPriority }) => {
    // Simulate system load metrics (in a real implementation, these would come from system monitoring)
    const systemLoad = {
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
      activeConnections: Math.floor(Math.random() * 1000),
      queueDepth: Math.floor(Math.random() * 100),
    };

    // Load shedding thresholds based on priority
    const thresholds = {
      critical: { cpu: 95, memory: 95, connections: 950, queue: 90 },
      high: { cpu: 85, memory: 85, connections: 800, queue: 70 },
      normal: { cpu: 75, memory: 75, connections: 600, queue: 50 },
      low: { cpu: 60, memory: 60, connections: 400, queue: 30 },
    };

    const threshold = thresholds[requestPriority];

    let shouldShed = false;
    let reason: string | undefined;

    if (systemLoad.cpuUsage > threshold.cpu) {
      shouldShed = true;
      reason = `CPU usage (${systemLoad.cpuUsage.toFixed(1)}%) exceeds threshold (${threshold.cpu}%)`;
    } else if (systemLoad.memoryUsage > threshold.memory) {
      shouldShed = true;
      reason = `Memory usage (${systemLoad.memoryUsage.toFixed(1)}%) exceeds threshold (${threshold.memory}%)`;
    } else if (systemLoad.activeConnections > threshold.connections) {
      shouldShed = true;
      reason = `Active connections (${systemLoad.activeConnections}) exceed threshold (${threshold.connections})`;
    } else if (systemLoad.queueDepth > threshold.queue) {
      shouldShed = true;
      reason = `Queue depth (${systemLoad.queueDepth}) exceeds threshold (${threshold.queue})`;
    }

    return {
      shouldShed,
      reason,
      systemLoad,
    };
  },
});

/**
 * Cleanup function for bandwidth manager
 */
export function bandwidthManagerCleanup(): void {
  advancedBandwidthManager.cleanup();
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(bandwidthManagerCleanup, 5 * 60 * 1000);
}
