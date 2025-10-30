/**
 * Real-Time Transcript Streaming Manager
 *
 * This module handles high-frequency transcript streaming with batching,
 * coalescing, and backpressure management for optimal performance.
 *
 * Requirements: 7.1, 7.2, 7.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

import {
  internalAction,
  internalMutation,
  internalQuery,
} from "@convex/_generated/server";
import { v } from "convex/values";
import { internal } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

/**
 * @summary Processes high-frequency transcript streams with intelligent batching
 * @description Internal action that handles real-time transcription streams from
 * speech-to-text services. Implements adaptive batching and coalescing strategies
 * based on stream configuration. Validates meeting is active before processing,
 * respects max latency constraints, and records performance metrics. Returns
 * throughput and latency statistics for monitoring.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "chunks": [
 *       {
 *         "speakerId": "user_alice_123",
 *         "text": "I think we should",
 *         "confidence": 0.88,
 *         "startTime": 1698765432000,
 *         "endTime": 1698765433000,
 *         "language": "en"
 *       },
 *       {
 *         "speakerId": "user_alice_123",
 *         "text": "prioritize this feature.",
 *         "confidence": 0.91,
 *         "startTime": 1698765433100,
 *         "endTime": 1698765434500,
 *         "language": "en"
 *       }
 *     ],
 *     "streamConfig": {
 *       "batchSize": 20,
 *       "coalescingWindowMs": 250,
 *       "maxLatencyMs": 1000,
 *       "enableCoalescing": true
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "success": true,
 *     "processed": 2,
 *     "batches": 1,
 *     "performance": {
 *       "totalLatencyMs": 145,
 *       "averageLatencyPerChunk": 72.5,
 *       "throughputChunksPerSecond": 13.79
 *     }
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "success": false,
 *     "processed": 0,
 *     "batches": 0,
 *     "performance": {
 *       "totalLatencyMs": 0,
 *       "averageLatencyPerChunk": 0,
 *       "throughputChunksPerSecond": 0
 *     }
 *   }
 * }
 * ```
 */
export const processTranscriptStream = internalAction({
  args: {
    meetingId: v.id("meetings"),
    chunks: v.array(
      v.object({
        speakerId: v.optional(v.string()),
        text: v.string(),
        confidence: v.number(),
        startTime: v.number(),
        endTime: v.number(),
        language: v.optional(v.string()),
        isInterim: v.optional(v.boolean()),
      }),
    ),
    streamConfig: v.optional(
      v.object({
        batchSize: v.number(),
        coalescingWindowMs: v.number(),
        maxLatencyMs: v.number(),
        enableCoalescing: v.boolean(),
      }),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    processed: v.number(),
    batches: v.number(),
    performance: v.object({
      totalLatencyMs: v.number(),
      averageLatencyPerChunk: v.number(),
      throughputChunksPerSecond: v.number(),
    }),
  }),
  handler: async (ctx, { meetingId, chunks, streamConfig }) => {
    const startTime = Date.now();
    const config = {
      batchSize: 20,
      coalescingWindowMs: 250,
      maxLatencyMs: 1000,
      enableCoalescing: true,
      ...streamConfig,
    };

    let totalProcessed = 0;
    let batchCount = 0;

    try {
      // Validate meeting is active
      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting || meeting.state !== "active") {
        console.warn(
          `Meeting ${meetingId} is not active, skipping transcript processing`,
        );
        return {
          success: false,
          processed: 0,
          batches: 0,
          performance: {
            totalLatencyMs: 0,
            averageLatencyPerChunk: 0,
            throughputChunksPerSecond: 0,
          },
        };
      }

      // Process chunks in optimized batches
      if (config.enableCoalescing && chunks.length > 1) {
        // Use coalescing for high-frequency streams
        const result = await ctx.runMutation(
          internal.transcripts.ingestion.coalescedIngestTranscriptChunks,
          {
            meetingId,
            chunks,
            coalescingWindowMs: config.coalescingWindowMs,
          },
        );
        totalProcessed = result.processed;
        batchCount = 1;
      } else {
        // Process in regular batches
        for (let i = 0; i < chunks.length; i += config.batchSize) {
          const batchChunks = chunks.slice(i, i + config.batchSize);

          const result = await ctx.runMutation(
            internal.transcripts.ingestion.batchIngestTranscriptChunks,
            {
              meetingId,
              chunks: batchChunks,
              batchId: `stream_batch_${Date.now()}_${batchCount}`,
            },
          );

          totalProcessed += result.processed;
          batchCount++;

          // Respect max latency constraint
          if (Date.now() - startTime > config.maxLatencyMs) {
            console.warn(
              `Stream processing exceeded max latency (${config.maxLatencyMs}ms), stopping`,
            );
            break;
          }
        }
      }

      const totalLatencyMs = Date.now() - startTime;
      const averageLatencyPerChunk =
        totalProcessed > 0 ? totalLatencyMs / totalProcessed : 0;
      const throughputChunksPerSecond =
        totalProcessed > 0 && totalLatencyMs > 0
          ? (totalProcessed / totalLatencyMs) * 1000
          : 0;

      // Update streaming metrics via streaming module (records throughput and latency aggregates)
      await ctx.runMutation(
        internal.transcripts.streaming.updateStreamingMetrics,
        {
          meetingId,
          metrics: {
            chunksProcessed: totalProcessed,
            batchesProcessed: batchCount,
            latencyMs: totalLatencyMs,
            throughputChunksPerSecond,
            timestamp: Date.now(),
          },
        },
      );

      return {
        success: true,
        processed: totalProcessed,
        batches: batchCount,
        performance: {
          totalLatencyMs,
          averageLatencyPerChunk,
          throughputChunksPerSecond,
        },
      };
    } catch (error) {
      console.error("Failed to process transcript stream:", error);
      return {
        success: false,
        processed: totalProcessed,
        batches: batchCount,
        performance: {
          totalLatencyMs: Date.now() - startTime,
          averageLatencyPerChunk: 0,
          throughputChunksPerSecond: 0,
        },
      };
    }
  },
});

