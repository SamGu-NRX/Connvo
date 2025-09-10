/**
 * Comprehensive Audit Logging System
 *
 * This module provides enterprise-grade audit logging for security,
 * compliance, and operational monitoring.
 *
 * Requirements: 2.6, 14.1, 14.3, 14.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireIdentity, assertOrgAccess } from "../auth/guards";
import { internal } from "../_generated/api";

/**
 * Audit event categories for classification
 */
export const AuditCategories = {
  AUTHENTICATION: "authentication",
  AUTHORIZATION: "authorization",
  DATA_ACCESS: "data_access",
  DATA_MODIFICATION: "data_modification",
  MEETING_LIFECYCLE: "meeting_lifecycle",
  USER_MANAGEMENT: "user_management",
  SYSTEM_ADMIN: "system_admin",
  SECURITY_EVENT: "security_event",
} as const;

/**
 * Audit event severity levels
 */
export const AuditSeverity = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
} as const;

/**
 * Standard audit actions for consistency
 */
export const AuditActions = {
  // Authentication
  LOGIN_SUCCESS: "login_success",
  LOGIN_FAILURE: "login_failure",
  LOGOUT: "logout",
  TOKEN_REFRESH: "token_refresh",
  SESSION_EXPIRED: "session_expired",

  // Authorization
  ACCESS_GRANTED: "access_granted",
  ACCESS_DENIED: "access_denied",
  PERMISSION_ELEVATED: "permission_elevated",
  PERMISSION_REVOKED: "permission_revoked",
  ROLE_CHANGED: "role_changed",

  // Data Access
  RESOURCE_VIEWED: "resource_viewed",
  RESOURCE_DOWNLOADED: "resource_downloaded",
  SEARCH_PERFORMED: "search_performed",
  EXPORT_REQUESTED: "export_requested",

  // Data Modification
  RESOURCE_CREATED: "resource_created",
  RESOURCE_UPDATED: "resource_updated",
  RESOURCE_DELETED: "resource_deleted",
  BULK_OPERATION: "bulk_operation",

  // Meeting Lifecycle
  MEETING_CREATED: "meeting_created",
  MEETING_STARTED: "meeting_started",
  MEETING_ENDED: "meeting_ended",
  PARTICIPANT_JOINED: "participant_joined",
  PARTICIPANT_LEFT: "participant_left",
  PARTICIPANT_REMOVED: "participant_removed",
  RECORDING_STARTED: "recording_started",
  RECORDING_STOPPED: "recording_stopped",

  // User Management
  USER_CREATED: "user_created",
  USER_UPDATED: "user_updated",
  USER_DEACTIVATED: "user_deactivated",
  PROFILE_UPDATED: "profile_updated",

  // System Admin
  CONFIG_CHANGED: "config_changed",
  FEATURE_FLAG_CHANGED: "feature_flag_changed",
  SYSTEM_MAINTENANCE: "system_maintenance",

  // Security Events
  SUSPICIOUS_ACTIVITY: "suspicious_activity",
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
  UNAUTHORIZED_ACCESS_ATTEMPT: "unauthorized_access_attempt",
  DATA_BREACH_DETECTED: "data_breach_detected",
} as const;

/**
 * Enhanced audit log entry interface
 */
export interface AuditLogEntry {
  // Core identification
  actorUserId?: Id<"users">;
  actorType?: "user" | "system" | "api" | "webhook";

  // Resource information
  resourceType: string;
  resourceId: string;

  // Action details
  action: string;
  category: string;
  severity: string;

  // Context and metadata
  metadata: {
    // Request context
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    requestId?: string;

    // Operation details
    operationType?: "read" | "write" | "delete" | "admin";
    affectedFields?: string[];
    oldValues?: Record<string, any>;
    newValues?: Record<string, any>;

    // Security context
    authMethod?: string;
    orgId?: string;
    orgRole?: string;

    // Additional context
    [key: string]: any;
  };

  // Timing
  timestamp: number;
  duration?: number;

  // Result
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Creates a comprehensive audit log entry
 */
export const createAuditLog = internalMutation({
  args: {
    actorUserId: v.optional(v.id("users")),
    actorType: v.optional(
      v.union(
        v.literal("user"),
        v.literal("system"),
        v.literal("api"),
        v.literal("webhook"),
      ),
    ),
    resourceType: v.string(),
    resourceId: v.string(),
    action: v.string(),
    category: v.optional(v.string()),
    severity: v.optional(v.string()),
    metadata: v.any(),
    success: v.boolean(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    duration: v.optional(v.number()),
  },
  returns: v.id("auditLogs"),
  handler: async (ctx, args) => {
    const auditEntry: Partial<AuditLogEntry> = {
      actorUserId: args.actorUserId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      action: args.action,
      metadata: {
        category: args.category || AuditCategories.DATA_ACCESS,
        severity: args.severity || AuditSeverity.LOW,
        actorType: args.actorType || "user",
        ...args.metadata,
      },
      timestamp: Date.now(),
      success: args.success,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      duration: args.duration,
    };

    return await ctx.db.insert("auditLogs", auditEntry as any);
  },
});

/**
 * Logs authentication events
 */
export const logAuthenticationEvent = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    action: v.string(),
    success: v.boolean(),
    metadata: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, action, success, metadata }) => {
    await ctx.runMutation(internal.audit.logging.createAuditLog, {
      actorUserId: userId,
      actorType: "user",
      resourceType: "authentication",
      resourceId: userId || "anonymous",
      action,
      category: AuditCategories.AUTHENTICATION,
      severity: success ? AuditSeverity.LOW : AuditSeverity.MEDIUM,
      metadata: {
        authMethod: "workos_jwt",
        ...metadata,
      },
      success,
    });
  },
});

