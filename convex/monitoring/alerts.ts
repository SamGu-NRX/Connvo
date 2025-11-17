/**
 * Monitoring and Alerting System
 *
 * This module provides alerting functionality for system monitoring
 * and performance tracking.
 *
 * Requirements: 14.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { internalMutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { Id } from "@convex/_generated/dataModel";
import { metadataRecordV } from "@convex/lib/validators";

/**
 * @summary Creates a system alert
 * @description Creates or updates a system alert for monitoring and incident management. Alerts are deduplicated by alertId - if an alert with the same ID exists, it is updated instead of creating a duplicate. Supports severity levels (critical, error, warning, info) and categorization for routing and escalation.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "alertId": "high-transcription-latency-2024-01-01",
 *     "severity": "warning",
 *     "category": "transcription",
 *     "title": "High Transcription Latency Detected",
 *     "message": "Average transcription processing time exceeded 500ms threshold",
 *     "metadata": {
 *       "averageLatency": 687,
 *       "threshold": 500,
 *       "affectedMeetings": 12
 *     },
 *     "actionable": true
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": "jh8xp9r2k5n6q7s8v9w0y1z2"
 * }
 * ```
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "alertId": "circuit-breaker-open-ai-service",
 *     "severity": "critical",
 *     "category": "system",
 *     "title": "Circuit Breaker Open: AI Service",
 *     "message": "AI service circuit breaker opened after 5 consecutive failures",
 *     "metadata": {
 *       "serviceName": "ai-service",
 *       "failureCount": 5,
 *       "lastError": "Connection timeout"
 *     },
 *     "actionable": true
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": "km9yr0s3l6o7r8t9w0x1y2z3"
 * }
 * ```
 */
export const createAlert = internalMutation({
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

    // Check if alert already exists to prevent duplicates
    const existingAlert = await ctx.db
      .query("alerts")
      .filter((q) => q.eq(q.field("alertId"), args.alertId))
      .first();

    if (existingAlert) {
      // Update existing alert
      await ctx.db.patch(existingAlert._id, {
        message: args.message,
        metadata: args.metadata || {},
        updatedAt: now,
      });
      return existingAlert._id;
    }

    // Create new alert
    const alertDocId = await ctx.db.insert("alerts", {
      alertId: args.alertId,
      severity: args.severity,
      category: args.category,
      title: args.title,
      message: args.message,
      metadata: args.metadata || {},
      actionable: args.actionable,
      status: "active",
      escalationTime: args.severity === "critical" ? now + 300000 : undefined, // 5 min for critical
      createdAt: now,
      updatedAt: now,
    });

    console.log(`Alert created: ${args.severity} - ${args.title}`);
    return alertDocId;
  },
});
