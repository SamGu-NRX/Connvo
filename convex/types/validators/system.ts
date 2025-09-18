/**
 * System Validators
 *
 * This module provides Convex validators that correspond to the System entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns for system operations
 */

import { v } from "convex/values";
import type {
  IdempotencyKey,
  Alert,
  PerformanceMetric,
  RateLimit,
  AuditLog,
  FeatureFlag,
  AlertWithResolution,
  PerformanceMetricWithTrend,
  AuditLogWithUser,
  FeatureFlagWithStats,
  SystemHealthStatus,
  SystemConfig,
  MaintenanceWindow,
} from "../entities/system";

// Alert severity validator
const alertSeverityV = v.union(
  v.literal("critical"),
  v.literal("error"),
  v.literal("warning"),
  v.literal("info"),
);

// Alert category validator
const alertCategoryV = v.union(
  v.literal("meeting_lifecycle"),
  v.literal("video_provider"),
  v.literal("transcription"),
  v.literal("authentication"),
  v.literal("performance"),
  v.literal("security"),
  v.literal("system"),
);

// Alert status validator
const alertStatusV = v.union(
  v.literal("active"),
  v.literal("acknowledged"),
  v.literal("resolved"),
);

// Metadata validator (matches lib/validators.ts)
const metadataRecordV = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

// Labels validator (matches lib/validators.ts)
const labelsRecordV = v.record(v.string(), v.string());

// Feature flag value validator (matches lib/validators.ts)
const featureFlagValueV = v.union(v.string(), v.number(), v.boolean());

// Core System validators (matches schema exactly)
export const IdempotencyKeyV = {
  full: v.object({
    _id: v.id("idempotencyKeys"),
    key: v.string(),
    scope: v.string(),
    metadata: v.optional(metadataRecordV),
    createdAt: v.number(),
  }),
} as const;

