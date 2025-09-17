/**
 * Monitoring and Alerting System
 *
 * This module provides comprehensive monitoring, metrics collection,
 * and alerting for the Convex backend.
 *
 * Requirements: 6.5, 14.1, 14.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { MutationCtx } from "@convex/_generated/server";
import type { AlertSeverity } from "@convex/types/entities/system";

/**
 * Metric types for monitoring
 */
export type MetricType = "counter" | "gauge" | "histogram" | "timer";

/**
 * Runtime performance metric payload recorded for observability dashboards.
 */
export interface PerformanceMetric {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
  timestamp: number;
}

/**
 * Alert notification payload used by monitoring helpers.
 */
export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  metadata?: Record<string, string | number | boolean>;
  timestamp: number;
}

/**
 * Records a performance metric
 */
export async function recordMetric(
  ctx: MutationCtx,
  metric: PerformanceMetric,
): Promise<void> {
  // In a real implementation, this would send to a metrics service
  // For now, we'll log to console and store in audit logs
  console.log(
    `METRIC [${metric.type}] ${metric.name}: ${metric.value}`,
    metric.labels,
  );

  try {
    const { logAudit } = await import("@convex/lib/audit");
    await logAudit(ctx, {
      resourceType: "system",
      resourceId: "metrics",
      action: "metric_recorded",
      category: "meeting",
      success: true,
      metadata: {
        metric: metric.name,
        type: metric.type,
        value: metric.value,
        ...formatLabelMetadata(metric.labels),
      },
    });
  } catch (error) {
    console.error("Failed to record metric:", error);
  }
}

/**
 * Sends an alert
 */
export async function sendAlert(ctx: MutationCtx, alert: Alert): Promise<void> {
  // In a real implementation, this would send to alerting services
  // (PagerDuty, Slack, email, etc.)
  console.error(
    `ALERT [${alert.severity}] ${alert.title}: ${alert.message}`,
    alert.metadata,
  );

  try {
    const { logAudit } = await import("@convex/lib/audit");
    await logAudit(ctx, {
      resourceType: "system",
      resourceId: "alerts",
      action: "alert_sent",
      category: "meeting",
      success: true,
      metadata: {
        alertId: alert.id,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        source: alert.source,
        ...alert.metadata,
      },
    });
  } catch (error) {
    console.error("Failed to record alert:", error);
  }
}

/**
 * Wrapper for timing function execution
 */
