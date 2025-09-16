/**
 * Alerting and Monitoring System
 *
 * This module provides comprehensive alerting, monitoring, and observability
 * for the meeting system with actionable traces and performance tracking.
 *
 * Requirements: 14.5, 6.5
 * Compliance: steering/convex_rules.mdc - Uses proper error handling patterns
 */

import { MutationCtx, ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

/**
 * Alert severity levels
 */
export type AlertSeverity = "critical" | "error" | "warning" | "info";

/**
 * Alert categories
 */
export type AlertCategory =
  | "meeting_lifecycle"
  | "video_provider"
  | "transcription"
  | "authentication"
  | "performance"
  | "security"
  | "system";

/**
 * Alert configuration
 */
export interface AlertConfig {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  actionable?: boolean;
  escalationTimeMs?: number;
}

/**
 * Performance metric
 */
export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  labels?: Record<string, string>;
  threshold?: {
    warning: number;
    critical: number;
  };
}

/**
 * System health status
 */
export interface SystemHealthStatus {
  overall: "healthy" | "degraded" | "unhealthy";
  components: Record<
    string,
    {
      status: "healthy" | "degraded" | "unhealthy";
      lastCheck: number;
      metrics?: Record<string, number>;
    }
  >;
  alerts: {
    critical: number;
    error: number;
    warning: number;
  };
}

/**
 * Sends an alert to the monitoring system
 */
export async function sendAlert(
  ctx: MutationCtx,
  config: AlertConfig,
): Promise<void> {
  const now = Date.now();

  // Store alert in database
  await ctx.db.insert("alerts", {
    alertId: config.id,
    severity: config.severity,
    category: config.category,
    title: config.title,
    message: config.message,
    metadata: config.metadata || {},
    actionable: config.actionable || false,
    status: "active",
    createdAt: now,
    updatedAt: now,
    escalationTime: config.escalationTimeMs
      ? now + config.escalationTimeMs
      : undefined,
  });

  // Log alert for immediate visibility
  console.log(
    `[ALERT:${config.severity.toUpperCase()}] ${config.title}: ${config.message}`,
    {
      category: config.category,
      metadata: config.metadata,
    },
  );

  // TODO: Integrate with external alerting systems (PagerDuty, Slack, etc.)
  if (config.severity === "critical") {
    await sendCriticalAlert(config);
  }
}

/**
 * Records a performance metric
 */
export async function recordPerformanceMetric(
  ctx: MutationCtx,
  metric: PerformanceMetric,
): Promise<void> {
  await ctx.db.insert("performanceMetrics", {
    name: metric.name,
    value: metric.value,
    unit: metric.unit,
    labels: metric.labels || {},
    meetingId: metric.labels?.meetingId, // Denormalized for indexing if present
    threshold: metric.threshold,
    timestamp: metric.timestamp,
    createdAt: Date.now(),
  });

  // Check thresholds and send alerts if needed
  if (metric.threshold) {
    if (metric.value >= metric.threshold.critical) {
      await sendAlert(ctx, {
        id: `metric_critical_${metric.name}_${Date.now()}`,
        severity: "critical",
        category: "performance",
        title: `Critical Performance Threshold Exceeded`,
        message: `${metric.name} is ${metric.value}${metric.unit}, exceeding critical threshold of ${metric.threshold.critical}${metric.unit}`,
        metadata: {
          metricName: metric.name,
          value: metric.value,
          threshold: metric.threshold.critical,
          labels: metric.labels,
        },
        actionable: true,
      });
    } else if (metric.value >= metric.threshold.warning) {
      await sendAlert(ctx, {
        id: `metric_warning_${metric.name}_${Date.now()}`,
        severity: "warning",
        category: "performance",
        title: `Performance Threshold Warning`,
        message: `${metric.name} is ${metric.value}${metric.unit}, exceeding warning threshold of ${metric.threshold.warning}${metric.unit}`,
        metadata: {
          metricName: metric.name,
          value: metric.value,
          threshold: metric.threshold.warning,
          labels: metric.labels,
        },
        actionable: false,
      });
    }
  }
}

/**
 * Tracks meeting lifecycle events for monitoring
 */
