/**
 * Audit Logging System
 *
 * This module provides comprehensive audit logging for security and compliance.
 *
 * Requirements: 2.6, 14.1, 14.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Logs data access events for audit trail
 */
export const logDataAccessEvent = internalMutation({
  args: {
    userId: v.id("users"),
    resourceType: v.string(),
    resourceId: v.string(),
    operationType: v.union(
      v.literal("read"),
      v.literal("write"),
      v.literal("admin"),
    ),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorUserId: args.userId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      action: `data_${args.operationType}`,
      metadata: args.metadata || {},
      timestamp: Date.now(),
    });

    return null;
  },
});

/**
 * Logs authorization events for security monitoring
 */
export const logAuthorizationEvent = internalMutation({
  args: {
    userId: v.id("users"),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    success: v.boolean(),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorUserId: args.userId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      action: `auth_${args.action}`,
      metadata: {
        success: args.success,
        ...args.metadata,
      },
      timestamp: Date.now(),
    });

    return null;
  },
});