/**
 * @summary Updates streaming performance metrics with aggregated statistics
 * @description Internal mutation that records transcript streaming performance data
 * including throughput (chunks/sec), latency samples, and rolling aggregates (sum,
 * count, average). Maintains time-series metrics for monitoring dashboards and
 * alerting. Updates meeting state with latest streaming activity timestamp.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "metrics": {
 *       "chunksProcessed": 25,
 *       "batchesProcessed": 2,
 *       "latencyMs": 145,
 *       "throughputChunksPerSecond": 13.79,
 *       "timestamp": 1698765432000
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 */
export const updateStreamingMetrics = internalMutation({
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
    // Store throughput metric (chunks/sec)
    await ctx.db.insert("performanceMetrics", {
      name: "transcript_streaming",
      value: metrics.throughputChunksPerSecond,
      unit: "chunks_per_second",
      labels: {
        meetingId: meetingId,
        operation: "transcript_ingestion",
        batchesProcessed: metrics.batchesProcessed.toString(),
      },
      meetingId, // Denormalized for indexing
      threshold: {
        warning: 10, // chunks per second
        critical: 5,
      },
      timestamp: metrics.timestamp,
      createdAt: Date.now(),
    });

    // Store latency sample (ms)
    await ctx.db.insert("performanceMetrics", {
      name: "transcript_streaming_latency",
      value: metrics.latencyMs, // ensure ms
      unit: "ms",
      labels: {
        meetingId: meetingId,
        operation: "transcript_ingestion",
      },
      meetingId, // Denormalized for indexing
      timestamp: metrics.timestamp,
      createdAt: Date.now(),
    });

    // Maintain aggregates: rolling sum and count per meeting
    // Fetch latest sum
    const sumRecords = await ctx.db
      .query("performanceMetrics")
      .withIndex("by_name_meetingId_timestamp", (q) =>
        q
          .eq("name", "transcript_streaming_latency_sum")
          .eq("meetingId", meetingId),
      )
      .collect();
    const latestSum = sumRecords.reduce(
      (acc, r) => (r.timestamp > acc.timestamp ? r : acc),
      sumRecords[0] ?? { value: 0, timestamp: 0 },
    ) as { value: number; timestamp: number };

    // Fetch latest count
    const countRecords = await ctx.db
      .query("performanceMetrics")
      .withIndex("by_name_meetingId_timestamp", (q) =>
        q
          .eq("name", "transcript_streaming_latency_count")
          .eq("meetingId", meetingId),
      )
      .collect();
    const latestCount = countRecords.reduce(
      (acc, r) => (r.timestamp > acc.timestamp ? r : acc),
      countRecords[0] ?? { value: 0, timestamp: 0 },
    ) as { value: number; timestamp: number };

    const newSum = (latestSum?.value ?? 0) + metrics.latencyMs;
    const newCount = (latestCount?.value ?? 0) + 1;
    const newAvg = newCount > 0 ? newSum / newCount : 0;

    // Persist updated sum
    await ctx.db.insert("performanceMetrics", {
      name: "transcript_streaming_latency_sum",
      value: newSum,
      unit: "ms_sum",
      labels: { meetingId: meetingId, operation: "transcript_ingestion" },
      meetingId, // Denormalized for indexing
      timestamp: metrics.timestamp,
      createdAt: Date.now(),
    });

    // Persist updated count
    await ctx.db.insert("performanceMetrics", {
      name: "transcript_streaming_latency_count",
      value: newCount,
      unit: "samples",
      labels: { meetingId: meetingId, operation: "transcript_ingestion" },
      meetingId, // Denormalized for indexing
      timestamp: metrics.timestamp,
      createdAt: Date.now(),
    });

    // Persist updated average for convenience
    await ctx.db.insert("performanceMetrics", {
      name: "transcript_streaming_latency_avg",
      value: newAvg,
      unit: "ms",
      labels: { meetingId: meetingId, operation: "transcript_ingestion" },
      meetingId, // Denormalized for indexing
      timestamp: metrics.timestamp,
      createdAt: Date.now(),
    });

    // Update meeting state with streaming activity
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * @summary Manages transcript streaming backpressure with adaptive throttling
 * @description Internal action that analyzes current streaming load (throughput,
 * latency, queue depth) and recommends adaptive strategies to prevent system
 * overload. Returns throttling decisions, recommended batch sizes, and coalescing
 * windows. Creates critical alerts when performance thresholds are exceeded.
 * Implements four action levels: continue, throttle, pause, and alert.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "currentLoad": {
 *       "chunksPerSecond": 35,
 *       "averageLatencyMs": 280,
 *       "queueDepth": 45
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "shouldThrottle": true,
 *     "recommendedBatchSize": 15,
 *     "recommendedCoalescingWindow": 350,
 *     "action": "throttle"
 *   }
 * }
 * ```
 *
 * @example response-critical
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "shouldThrottle": true,
 *     "recommendedBatchSize": 10,
 *     "recommendedCoalescingWindow": 500,
 *     "action": "pause"
 *   }
 * }
 * ```
 */
export const manageStreamingBackpressure = internalAction({
  args: {
    meetingId: v.id("meetings"),
    currentLoad: v.object({
      chunksPerSecond: v.number(),
      averageLatencyMs: v.number(),
      queueDepth: v.number(),
    }),
  },
  returns: v.object({
    shouldThrottle: v.boolean(),
    recommendedBatchSize: v.number(),
    recommendedCoalescingWindow: v.number(),
    action: v.union(
      v.literal("continue"),
      v.literal("throttle"),
      v.literal("pause"),
      v.literal("alert"),
    ),
  }),
  handler: async (ctx, { meetingId, currentLoad }) => {
    const { chunksPerSecond, averageLatencyMs, queueDepth } = currentLoad;

    // Define performance thresholds
    const thresholds = {
      maxChunksPerSecond: 50,
      maxLatencyMs: 500,
      maxQueueDepth: 100,
      warningLatencyMs: 250,
      warningChunksPerSecond: 30,
    };

    let action: "continue" | "throttle" | "pause" | "alert" = "continue";
    let shouldThrottle = false;
    let recommendedBatchSize = 20;
    let recommendedCoalescingWindow = 250;

    // Analyze current performance
    if (
      averageLatencyMs > thresholds.maxLatencyMs ||
      queueDepth > thresholds.maxQueueDepth
    ) {
      action = "pause";
      shouldThrottle = true;
      recommendedBatchSize = 10;
      recommendedCoalescingWindow = 500;

      // Create alert for critical performance issues
      await ctx.runMutation(
        internal.transcripts.ingestion.createAlertInternal,
        {
          alertId: `transcript_backpressure_${meetingId}_${Date.now()}`,
          severity: "critical",
          category: "transcription",
          title: "Transcript Streaming Backpressure",
          message: `Meeting ${meetingId} experiencing high latency (${averageLatencyMs}ms) or queue depth (${queueDepth})`,
          metadata: {
            meetingId,
            latencyMs: averageLatencyMs,
            queueDepth,
            chunksPerSecond,
          },
          actionable: true,
        },
      );
    } else if (
      averageLatencyMs > thresholds.warningLatencyMs ||
      chunksPerSecond > thresholds.warningChunksPerSecond
    ) {
      action = "throttle";
      shouldThrottle = true;
      recommendedBatchSize = 15;
      recommendedCoalescingWindow = 350;
    } else if (averageLatencyMs < 100 && chunksPerSecond < 20) {
      // Performance is good, can increase throughput
      recommendedBatchSize = 25;
      recommendedCoalescingWindow = 200;
    }

    return {
      shouldThrottle,
      recommendedBatchSize,
      recommendedCoalescingWindow,
      action,
    };
  },
});

/**
 * @summary Cleans up old streaming performance metrics
 * @description Internal maintenance mutation that removes streaming metrics older
 * than the specified retention period (default 24 hours). Helps manage storage
 * costs for high-frequency time-series data. Creates audit log entries for
 * compliance tracking. Used by scheduled maintenance jobs.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "olderThanMs": 86400000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "deleted": 1247
 *   }
 * }
 * ```
 */
export const cleanupStreamingMetrics = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (ctx, { olderThanMs = 24 * 60 * 60 * 1000 }) => {
    // Default 24 hours retention for streaming metrics
    const cutoff = Date.now() - olderThanMs;

    const oldMetrics = await ctx.db
      .query("performanceMetrics")
      .withIndex("by_name_and_timestamp", (q) =>
        q.eq("name", "transcript_streaming").lt("timestamp", cutoff),
      )
      .collect();

    for (const metric of oldMetrics) {
      await ctx.db.delete(metric._id);
    }

    // Audit log (best-effort)
    try {
      await ctx.runMutation(internal.audit.logging.createAuditLog, {
        actorUserId: undefined,
        resourceType: "metrics",
        resourceId: "transcript_streaming",
        action: "cleanup_metrics",
        category: "transcription",
        success: true,
        metadata: { deleted: oldMetrics.length, olderThanMs },
      });
    } catch (e) {
      console.warn("Failed to log metrics cleanup audit", e);
    }

    return {
      deleted: oldMetrics.length,
    };
  },
});

