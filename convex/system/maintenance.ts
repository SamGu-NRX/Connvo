/**
 * System Maintenance Actions
 *
 * Centralizes background maintenance helpers so we can schedule them via
 * Convex crons or run them on-demand without violating execution constraints.
 */

import { internalAction } from "@convex/_generated/server";
import { v } from "convex/values";
import { queryOptimizationCleanup } from "@convex/lib/queryOptimization";

/**
 * @summary Cleans up query optimizer cache
 * @description Performs cleanup of stale query optimizer instances to free memory and maintain system performance. This maintenance action should be scheduled via Convex crons or run on-demand during low-traffic periods.
 *
 * @example request
 * ```json
 * { "args": {} }
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
export const cleanupQueryOptimizers = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    queryOptimizationCleanup();
    return null;
  },
});
