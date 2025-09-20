/**
 * System Maintenance Actions
 *
 * Centralizes background maintenance helpers so we can schedule them via
 * Convex crons or run them on-demand without violating execution constraints.
 */

import { internalAction } from "@convex/_generated/server";
import { v } from "convex/values";
import { queryOptimizationCleanup } from "@convex/lib/queryOptimization";

export const cleanupQueryOptimizers = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    queryOptimizationCleanup();
    return null;
  },
});
