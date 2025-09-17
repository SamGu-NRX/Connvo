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
 * Creates a system alert
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