export async function trackMeetingEvent(
  ctx: MutationCtx,
  event: {
    meetingId: Id<"meetings">;
    event: string;
    userId?: Id<"users">;
    duration?: number;
    success: boolean;
    error?: string;
    metadata?: Record<string, any>;
  },
): Promise<void> {
  const now = Date.now();

  // Record the event
  await ctx.db.insert("meetingEvents", {
    meetingId: event.meetingId,
    event: event.event,
    userId: event.userId,
    duration: event.duration,
    success: event.success,
    error: event.error,
    metadata: event.metadata || {},
    timestamp: now,
    createdAt: now,
  });

  // Send alerts for failures
  if (!event.success && event.error) {
    const severity: AlertSeverity =
      event.event.includes("start") || event.event.includes("create")
        ? "critical"
        : "error";

    await sendAlert(ctx, {
      id: `meeting_event_failure_${event.meetingId}_${event.event}_${now}`,
      severity,
      category: "meeting_lifecycle",
      title: `Meeting ${event.event} Failed`,
      message: `Meeting ${event.meetingId} ${event.event} failed: ${event.error}`,
      metadata: {
        meetingId: event.meetingId,
        event: event.event,
        userId: event.userId,
        error: event.error,
        ...event.metadata,
      },
      actionable: true,
    });
  }

  // Track performance metrics
  if (event.duration) {
    await recordPerformanceMetric(ctx, {
      name: `meeting_${event.event}_duration`,
      value: event.duration,
      unit: "ms",
      timestamp: now,
      labels: {
        event: event.event,
        success: event.success.toString(),
      },
      threshold: {
        warning: 5000, // 5 seconds
        critical: 15000, // 15 seconds
      },
    });
  }
}

/**
 * Monitors WebRTC connection health
 */
export async function monitorWebRTCHealth(
  ctx: MutationCtx,
  data: {
    meetingId: Id<"meetings">;
    sessionId: string;
    userId: Id<"users">;
    connectionState: string;
    iceConnectionState: string;
    stats?: {
      bitrate: number;
      packetLoss: number;
      latency: number;
      jitter: number;
    };
  },
): Promise<void> {
  const now = Date.now();

  // Record connection health metrics
  if (data.stats) {
    const metrics = [
      { name: "webrtc_bitrate", value: data.stats.bitrate, unit: "bps" },
      { name: "webrtc_packet_loss", value: data.stats.packetLoss, unit: "%" },
      { name: "webrtc_latency", value: data.stats.latency, unit: "ms" },
      { name: "webrtc_jitter", value: data.stats.jitter, unit: "ms" },
    ];

    for (const metric of metrics) {
      await recordPerformanceMetric(ctx, {
        ...metric,
        timestamp: now,
        labels: {
          meetingId: data.meetingId,
          sessionId: data.sessionId,
          userId: data.userId,
        },
        threshold: getWebRTCThresholds(metric.name),
      });
    }
  }

  // Alert on connection failures
  if (
    data.connectionState === "failed" ||
    data.iceConnectionState === "failed"
  ) {
    await sendAlert(ctx, {
      id: `webrtc_connection_failed_${data.sessionId}_${now}`,
      severity: "error",
      category: "video_provider",
      title: "WebRTC Connection Failed",
      message: `WebRTC connection failed for session ${data.sessionId} in meeting ${data.meetingId}`,
      metadata: {
        meetingId: data.meetingId,
        sessionId: data.sessionId,
        userId: data.userId,
        connectionState: data.connectionState,
        iceConnectionState: data.iceConnectionState,
        stats: data.stats,
      },
      actionable: true,
    });
  }
}

/**
 * Gets system health status
 */
export async function getSystemHealth(
  ctx: MutationCtx,
): Promise<SystemHealthStatus> {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Get recent alerts
  const recentAlerts = await ctx.db
    .query("alerts")
    .withIndex("by_status_and_created_at", (q) =>
      q.eq("status", "active").gt("createdAt", oneHourAgo),
    )
    .collect();

  const alertCounts = {
    critical: recentAlerts.filter((a) => a.severity === "critical").length,
    error: recentAlerts.filter((a) => a.severity === "error").length,
    warning: recentAlerts.filter((a) => a.severity === "warning").length,
  };

  // Get recent performance metrics
  const recentMetrics = await ctx.db
    .query("performanceMetrics")
    .withIndex("by_timestamp", (q) => q.gt("timestamp", oneHourAgo))
    .collect();

  // Analyze component health
  const components = {
    meetings: analyzeComponentHealth("meeting", recentAlerts, recentMetrics),
    webrtc: analyzeComponentHealth("webrtc", recentAlerts, recentMetrics),
    transcription: analyzeComponentHealth(
      "transcription",
      recentAlerts,
      recentMetrics,
    ),
    authentication: analyzeComponentHealth("auth", recentAlerts, recentMetrics),
  };

  // Determine overall health
  const hasUnhealthyComponents = Object.values(components).some(
    (c) => c.status === "unhealthy",
  );
  const hasDegradedComponents = Object.values(components).some(
    (c) => c.status === "degraded",
  );

  let overall: "healthy" | "degraded" | "unhealthy";
  if (hasUnhealthyComponents || alertCounts.critical > 0) {
    overall = "unhealthy";
  } else if (hasDegradedComponents || alertCounts.error > 5) {
    overall = "degraded";
  } else {
    overall = "healthy";
  }

  return {
    overall,
    components,
    alerts: alertCounts,
  };
}