// Alert validators (matches schema exactly)
export const AlertV = {
  // Full alert entity
  full: v.object({
    _id: v.id("alerts"),
    alertId: v.string(),
    severity: alertSeverityV,
    category: alertCategoryV,
    title: v.string(),
    message: v.string(),
    metadata: metadataRecordV,
    actionable: v.boolean(),
    status: alertStatusV,
    escalationTime: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  // Alert with resolution details
  withResolution: v.object({
    _id: v.id("alerts"),
    alertId: v.string(),
    severity: alertSeverityV,
    category: alertCategoryV,
    title: v.string(),
    message: v.string(),
    metadata: metadataRecordV,
    actionable: v.boolean(),
    status: alertStatusV,
    escalationTime: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    resolutionNotes: v.optional(v.string()),
    timeToResolve: v.optional(v.number()),
  }),
} as const;

// Performance Metric validators (matches schema exactly)
export const PerformanceMetricV = {
  // Full metric entity
  full: v.object({
    _id: v.id("performanceMetrics"),
    name: v.string(),
    value: v.number(),
    unit: v.string(),
    labels: labelsRecordV,
    // Denormalized meetingId for efficient indexing
    meetingId: v.optional(v.string()),
    threshold: v.optional(
      v.object({
        warning: v.number(),
        critical: v.number(),
      }),
    ),
    timestamp: v.number(),
    createdAt: v.number(),
  }),

  // Metric with trend data
  withTrend: v.object({
    _id: v.id("performanceMetrics"),
    name: v.string(),
    value: v.number(),
    unit: v.string(),
    labels: labelsRecordV,
    meetingId: v.optional(v.string()),
    threshold: v.optional(
      v.object({
        warning: v.number(),
        critical: v.number(),
      }),
    ),
    timestamp: v.number(),
    createdAt: v.number(),
    trend: v.object({
      direction: v.union(
        v.literal("up"),
        v.literal("down"),
        v.literal("stable"),
      ),
      changePercent: v.number(),
      previousValue: v.number(),
      comparisonPeriod: v.number(),
    }),
    status: v.union(
      v.literal("normal"),
      v.literal("warning"),
      v.literal("critical"),
    ),
  }),
} as const;

// Rate Limit validators (matches schema exactly)
export const RateLimitV = {
  full: v.object({
    _id: v.id("rateLimits"),
    userId: v.id("users"),
    action: v.string(),
    windowStartMs: v.number(),
    count: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// Audit Log validators (matches schema exactly)
export const AuditLogV = {
  // Full audit log entity
  full: v.object({
    _id: v.id("auditLogs"),
    actorUserId: v.optional(v.id("users")),
    resourceType: v.string(),
    resourceId: v.string(),
    action: v.string(),
    metadata: metadataRecordV,
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    timestamp: v.number(),
  }),

  // Audit log with user details
  withUser: v.object({
    _id: v.id("auditLogs"),
    actorUserId: v.optional(v.id("users")),
    resourceType: v.string(),
    resourceId: v.string(),
    action: v.string(),
    metadata: metadataRecordV,
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    timestamp: v.number(),
    actor: v.optional(
      v.object({
        _id: v.id("users"),
        displayName: v.optional(v.string()),
        email: v.optional(v.string()),
      }),
    ),
  }),
} as const;

// Feature Flag validators (matches schema exactly)
export const FeatureFlagV = {
  // Full feature flag entity
  full: v.object({
    _id: v.id("featureFlags"),
    key: v.string(),
    value: featureFlagValueV,
    environment: v.string(),
    rolloutPercentage: v.number(),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  // Feature flag with usage statistics
  withStats: v.object({
    _id: v.id("featureFlags"),
    key: v.string(),
    value: featureFlagValueV,
    environment: v.string(),
    rolloutPercentage: v.number(),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    usageStats: v.object({
      totalChecks: v.number(),
      enabledChecks: v.number(),
      uniqueUsers: v.number(),
      lastCheckedAt: v.optional(v.number()),
    }),
  }),
} as const;

// System Health Status validators
export const SystemHealthStatusV = {
  full: v.object({
    overall: v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("critical"),
    ),
    components: v.array(
      v.object({
        name: v.string(),
        status: v.union(
          v.literal("healthy"),
          v.literal("degraded"),
          v.literal("critical"),
        ),
        lastChecked: v.number(),
        responseTime: v.optional(v.number()),
        errorRate: v.optional(v.number()),
        details: v.optional(v.string()),
      }),
    ),
    metrics: v.object({
      uptime: v.number(),
      responseTime: v.number(),
      errorRate: v.number(),
      throughput: v.number(),
    }),
    alerts: v.object({
      critical: v.number(),
      warning: v.number(),
      total: v.number(),
    }),
    lastUpdated: v.number(),
  }),
} as const;

// System Config validators
export const SystemConfigV = {
  full: v.object({
    configKey: v.string(),
    value: v.any(),
    description: v.string(),
    category: v.string(),
    isSecret: v.boolean(),
    environment: v.string(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    version: v.number(),
  }),
} as const;

// Maintenance Window validators
export const MaintenanceWindowV = {
  full: v.object({
    windowId: v.string(),
    title: v.string(),
    description: v.string(),
    scheduledStart: v.number(),
    scheduledEnd: v.number(),
    actualStart: v.optional(v.number()),
    actualEnd: v.optional(v.number()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    affectedServices: v.array(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

/**
 * Aggregated export for system validators to offer a backward-compatible namespace.
 */
export const SystemV = {
  alertSeverity: alertSeverityV,
  alertCategory: alertCategoryV,
  alertStatus: alertStatusV,
  metadata: metadataRecordV,
  labels: labelsRecordV,
  featureFlagValue: featureFlagValueV,
  idempotencyKey: IdempotencyKeyV,
  alert: AlertV,
  performanceMetric: PerformanceMetricV,
  rateLimit: RateLimitV,
  auditLog: AuditLogV,
  featureFlag: FeatureFlagV,
  healthStatus: SystemHealthStatusV,
  config: SystemConfigV,
  maintenanceWindow: MaintenanceWindowV,
} as const;