export async function withTiming<T>(
  ctx: MutationCtx,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  let success = false;
  let error: Error | null = null;

  try {
    const result = await fn();
    success = true;
    return result;
  } catch (err) {
    error = err as Error;
    throw err;
  } finally {
    const duration = Date.now() - startTime;

    // Record timing metric
    await recordMetric(ctx, {
      name: "function_duration_ms",
      type: "histogram",
      value: duration,
      labels: {
        operation,
        success: success.toString(),
        error_type: error?.constructor.name || "none",
      },
      timestamp: Date.now(),
    });

    // Alert on slow operations
    if (duration > 5000) {
      // 5 seconds
      await sendAlert(ctx, {
        id: `slow_operation_${Date.now()}`,
        severity: duration > 10000 ? "error" : "warning",
        title: "Slow Operation Detected",
        message: `Operation ${operation} took ${duration}ms`,
        source: "performance_monitor",
        metadata: {
          operation,
          duration,
          success,
          error: error?.message ?? "",
        },
        timestamp: Date.now(),
      });
    }

    // Alert on errors
    if (error) {
      await sendAlert(ctx, {
        id: `operation_error_${Date.now()}`,
        severity: "error",
        title: "Operation Failed",
        message: `Operation ${operation} failed: ${error.message}`,
        source: "error_monitor",
        metadata: {
          operation,
          duration,
          error: error.message,
          stack: error.stack ?? "",
        },
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Monitors Stream API health
 */
export async function monitorStreamHealth(
  ctx: MutationCtx,
  operation: string,
  success: boolean,
  responseTime?: number,
  error?: string,
): Promise<void> {
  // Record Stream API metrics
  await recordMetric(ctx, {
    name: "stream_api_requests",
    type: "counter",
    value: 1,
    labels: {
      operation,
      success: success.toString(),
    },
    timestamp: Date.now(),
  });

  if (responseTime) {
    await recordMetric(ctx, {
      name: "stream_api_response_time_ms",
      type: "histogram",
      value: responseTime,
      labels: {
        operation,
      },
      timestamp: Date.now(),
    });
  }

  // Alert on Stream API failures
  if (!success) {
    await sendAlert(ctx, {
      id: `stream_api_error_${Date.now()}`,
      severity: "error",
      title: "Stream API Error",
      message: `Stream ${operation} failed${error ? `: ${error}` : ""}`,
      source: "stream_monitor",
      metadata: {
        operation,
        error: error ?? "",
        responseTime: responseTime ?? 0,
      },
      timestamp: Date.now(),
    });
  }

  // Alert on slow Stream API responses
  if (responseTime && responseTime > 3000) {
    await sendAlert(ctx, {
      id: `stream_api_slow_${Date.now()}`,
      severity: "warning",
      title: "Slow Stream API Response",
      message: `Stream ${operation} took ${responseTime}ms`,
      source: "stream_monitor",
      metadata: {
        operation,
        responseTime,
      },
      timestamp: Date.now(),
    });
  }
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: "closed" | "open" | "half-open";
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

/**
 * Circuit breaker implementation
 */
export async function withCircuitBreaker<T>(
  operation: string,
  fn: () => Promise<T>,
  options: {
    failureThreshold?: number;
    timeoutMs?: number;
    resetTimeoutMs?: number;
  } = {},
): Promise<T> {
  const {
    failureThreshold = 5,
    timeoutMs = 10000,
    resetTimeoutMs = 60000,
  } = options;

  const state = circuitBreakers.get(operation) || {
    failures: 0,
    lastFailureTime: 0,
    state: "closed" as const,
  };

  // Check if circuit is open
  if (state.state === "open") {
    if (Date.now() - state.lastFailureTime > resetTimeoutMs) {
      state.state = "half-open";
      state.failures = 0;
    } else {
      throw new Error(`Circuit breaker open for ${operation}`);
    }
  }

  try {
    // Add timeout
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Operation timeout")), timeoutMs),
      ),
    ]);

    // Success - reset circuit breaker
    if (state.state === "half-open") {
      state.state = "closed";
      state.failures = 0;
    }

    circuitBreakers.set(operation, state);
    return result;
  } catch (error) {
    // Failure - increment counter
    state.failures++;
    state.lastFailureTime = Date.now();

    if (state.failures >= failureThreshold) {
      state.state = "open";
    }

    circuitBreakers.set(operation, state);
    throw error;
  }
}

/**
 * Rate limiter implementation
 */
const rateLimiters = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number = 60000,
): boolean {
  const now = Date.now();
  const limiter = rateLimiters.get(key);

  if (!limiter || now > limiter.resetTime) {
    rateLimiters.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (limiter.count >= limit) {
    return false;
  }

  limiter.count++;
  return true;
}

/**
 * Health check utilities
 */
export interface HealthCheck {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  responseTime?: number;
  error?: string;
  timestamp: number;
}

function formatLabelMetadata(
  labels?: Record<string, string>,
): Record<string, string> {
  if (!labels) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(labels).map(([key, value]) => [`label.${key}`, value]),
  );
}

export async function performHealthCheck(
  service: string,
  checkFn: () => Promise<void>,
): Promise<HealthCheck> {
  const startTime = Date.now();

  try {
    await checkFn();
    return {
      service,
      status: "healthy",
      responseTime: Date.now() - startTime,
      timestamp: Date.now(),
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      service,
      status: responseTime > 5000 ? "unhealthy" : "degraded",
      responseTime,
      error: (error as Error).message,
      timestamp: Date.now(),
    };
  }
}