/**
 * Helper function to analyze component health
 */
function analyzeComponentHealth(
  component: string,
  alerts: any[],
  metrics: any[],
): {
  status: "healthy" | "degraded" | "unhealthy";
  lastCheck: number;
  metrics?: Record<string, number>;
} {
  const componentAlerts = alerts.filter(
    (a) =>
      a.category.includes(component) ||
      a.title.toLowerCase().includes(component) ||
      a.message.toLowerCase().includes(component),
  );

  const criticalAlerts = componentAlerts.filter(
    (a) => a.severity === "critical",
  );
  const errorAlerts = componentAlerts.filter((a) => a.severity === "error");

  let status: "healthy" | "degraded" | "unhealthy";
  if (criticalAlerts.length > 0) {
    status = "unhealthy";
  } else if (errorAlerts.length > 2) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  // Get relevant metrics
  const componentMetrics = metrics.filter((m) => m.name.includes(component));
  const metricsMap: Record<string, number> = {};

  for (const metric of componentMetrics) {
    metricsMap[metric.name] = metric.value;
  }

  return {
    status,
    lastCheck: Date.now(),
    metrics: Object.keys(metricsMap).length > 0 ? metricsMap : undefined,
  };
}

/**
 * Gets WebRTC performance thresholds
 */
function getWebRTCThresholds(
  metricName: string,
): { warning: number; critical: number } | undefined {
  const thresholds: Record<string, { warning: number; critical: number }> = {
    webrtc_packet_loss: { warning: 2, critical: 5 },
    webrtc_latency: { warning: 150, critical: 300 },
    webrtc_jitter: { warning: 30, critical: 50 },
    webrtc_bitrate: { warning: 100000, critical: 50000 }, // Lower is worse for bitrate
  };

  return thresholds[metricName];
}

/**
 * Sends critical alert to external systems
 */
async function sendCriticalAlert(config: AlertConfig): Promise<void> {
  // TODO: Integrate with external alerting systems
  console.error(`[CRITICAL ALERT] ${config.title}`, {
    message: config.message,
    metadata: config.metadata,
  });

  // In a real implementation, this would:
  // - Send to PagerDuty
  // - Post to Slack
  // - Send email notifications
  // - Trigger SMS alerts
}

/**
 * Predefined alert templates
 */
export const AlertTemplates = {
  meetingCreationFailed: (meetingId: string, error: string): AlertConfig => ({
    id: `meeting_creation_failed_${meetingId}_${Date.now()}`,
    severity: "critical",
    category: "meeting_lifecycle",
    title: "Meeting Creation Failed",
    message: `Failed to create meeting ${meetingId}: ${error}`,
    metadata: { meetingId, error },
    actionable: true,
    escalationTimeMs: 5 * 60 * 1000, // 5 minutes
  }),

  videoProviderDown: (provider: string, error: string): AlertConfig => ({
    id: `video_provider_down_${provider}_${Date.now()}`,
    severity: "critical",
    category: "video_provider",
    title: `Video Provider ${provider} Down`,
    message: `Video provider ${provider} is experiencing issues: ${error}`,
    metadata: { provider, error },
    actionable: true,
    escalationTimeMs: 2 * 60 * 1000, // 2 minutes
  }),

  highLatency: (service: string, latency: number): AlertConfig => ({
    id: `high_latency_${service}_${Date.now()}`,
    severity: "warning",
    category: "performance",
    title: `High Latency Detected`,
    message: `${service} is experiencing high latency: ${latency}ms`,
    metadata: { service, latency },
    actionable: false,
  }),

  authenticationFailure: (userId: string, reason: string): AlertConfig => ({
    id: `auth_failure_${userId}_${Date.now()}`,
    severity: "error",
    category: "authentication",
    title: "Authentication Failure",
    message: `Authentication failed for user ${userId}: ${reason}`,
    metadata: { userId, reason },
    actionable: true,
  }),
};
