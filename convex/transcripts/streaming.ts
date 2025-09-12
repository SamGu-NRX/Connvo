/**
 * Real-Time Transcript Streaming Manager
 *
 * This module handles high-frequency transcript streaming with batching,
 * coalescing, and backpressure management for optimal performance.
 *
 * Requirements: 7.1, 7.2, 7.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";



/**
 * Streaming transcript processor with intelligent batching
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

      // Update streaming metrics via monitoring module
      await ctx.runMutation(
        internal.transcripts.ingestion.ingestStreamingMetric,
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
 * Updates streaming performance metrics
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
    // Store performance metrics for monitoring
    await ctx.db.insert("performanceMetrics", {
      name: "transcript_streaming",
      value: metrics.throughputChunksPerSecond,
      unit: "chunks_per_second",
      labels: {
        meetingId: meetingId,
        operation: "transcript_ingestion",
        batchesProcessed: metrics.batchesProcessed.toString(),
      },
      threshold: {
        warning: 10, // chunks per second
        critical: 5,
      },
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
 * Manages transcript streaming backpressure
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
 * Cleans up old streaming metrics
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
 * Gets streaming performance statistics
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
      .withIndex("by_name_and_timestamp", (q) =>
        q.eq("name", "transcript_streaming").gte("timestamp", since),
      )
      .filter((q) => q.eq(q.field("labels.meetingId"), meetingId))
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

    return {
      averageThroughput,
      peakThroughput,
      averageLatency: 0, // Would need separate latency metrics
      totalChunksProcessed,
      totalBatches,
      performanceGrade,
    };
  },
});
