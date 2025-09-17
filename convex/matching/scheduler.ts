/**
 * Matching System Scheduler
 *
 * Implements automated matching cycles and queue maintenance using Convex crons.
 *
 * Requirements: 12.1, 12.3 - Automated matching processing
 * Compliance: steering/convex_rules.mdc - Uses proper cron syntax
 */

import { cronJobs } from "convex/server";
import { api, internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Automated matching cycle runner
 */
export const runAutomatedMatchingCycle = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Run the matching cycle with default parameters
      const result = await ctx.runAction(
        api.matching.engine.runMatchingCycle,
        {
          shardCount: 4,
          minScore: 0.6,
          maxMatches: 100,
        },
      );

      console.log("Automated matching cycle completed:", result);

      // If we created matches, trigger notifications
      if (result.totalMatches > 0) {
        // TODO: Trigger match notifications to users
        console.log(
          `Created ${result.totalMatches} matches with average score ${result.averageScore}`,
        );
      }
    } catch (error) {
      console.error("Automated matching cycle failed:", error);

      // Log error for monitoring
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.matching.scheduler.logMatchingError, {
        error: message,
        timestamp: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Queue maintenance job
 */
export const runQueueMaintenance = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Clean up expired entries
      const cleanupResult = await ctx.runMutation(
        internal.matching.queue.cleanupExpiredEntries,
        {},
      );

      console.log(
        `Queue maintenance: cleaned up ${cleanupResult.expiredCount} expired entries`,
      );
    } catch (error) {
      console.error("Queue maintenance failed:", error);
    }

    return null;
  },
});

/**
 * Log matching errors for monitoring
 */
export const logMatchingError = internalMutation({
  args: {
    error: v.string(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("alerts", {
      alertId: `matching_error_${args.timestamp}`,
      severity: "error",
      category: "system",
      title: "Automated Matching Cycle Failed",
      message: args.error,
      metadata: {
        timestamp: args.timestamp,
        component: "matching_scheduler",
      },
      actionable: true,
      status: "active",
      createdAt: args.timestamp,
      updatedAt: args.timestamp,
    });

    return null;
  },
});

// Configure cron jobs
const crons = cronJobs();

// Run matching cycle every 5 minutes
crons.interval(
  "automated matching cycle",
  { minutes: 5 },
  internal.matching.scheduler.runAutomatedMatchingCycle,
  {},
);

// Run queue maintenance every hour
crons.interval(
  "queue maintenance",
  { hours: 1 },
  internal.matching.scheduler.runQueueMaintenance,
  {},
);

export default crons;