/**
 * Logs authorization events with detailed context
 */
export const logAuthorizationEvent = internalMutation({
  args: {
    userId: v.id("users"),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    success: v.boolean(),
    requiredPermissions: v.optional(v.array(v.string())),
    grantedPermissions: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.audit.logging.createAuditLog, {
      actorUserId: args.userId,
      actorType: "user",
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      action: args.action,
      category: AuditCategories.AUTHORIZATION,
      severity: args.success ? AuditSeverity.LOW : AuditSeverity.HIGH,
      metadata: {
        requiredPermissions: args.requiredPermissions,
        grantedPermissions: args.grantedPermissions,
        ...args.metadata,
      },
      success: args.success,
    });
  },
});

/**
 * Logs data access events
 */
export const logDataAccessEvent = internalMutation({
  args: {
    userId: v.id("users"),
    resourceType: v.string(),
    resourceId: v.string(),
    operationType: v.union(
      v.literal("read"),
      v.literal("write"),
      v.literal("delete"),
      v.literal("admin"),
    ),
    affectedFields: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const severity =
      args.operationType === "delete" || args.operationType === "admin"
        ? AuditSeverity.HIGH
        : AuditSeverity.LOW;

    await ctx.runMutation(internal.audit.logging.createAuditLog, {
      actorUserId: args.userId,
      actorType: "user",
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      action: `${args.operationType}_${args.resourceType}`,
      category:
        args.operationType === "read"
          ? AuditCategories.DATA_ACCESS
          : AuditCategories.DATA_MODIFICATION,
      severity,
      metadata: {
        operationType: args.operationType,
        affectedFields: args.affectedFields,
        ...args.metadata,
      },
      success: true,
    });
  },
});

/**
 * Logs security events with high priority
 */
export const logSecurityEvent = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    action: v.string(),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    metadata: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, action, severity, metadata }) => {
    await ctx.runMutation(internal.audit.logging.createAuditLog, {
      actorUserId: userId,
      actorType: "system",
      resourceType: "security",
      resourceId: "system",
      action,
      category: AuditCategories.SECURITY_EVENT,
      severity,
      metadata: {
        alertLevel: severity,
        requiresInvestigation: severity === "high" || severity === "critical",
        ...metadata,
      },
      success: false, // Security events are typically failures/alerts
    });
  },
});

/**
 * Queries audit logs with filtering and pagination
 */
export const getAuditLogs = query({
  args: {
    // Filtering options
    actorUserId: v.optional(v.id("users")),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    action: v.optional(v.string()),
    category: v.optional(v.string()),
    severity: v.optional(v.string()),

    // Time range
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),

    // Pagination
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    logs: v.array(
      v.object({
        _id: v.id("auditLogs"),
        actorUserId: v.optional(v.id("users")),
        resourceType: v.string(),
        resourceId: v.string(),
        action: v.string(),
        metadata: v.any(),
        timestamp: v.number(),
        _creationTime: v.number(),
      }),
    ),
    nextCursor: v.optional(v.string()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Require admin access for audit log viewing
    await assertOrgAccess(ctx, "admin");

    const limit = Math.min(args.limit || 100, 1000); // Cap at 1000

    // Build query with filters. Always start from a Query (not QueryInitializer)
    let q = ctx.db.query("auditLogs").withIndex("by_timestamp");
    if (args.actorUserId) {
      q = ctx.db
        .query("auditLogs")
        .withIndex("by_actor", (qi) => qi.eq("actorUserId", args.actorUserId!));
    } else if (args.resourceType && args.resourceId) {
      q = ctx.db
        .query("auditLogs")
        .withIndex("by_resource", (qi) =>
          qi.eq("resourceType", args.resourceType!).eq("resourceId", args.resourceId!),
        );
    } else if (args.action) {
      q = ctx.db
        .query("auditLogs")
        .withIndex("by_action", (qi) => qi.eq("action", args.action!));
    }

    // Apply time range filter
    if (args.startTime) {
      q = q.filter((f) => f.gte(f.field("timestamp"), args.startTime!));
    }
    if (args.endTime) {
      q = q.filter((f) => f.lte(f.field("timestamp"), args.endTime!));
    }

    // Apply additional filters
    if (args.category) {
      q = q.filter((f) => f.eq(f.field("metadata.category"), args.category!));
    }
    if (args.severity) {
      q = q.filter((f) => f.eq(f.field("metadata.severity"), args.severity!));
    }

    // Apply cursor pagination
    if (args.cursor) {
      q = q.filter((f) => f.gt(f.field("_creationTime"), parseInt(args.cursor!)));
    }

    // Execute query
    const logs = await q.order("desc").take(limit + 1);
    const hasMore = logs.length > limit;
    const resultLogs = hasMore ? logs.slice(0, -1) : logs;
    const nextCursor = hasMore
      ? logs[logs.length - 1]._creationTime.toString()
      : undefined;

    return {
      logs: resultLogs,
      nextCursor,
      hasMore,
    };
  },
});