/**
 * @summary Gets streaming performance statistics for a meeting
 * @description Internal query that calculates aggregate streaming performance metrics
 * over a time window (default 1 hour). Returns average and peak throughput, average
 * latency, total chunks processed, batch count, and an overall performance grade
 * (excellent/good/fair/poor). Used for monitoring dashboards and performance analysis.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7xzqn8h9p2v4k5m6n7p8q9",
 *     "timeRangeMs": 3600000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "averageThroughput": 28.5,
 *     "peakThroughput": 45.2,
 *     "averageLatency": 165,
 *     "totalChunksProcessed": 102600,
 *     "totalBatches": 87,
 *     "performanceGrade": "good"
 *   }
 * }
 * ```
 *
 * @example response-no-data
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "averageThroughput": 0,
 *     "peakThroughput": 0,
 *     "averageLatency": 0,
 *     "totalChunksProcessed": 0,
 *     "totalBatches": 0,
 *     "performanceGrade": "fair"
 *   }
 * }
 * ```
 */
export const getStreamingStats = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    timeRangeMs: v.optional(v.number()),
  },
  returns: v.object({
    averageThroughput: v.number(),
    peakThroughput: v.number(),
    averageLatency: v.number(),
    totalChunksProcessed: v.number(),
    totalBatches: v.number(),
    performanceGrade: v.union(
      v.literal("excellent"),
      v.literal("good"),
      v.literal("fair"),
      v.literal("poor"),
    ),
  }),
  handler: async (ctx, { meetingId, timeRangeMs = 3600000 }) => {
    // Default 1 hour time range
    const since = Date.now() - timeRangeMs;

    const metrics = await ctx.db
      .query("performanceMetrics")
      .withIndex("by_name_meetingId_timestamp", (q) =>
        q
          .eq("name", "transcript_streaming")
          .eq("meetingId", meetingId)
          .gte("timestamp", since),
      )
      .collect();

    if (metrics.length === 0) {
      return {
        averageThroughput: 0,
        peakThroughput: 0,
        averageLatency: 0,
        totalChunksProcessed: 0,
        totalBatches: 0,
        performanceGrade: "fair" as const,
      };
    }

    const throughputs = metrics.map((m) => m.value);
    const averageThroughput =
      throughputs.reduce((sum, val) => sum + val, 0) / throughputs.length;
    const peakThroughput = Math.max(...throughputs);

    // Calculate performance grade
    let performanceGrade: "excellent" | "good" | "fair" | "poor" = "fair";
    if (averageThroughput >= 40) {
      performanceGrade = "excellent";
    } else if (averageThroughput >= 25) {
      performanceGrade = "good";
    } else if (averageThroughput >= 10) {
      performanceGrade = "fair";
    } else {
      performanceGrade = "poor";
    }

    // Estimate totals from metrics
    const totalChunksProcessed = Math.round(
      averageThroughput * (timeRangeMs / 1000),
    );
    const totalBatches = metrics.length;

    // Compute average latency from recorded latency samples in the same window (ms)
    const latencyMetrics = await ctx.db
      .query("performanceMetrics")
      .withIndex("by_name_meetingId_timestamp", (q) =>
        q
          .eq("name", "transcript_streaming_latency")
          .eq("meetingId", meetingId)
          .gte("timestamp", since),
      )
      .collect();
    const latencyCount = latencyMetrics.length;
    const latencySum = latencyMetrics.reduce((sum, m) => sum + m.value, 0);
    const averageLatency = latencyCount > 0 ? latencySum / latencyCount : 0;

    return {
      averageThroughput,
      peakThroughput,
      averageLatency, // ms
      totalChunksProcessed,
      totalBatches,
      performanceGrade,
    };
  },
});
