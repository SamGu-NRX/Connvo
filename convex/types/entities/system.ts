/**
 * System Entity Type Definitions
 *
 * This module defines all system-related entity types including alerts,
 * performance metrics, audit logs, and feature flags.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling for system operations
 */

import type { Id } from "@convex/_generated/dataModel";

// Alert severity levels (matches schema exactly)
export type AlertSeverity = "critical" | "error" | "warning" | "info";

// Alert categories (matches schema exactly)
export type AlertCategory =
  | "meeting_lifecycle"
  | "video_provider"
  | "transcription"
  | "authentication"
  | "performance"
  | "security"
  | "system";

// Alert status (matches schema exactly)
export type AlertStatus = "active" | "acknowledged" | "resolved";

// Idempotency key entity (matches convex/schema/system.ts exactly)
export interface IdempotencyKey {
  _id: Id<"idempotencyKeys">;
  key: string;
  scope: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: number;
}

// Alert entity (matches schema exactly)
export interface Alert {
  _id: Id<"alerts">;
  alertId: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  metadata: Record<string, string | number | boolean>;
  actionable: boolean;
  status: AlertStatus;
  escalationTime?: number;
  createdAt: number;
  updatedAt: number;
}

// Performance metrics entity (matches schema exactly)
export interface PerformanceMetric {
  _id: Id<"performanceMetrics">;
  name: string;
  value: number;
  unit: string;
  labels: Record<string, string>;
  // Denormalized meetingId for efficient indexing
  meetingId?: string;
  threshold?: {
    warning: number;
    critical: number;
  };
  timestamp: number;
  createdAt: number;
}

// Rate limit entity (matches schema exactly)
export interface RateLimit {
  _id: Id<"rateLimits">;
  userId: Id<"users">;
  action: string;
  windowStartMs: number;
  count: number;
  createdAt: number;
  updatedAt: number;
}

// Audit log entity (matches schema exactly)
export interface AuditLog {
  _id: Id<"auditLogs">;
  actorUserId?: Id<"users">;
  resourceType: string;
  resourceId: string;
  action: string;
  metadata: Record<string, string | number | boolean>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: number;
}

// Feature flag entity (matches schema exactly)
export interface FeatureFlag {
  _id: Id<"featureFlags">;
  key: string;
  value: string | number | boolean; // Matches featureFlagValueV
  environment: string;
  rolloutPercentage: number;
  updatedBy: Id<"users">;
  createdAt: number;
  updatedAt: number;
}

// Derived types for API responses

// Alert with resolution details
export interface AlertWithResolution extends Alert {
  resolvedBy?: Id<"users">;
  resolvedAt?: number;
  resolutionNotes?: string;
  timeToResolve?: number;
}

// Performance metric with trend data
export interface PerformanceMetricWithTrend extends PerformanceMetric {
  trend: {
    direction: "up" | "down" | "stable";
    changePercent: number;
    previousValue: number;
    comparisonPeriod: number;
  };
  status: "normal" | "warning" | "critical";
}

// Audit log with user details
export interface AuditLogWithUser extends AuditLog {
  actor?: {
    _id: Id<"users">;
    displayName?: string;
    email?: string;
  };
}

// Feature flag with usage statistics
export interface FeatureFlagWithStats extends FeatureFlag {
  usageStats: {
    totalChecks: number;
    enabledChecks: number;
    uniqueUsers: number;
    lastCheckedAt?: number;
  };
}

// System health status
export interface SystemHealthStatus {
  overall: "healthy" | "degraded" | "critical";
  components: Array<{
    name: string;
    status: "healthy" | "degraded" | "critical";
    lastChecked: number;
    responseTime?: number;
    errorRate?: number;
    details?: string;
  }>;
  metrics: {
    uptime: number;
    responseTime: number;
    errorRate: number;
    throughput: number;
  };
  alerts: {
    critical: number;
    warning: number;
    total: number;
  };
  lastUpdated: number;
}

// System configuration
export interface SystemConfig {
  configKey: string;
  value: any;
  description: string;
  category: string;
  isSecret: boolean;
  environment: string;
  updatedBy: Id<"users">;
  updatedAt: number;
  version: number;
}

// System maintenance window
export interface MaintenanceWindow {
  windowId: string;
  title: string;
  description: string;
  scheduledStart: number;
  scheduledEnd: number;
  actualStart?: number;
  actualEnd?: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  affectedServices: string[];
  createdBy: Id<"users">;
  createdAt: number;
  updatedAt: number;
}
