/**
 * Performance Monitoring Queries and Real-Time Metrics
 *
 * This module provides comprehensive performance monitoring, SLO validation,
 * and real-time metrics collection for Convex functions and subscriptions.
 *
 * Requirements: 14.1, 14.2, 14.5, 5.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { query, mutation, action, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireIdentity } from "../auth/guards";
import {
  PerformanceTracker,
  SubscriptionPerformanceTracker,
  SLO_TARGETS,
} from "../lib/performance";
import { globalBandwidthManager } from "../lib/batching";
import { metadataRecordV } from "../lib/validators";

/**
 * Real-time performance metrics query
 */
export const getPerformanceMetrics = query({
  args: {
    functionName: v.optional(v.string()),
    timeWindowMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    metrics: v.array(
      v.object({
        functionName: v.string(),
        executionTimeMs: v.number(),
        success: v.boolean(),
        errorType: v.optional(v.string()),
        timestamp: v.number(),
        traceId: v.string(),
      }),
    ),
    aggregatedStats: v.object({
      count: v.number(),
      successRate: v.number(),
      p50: v.number(),
      p95: v.number(),
      p99: v.number(),
      avgExecutionTime: v.number(),
      sloBreaches: v.number(),
    }),
    sloCompliance: v.object({
      queryP95Compliant: v.boolean(),
      queryP99Compliant: v.boolean(),
      currentP95: v.number(),
      currentP99: v.number(),
      targetP95: v.number(),
      targetP99: v.number(),
    }),
  }),
  handler: async (
    ctx,
    { functionName, timeWindowMs = 60000, limit = 1000 },
  ) => {
    await requireIdentity(ctx);

    // Get raw metrics
    const metrics = PerformanceTracker.getMetrics(
      functionName,
      Date.now() - timeWindowMs,
      limit,
    );

    // Get aggregated statistics
    const stats = PerformanceTracker.getAggregatedStats(
      functionName,
      timeWindowMs,
    );

    // Calculate SLO compliance
    const sloCompliance = {
      queryP95Compliant: stats.p95 <= SLO_TARGETS.queryP95Ms,
      queryP99Compliant: stats.p99 <= SLO_TARGETS.queryP99Ms,
      currentP95: stats.p95,
      currentP99: stats.p99,
      targetP95: SLO_TARGETS.queryP95Ms,
      targetP99: SLO_TARGETS.queryP99Ms,
    };

    return {
      metrics: metrics.map((m) => ({
        functionName: m.functionName,
        executionTimeMs: m.executionTimeMs,
        success: m.success,
        errorType: m.errorType,
        timestamp: m.timestamp,
        traceId: m.traceId,
      })),
      aggregatedStats: stats,
      sloCompliance,
    };
  },
});

/**
 * Internal: Ingest a transcript streaming performance metric.
 * Avoids auth requirement for background/internal reporting.
 */
