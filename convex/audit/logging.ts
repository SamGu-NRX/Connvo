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
import { metadataRecordV } from "../lib/validators";
import { query } from "../_generated/server";

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
    metadata: v.optional(metadataRecordV),
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
    metadata: v.optional(metadataRecordV),
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

/**
 * General audit log creation for arbitrary events
 */
export const createAuditLog = internalMutation({
  args: {
    actorUserId: v.optional(v.id("users")),
    resourceType: v.string(),
    resourceId: v.string(),
    action: v.string(),
    category: v.string(),
    metadata: v.optional(metadataRecordV),
    success: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      action: args.action,
      metadata: { category: args.category, success: args.success, ...(args.metadata || {}) },
      timestamp: Date.now(),
    });
    return null;
  },
});

/**
 * Public query to list audit logs by resource
 */
export const getAuditLogs = query({
  args: {
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    actorUserId: v.optional(v.id("users")),
    action: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    logs: v.array(
      v.object({
        actorUserId: v.optional(v.id("users")),
        resourceType: v.string(),
        resourceId: v.string(),
        action: v.string(),
        metadata: metadataRecordV,
        timestamp: v.number(),
        _id: v.id("auditLogs"),
        _creationTime: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { resourceType, resourceId, actorUserId, action, limit = 50 }) => {
    // Choose a concrete indexed query path to avoid mixing QueryInitializer and Query types
    let q = resourceType && resourceId
      ? ctx.db
          .query("auditLogs")
          .withIndex("by_resource", (qi) =>
            qi.eq("resourceType", resourceType).eq("resourceId", resourceId),
          )
      : actorUserId
      ? ctx.db
          .query("auditLogs")
          .withIndex("by_actor", (qi) => qi.eq("actorUserId", actorUserId))
      : action
      ? ctx.db
          .query("auditLogs")
          .withIndex("by_action", (qi) => qi.eq("action", action))
      : ctx.db
          .query("auditLogs")
          .withIndex("by_timestamp", (qi) => qi.gt("timestamp", 0));

    const rows = await q.order("desc").take(limit);
    return { logs: rows };
  },
});
