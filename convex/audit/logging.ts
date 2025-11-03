/**
 * Audit Logging System
 *
 * This module provides comprehensive audit logging for security and compliance.
 *
 * Requirements: 2.6, 14.1, 14.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { internalMutation, query } from "@convex/_generated/server";
import { v } from "convex/values";
import { metadataRecordV } from "@convex/lib/validators";

/**
 * @summary Logs data access events for audit trail
 * @description Records data access events in the audit log for compliance and security monitoring. Tracks read, write, and admin operations on resources. Used internally by authorization guards and data access layers.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "resourceType": "meeting",
 *     "resourceId": "meeting_xyz789",
 *     "operationType": "read",
 *     "metadata": {
 *       "endpoint": "getMeeting",
 *       "ipAddress": "192.168.1.100"
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
 * @summary Logs authorization events for security monitoring
 * @description Records authorization attempts and outcomes in the audit log. Tracks both successful and failed authorization checks for security analysis and compliance. Used by permission guards to create an audit trail of access control decisions.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "action": "delete_meeting",
 *     "resourceType": "meeting",
 *     "resourceId": "meeting_xyz789",
 *     "success": false,
 *     "metadata": {
 *       "reason": "insufficient_permissions",
 *       "requiredRole": "admin"
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
 * @summary Creates general audit log entry
 * @description Creates a general-purpose audit log entry for any system event. Supports flexible categorization and metadata for tracking diverse operations across the system. Used for compliance, debugging, and security monitoring.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "actorUserId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "resourceType": "circuit_breaker",
 *     "resourceId": "external-api",
 *     "action": "circuit_breaker_reset",
 *     "category": "system_administration",
 *     "metadata": {
 *       "serviceName": "external-api",
 *       "previousState": "open"
 *     },
 *     "success": true
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
      metadata: {
        category: args.category,
        success: args.success,
        ...(args.metadata || {}),
      },
      timestamp: Date.now(),
    });
    return null;
  },
});

/**
 * @summary Retrieves audit logs with filtering
 * @description Queries audit logs with optional filtering by resource type, resource ID, actor user, or action. Returns logs in descending timestamp order with configurable limit. Supports multiple query paths using database indexes for efficient retrieval.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "resourceType": "meeting",
 *     "resourceId": "meeting_xyz789",
 *     "limit": 20
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "logs": [
 *       {
 *         "_id": "jh8xp9r2k5n6q7s8v9w0y1z2",
 *         "_creationTime": 1704067200000,
 *         "actorUserId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *         "resourceType": "meeting",
 *         "resourceId": "meeting_xyz789",
 *         "action": "data_read",
 *         "metadata": {
 *           "endpoint": "getMeeting"
 *         },
 *         "timestamp": 1704067200000
 *       },
 *       {
 *         "_id": "km9yr0s3l6o7r8t9w0x1y2z3",
 *         "_creationTime": 1704067140000,
 *         "actorUserId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *         "resourceType": "meeting",
 *         "resourceId": "meeting_xyz789",
 *         "action": "auth_join_meeting",
 *         "metadata": {
 *           "success": true
 *         },
 *         "timestamp": 1704067140000
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "actorUserId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *     "limit": 50
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "logs": [
 *       {
 *         "_id": "jh8xp9r2k5n6q7s8v9w0y1z2",
 *         "_creationTime": 1704067200000,
 *         "actorUserId": "jd7xn8q9k2h5m6p3r4t7w8y9",
 *         "resourceType": "meeting",
 *         "resourceId": "meeting_xyz789",
 *         "action": "data_read",
 *         "metadata": {},
 *         "timestamp": 1704067200000
 *       }
 *     ]
 *   }
 * }
 * ```
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
  handler: async (
    ctx,
    { resourceType, resourceId, actorUserId, action, limit = 50 },
  ) => {
    // Choose a concrete indexed query path to avoid mixing QueryInitializer and Query types
    let q =
      resourceType && resourceId
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