/**
 * Gets audit log statistics for monitoring
 */
export const getAuditLogStats = query({
  args: {
    timeRange: v.optional(v.number()), // Hours to look back
  },
  returns: v.object({
    totalEvents: v.number(),
    eventsByCategory: v.record(v.string(), v.number()),
    eventsBySeverity: v.record(v.string(), v.number()),
    failureRate: v.number(),
    topActors: v.array(
      v.object({
        userId: v.id("users"),
        eventCount: v.number(),
      }),
    ),
    recentSecurityEvents: v.number(),
  }),
  handler: async (ctx, { timeRange = 24 }) => {
    // Require admin access
    await assertOrgAccess(ctx, "admin");

    const cutoffTime = Date.now() - timeRange * 60 * 60 * 1000;

    // Get all logs in time range
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .filter((q) => q.gte(q.field("timestamp"), cutoffTime))
      .collect();

    // Calculate statistics
    const eventsByCategory: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};
    const actorCounts: Record<string, number> = {};
    let failureCount = 0;
    let securityEventCount = 0;

    for (const log of logs) {
      // Category stats
      const category = log.metadata?.category || "unknown";
      eventsByCategory[category] = (eventsByCategory[category] || 0) + 1;

      // Severity stats
      const severity = log.metadata?.severity || "unknown";
      eventsBySeverity[severity] = (eventsBySeverity[severity] || 0) + 1;

      // Actor stats
      if (log.actorUserId) {
        actorCounts[log.actorUserId] = (actorCounts[log.actorUserId] || 0) + 1;
      }

      // Failure rate
      if (!log.metadata?.success) {
        failureCount++;
      }

      // Security events
      if (category === AuditCategories.SECURITY_EVENT) {
        securityEventCount++;
      }
    }

    // Top actors
    const topActors = Object.entries(actorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userId, eventCount]) => ({
        userId: userId as Id<"users">,
        eventCount,
      }));

    return {
      totalEvents: logs.length,
      eventsByCategory,
      eventsBySeverity,
      failureRate: logs.length > 0 ? failureCount / logs.length : 0,
      topActors,
      recentSecurityEvents: securityEventCount,
    };
  },
});

/**
 * Exports audit logs for compliance reporting
 */
export const exportAuditLogs = query({
  args: {
    startTime: v.number(),
    endTime: v.number(),
    format: v.union(v.literal("json"), v.literal("csv")),
    includeMetadata: v.optional(v.boolean()),
  },
  returns: v.object({
    data: v.string(),
    recordCount: v.number(),
    exportedAt: v.number(),
  }),
  handler: async (
    ctx,
    { startTime, endTime, format, includeMetadata = true },
  ) => {
    // Require admin access
    await assertOrgAccess(ctx, "admin");

    // Get logs in time range
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .filter(
        (q) =>
          q.gte(q.field("timestamp"), startTime) &&
          q.lte(q.field("timestamp"), endTime),
      )
      .collect();

    let exportData: string;

    if (format === "csv") {
      // CSV format
      const headers = [
        "timestamp",
        "actorUserId",
        "resourceType",
        "resourceId",
        "action",
        "success",
      ];

      if (includeMetadata) {
        headers.push("metadata");
      }

      const csvRows = [headers.join(",")];

      for (const log of logs) {
        const row = [
          new Date(log.timestamp).toISOString(),
          log.actorUserId || "",
          log.resourceType,
          log.resourceId,
          log.action,
          log.metadata?.success?.toString() || "true",
        ];

        if (includeMetadata) {
          row.push(JSON.stringify(log.metadata).replace(/"/g, '""'));
        }

        csvRows.push(row.map((field) => `"${field}"`).join(","));
      }

      exportData = csvRows.join("\n");
    } else {
      // JSON format
      exportData = JSON.stringify(logs, null, 2);
    }

    return {
      data: exportData,
      recordCount: logs.length,
      exportedAt: Date.now(),
    };
  },
});