export const ingestStreamingMetric = mutation({
  args: {
    meetingId: v.id("meetings"),
    metrics: v.object({
      chunksProcessed: v.number(),
      batchesProcessed: v.number(),
      latencyMs: v.number(),
      throughputChunksPerSecond: v.number(),
      timestamp: v.number(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, metrics }) => {
    await ctx.db.insert("performanceMetrics", {
      name: "transcript_streaming",
      value: metrics.throughputChunksPerSecond,
      unit: "chunks_per_second",
      labels: {
        meetingId,
        operation: "transcript_ingestion",
        batchesProcessed: String(metrics.batchesProcessed),
      },
      threshold: {
        warning: 10,
        critical: 5,
      },
      timestamp: metrics.timestamp,
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * Internal: Create a system alert (no auth requirement).
 */
export const createAlertInternal = mutation({
  args: {
    alertId: v.string(),
    severity: v.union(
      v.literal("critical"),
      v.literal("error"),
      v.literal("warning"),
      v.literal("info"),
    ),
    category: v.union(
      v.literal("meeting_lifecycle"),
      v.literal("video_provider"),
      v.literal("transcription"),
      v.literal("authentication"),
      v.literal("performance"),
      v.literal("security"),
      v.literal("system"),
    ),
    title: v.string(),
    message: v.string(),
    metadata: v.optional(metadataRecordV),
    actionable: v.boolean(),
  },
  returns: v.id("alerts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("alerts")
      .filter((q) => q.eq(q.field("alertId"), args.alertId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        message: args.message,
        metadata: args.metadata,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("alerts", {
      alertId: args.alertId,
      severity: args.severity,
      category: args.category,
      title: args.title,
      message: args.message,
      metadata: args.metadata,
      actionable: args.actionable,
      status: "active",
      escalationTime: args.severity === "critical" ? now + 300000 : undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * WebSocket subscription performance metrics
 */
export const getSubscriptionMetrics = query({
  args: {
    subscriptionId: v.optional(v.string()),
  },
  returns: v.object({
    subscriptions: v.array(
      v.object({
        subscriptionId: v.string(),
        durationMs: v.number(),
        updateCount: v.number(),
        avgLatency: v.number(),
        updatesPerSecond: v.number(),
        errors: v.number(),
        lastUpdate: v.number(),
        sloCompliant: v.boolean(),
      }),
    ),
    globalStats: v.object({
      totalActiveSubscriptions: v.number(),
      totalUpdates: v.number(),
      avgUpdatesPerSecond: v.number(),
      sloBreaches: v.number(),
    }),
    bandwidthStats: v.object({
      activeSubscriptions: v.number(),
      totalUpdates: v.number(),
    }),
  }),
  handler: async (ctx, { subscriptionId }) => {
    await requireIdentity(ctx);

    let subscriptions;
    if (subscriptionId) {
      const stats =
        SubscriptionPerformanceTracker.getSubscriptionStats(subscriptionId);
      subscriptions = stats ? [{ subscriptionId, stats }] : [];
    } else {
      subscriptions = SubscriptionPerformanceTracker.getAllStats();
    }

    // Calculate global statistics
    const totalUpdates = subscriptions.reduce(
      (sum, sub) => sum + sub.stats.updateCount,
      0,
    );
    const totalDuration = subscriptions.reduce(
      (sum, sub) => sum + sub.stats.durationMs,
      0,
    );
    const avgDuration =
      subscriptions.length > 0 ? totalDuration / subscriptions.length : 0;
    const avgUpdatesPerSecond =
      avgDuration > 0 ? totalUpdates / (avgDuration / 1000) : 0;
    const sloBreaches = subscriptions.filter(
      (sub) => !sub.stats.sloCompliant,
    ).length;

    const globalStats = {
      totalActiveSubscriptions: subscriptions.length,
      totalUpdates,
      avgUpdatesPerSecond,
      sloBreaches,
    };

    const bandwidthStats = globalBandwidthManager.getStats();

    return {
      subscriptions: subscriptions.map((sub) => ({
        subscriptionId: sub.subscriptionId,
        ...sub.stats,
      })),
      globalStats,
      bandwidthStats,
    };
  },
});

/**
 * Function-level performance breakdown
 */
export const getFunctionPerformanceBreakdown = query({
  args: {
    timeWindowMs: v.optional(v.number()),
  },
  returns: v.object({
    functions: v.array(
      v.object({
        functionName: v.string(),
        callCount: v.number(),
        successRate: v.number(),
        avgExecutionTime: v.number(),
        p95ExecutionTime: v.number(),
        p99ExecutionTime: v.number(),
        errorCount: v.number(),
        sloBreaches: v.number(),
        sloCompliant: v.boolean(),
      }),
    ),
    summary: v.object({
      totalFunctions: v.number(),
      totalCalls: v.number(),
      overallSuccessRate: v.number(),
      sloCompliantFunctions: v.number(),
      sloComplianceRate: v.number(),
    }),
  }),
  handler: async (ctx, { timeWindowMs = 300000 }) => {
    // 5 minutes default
    await requireIdentity(ctx);

    const since = Date.now() - timeWindowMs;
    const allMetrics = PerformanceTracker.getMetrics(undefined, since);

    // Group by function name
    const functionGroups = new Map<string, any[]>();
    for (const metric of allMetrics) {
      if (!functionGroups.has(metric.functionName)) {
        functionGroups.set(metric.functionName, []);
      }
      functionGroups.get(metric.functionName)!.push(metric);
    }

    const functions = Array.from(functionGroups.entries()).map(
      ([functionName, metrics]) => {
        const executionTimes = metrics
          .map((m) => m.executionTimeMs)
          .sort((a, b) => a - b);
        const successCount = metrics.filter((m) => m.success).length;
        const errorCount = metrics.length - successCount;
        const sloBreaches = metrics.filter(
          (m) => m.executionTimeMs > SLO_TARGETS.queryP95Ms,
        ).length;

        const p95 = percentile(executionTimes, 0.95);
        const p99 = percentile(executionTimes, 0.99);
        const avgExecutionTime =
          executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;

        return {
          functionName,
          callCount: metrics.length,
          successRate: successCount / metrics.length,
          avgExecutionTime,
          p95ExecutionTime: p95,
          p99ExecutionTime: p99,
          errorCount,
          sloBreaches,
          sloCompliant:
            p95 <= SLO_TARGETS.queryP95Ms && p99 <= SLO_TARGETS.queryP99Ms,
        };
      },
    );

    // Calculate summary statistics
    const totalCalls = functions.reduce((sum, f) => sum + f.callCount, 0);
    const totalSuccesses = functions.reduce(
      (sum, f) => sum + f.callCount * f.successRate,
      0,
    );
    const sloCompliantFunctions = functions.filter(
      (f) => f.sloCompliant,
    ).length;

    const summary = {
      totalFunctions: functions.length,
      totalCalls,
      overallSuccessRate: totalCalls > 0 ? totalSuccesses / totalCalls : 0,
      sloCompliantFunctions,
      sloComplianceRate:
        functions.length > 0 ? sloCompliantFunctions / functions.length : 0,
    };

    return {
      functions: functions.sort((a, b) => b.callCount - a.callCount), // Sort by call count
      summary,
    };
  },
});

/**
 * Real-time SLO monitoring with alerting
 */
export const getSLOStatus = query({
  args: {
    timeWindowMs: v.optional(v.number()),
  },
  returns: v.object({
    overall: v.object({
      status: v.union(
        v.literal("healthy"),
        v.literal("warning"),
        v.literal("critical"),
      ),
      score: v.number(), // 0-100
      breaches: v.number(),
      totalChecks: v.number(),
    }),
    slos: v.array(
      v.object({
        name: v.string(),
        target: v.number(),
        current: v.number(),
        status: v.union(
          v.literal("healthy"),
          v.literal("warning"),
          v.literal("critical"),
        ),
        breachCount: v.number(),
        description: v.string(),
      }),
    ),
    alerts: v.array(
      v.object({
        severity: v.union(v.literal("warning"), v.literal("critical")),
        message: v.string(),
        timestamp: v.number(),
        sloName: v.string(),
      }),
    ),
  }),
  handler: async (ctx, { timeWindowMs = 300000 }) => {
    await requireIdentity(ctx);

    const stats = PerformanceTracker.getAggregatedStats(
      undefined,
      timeWindowMs,
    );
    const subscriptionStats = SubscriptionPerformanceTracker.getAllStats();

    // Calculate WebSocket update latency
    const wsLatencies = subscriptionStats
      .map((s) => s.stats.avgLatency)
      .filter((l) => l > 0);
    const avgWsLatency =
      wsLatencies.length > 0
        ? wsLatencies.reduce((a, b) => a + b, 0) / wsLatencies.length
        : 0;

    // Define SLO checks
    const slos = [
      {
        name: "Query P95 Latency",
        target: SLO_TARGETS.queryP95Ms,
        current: stats.p95,
        description: "95th percentile query execution time",
      },
      {
        name: "Query P99 Latency",
        target: SLO_TARGETS.queryP99Ms,
        current: stats.p99,
        description: "99th percentile query execution time",
      },
      {
        name: "WebSocket Update Latency",
        target: SLO_TARGETS.websocketUpdateP95Ms,
        current: avgWsLatency,
        description: "Average WebSocket update delivery time",
      },
      {
        name: "Success Rate",
        target: 99.0, // 99% success rate target
        current: stats.successRate * 100,
        description: "Overall function success rate",
      },
    ];

    // Evaluate SLO status and generate alerts
    const alerts: any[] = [];
    let totalBreaches = 0;
    let healthyCount = 0;

    const evaluatedSlos = slos.map((slo) => {
      let status: "healthy" | "warning" | "critical";
      let breachCount = 0;

      if (slo.name === "Success Rate") {
        // For success rate, lower is worse
        if (slo.current >= slo.target) {
          status = "healthy";
          healthyCount++;
        } else if (slo.current >= slo.target - 5) {
          // Within 5% of target
          status = "warning";
          breachCount = 1;
        } else {
          status = "critical";
          breachCount = 1;
        }
      } else {
        // For latency metrics, higher is worse
        if (slo.current <= slo.target) {
          status = "healthy";
          healthyCount++;
        } else if (slo.current <= slo.target * 1.2) {
          // Within 20% of target
          status = "warning";
          breachCount = 1;
        } else {
          status = "critical";
          breachCount = 1;
        }
      }

      totalBreaches += breachCount;

      // Generate alerts for breaches
      if (status !== "healthy") {
        alerts.push({
          severity: status,
          message: `${slo.name} SLO breach: ${slo.current.toFixed(2)} vs target ${slo.target}`,
          timestamp: Date.now(),
          sloName: slo.name,
        });
      }

      return {
        ...slo,
        status,
        breachCount,
      };
    });

    // Calculate overall status
    const overallScore = (healthyCount / slos.length) * 100;
    let overallStatus: "healthy" | "warning" | "critical";

    if (overallScore >= 80) {
      overallStatus = "healthy";
    } else if (overallScore >= 60) {
      overallStatus = "warning";
    } else {
      overallStatus = "critical";
    }

    return {
      overall: {
        status: overallStatus,
        score: overallScore,
        breaches: totalBreaches,
        totalChecks: slos.length,
      },
      slos: evaluatedSlos,
      alerts,
    };
  },
});

/**
 * Performance trend analysis
 */
export const getPerformanceTrends = query({
  args: {
    functionName: v.optional(v.string()),
    bucketSizeMs: v.optional(v.number()),
    timeWindowMs: v.optional(v.number()),
  },
  returns: v.object({
    timeSeries: v.array(
      v.object({
        timestamp: v.number(),
        avgLatency: v.number(),
        p95Latency: v.number(),
        callCount: v.number(),
        successRate: v.number(),
        errorCount: v.number(),
      }),
    ),
    trends: v.object({
      latencyTrend: v.union(
        v.literal("improving"),
        v.literal("stable"),
        v.literal("degrading"),
      ),
      throughputTrend: v.union(
        v.literal("increasing"),
        v.literal("stable"),
        v.literal("decreasing"),
      ),
      errorTrend: v.union(
        v.literal("improving"),
        v.literal("stable"),
        v.literal("degrading"),
      ),
    }),
  }),
  handler: async (
    ctx,
    {
      functionName,
      bucketSizeMs = 60000, // 1 minute buckets
      timeWindowMs = 3600000, // 1 hour window
    },
  ) => {
    await requireIdentity(ctx);

    const since = Date.now() - timeWindowMs;
    const metrics = PerformanceTracker.getMetrics(functionName, since);

    // Create time buckets
    const buckets = new Map<number, any[]>();
    const startTime = Math.floor(since / bucketSizeMs) * bucketSizeMs;

    for (const metric of metrics) {
      const bucketTime =
        Math.floor(metric.timestamp / bucketSizeMs) * bucketSizeMs;
      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, []);
      }
      buckets.get(bucketTime)!.push(metric);
    }

    // Generate time series data
    const timeSeries = [];
    for (let time = startTime; time <= Date.now(); time += bucketSizeMs) {
      const bucketMetrics = buckets.get(time) || [];

      if (bucketMetrics.length > 0) {
        const latencies = bucketMetrics
          .map((m) => m.executionTimeMs)
          .sort((a, b) => a - b);
        const successCount = bucketMetrics.filter((m) => m.success).length;

        timeSeries.push({
          timestamp: time,
          avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
          p95Latency: percentile(latencies, 0.95),
          callCount: bucketMetrics.length,
          successRate: successCount / bucketMetrics.length,
          errorCount: bucketMetrics.length - successCount,
        });
      } else {
        timeSeries.push({
          timestamp: time,
          avgLatency: 0,
          p95Latency: 0,
          callCount: 0,
          successRate: 1,
          errorCount: 0,
        });
      }
    }

    // Calculate trends (simple linear regression slope)
    const trends = calculateTrends(timeSeries);

    return {
      timeSeries,
      trends,
    };
  },
});

/**
 * Record custom performance metric
 */
export const recordCustomMetric = mutation({
  args: {
    metricName: v.string(),
    value: v.number(),
    tags: v.optional(v.record(v.string(), v.string())),
    timestamp: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { metricName, value, tags, timestamp }) => {
    const identity = await requireIdentity(ctx);

    const { logAudit } = await import("../lib/audit");
    await logAudit(ctx, {
      actorUserId: identity.userId as Id<"users">,
      resourceType: "performance_metric",
      resourceId: metricName,
      action: "custom_metric_recorded",
      category: "meeting",
      success: true,
      metadata: {
        metricName,
        value,
        tags: tags ?? {},
        category: "performance_monitoring",
      },
    });
  },
});

/**
 * Helper functions
 */
function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0;

  const index = Math.ceil(sortedArray.length * p) - 1;
  return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
}

function calculateTrends(timeSeries: any[]): {
  latencyTrend: "improving" | "stable" | "degrading";
  throughputTrend: "increasing" | "stable" | "decreasing";
  errorTrend: "improving" | "stable" | "degrading";
} {
  if (timeSeries.length < 2) {
    return {
      latencyTrend: "stable",
      throughputTrend: "stable",
      errorTrend: "stable",
    };
  }

  // Simple trend calculation using first and last values
  const first = timeSeries[0];
  const last = timeSeries[timeSeries.length - 1];

  const latencyChange = (last.avgLatency - first.avgLatency) / first.avgLatency;
  const throughputChange =
    (last.callCount - first.callCount) / Math.max(first.callCount, 1);
  const errorChange =
    (last.errorCount - first.errorCount) / Math.max(first.errorCount, 1);

  return {
    latencyTrend:
      latencyChange > 0.1
        ? "degrading"
        : latencyChange < -0.1
          ? "improving"
          : "stable",
    throughputTrend:
      throughputChange > 0.1
        ? "increasing"
        : throughputChange < -0.1
          ? "decreasing"
          : "stable",
    errorTrend:
      errorChange > 0.1
        ? "degrading"
        : errorChange < -0.1
          ? "improving"
          : "stable",
  };
}
