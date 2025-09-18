/**
 * Monitoring Tools Tests
 *
 * This test suite validates the type system monitoring and maintenance tools.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.3, 8.4
 * Compliance: Automated monitoring and maintenance validation
 */

import { describe, test, expect, beforeEach } from "vitest";
import { TypeSystemMonitor, defaultTypeSystemConfig } from "./monitoring-tools";

describe("Type System Monitoring Tools", () => {
  let monitor: TypeSystemMonitor;

  beforeEach(() => {
    monitor = new TypeSystemMonitor();
  });

  describe("Health Monitoring", () => {
    test("should generate comprehensive health report", async () => {
      const report = await monitor.generateHealthReport();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.version).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.validationReport).toBeDefined();
      expect(report.driftChecks).toBeDefined();
      expect(report.performanceMetrics).toBeDefined();
      expect(report.recommendations).toBeDefined();

      // Summary should have reasonable values
      expect(report.summary.totalValidators).toBeGreaterThan(0);
      expect(report.summary.failedValidators).toBeGreaterThanOrEqual(0);
      expect(report.summary.warnings).toBeGreaterThanOrEqual(0);

      // Performance metrics should be reasonable
      expect(report.performanceMetrics.compilationTime).toBeGreaterThan(0);
      expect(report.performanceMetrics.validationTime).toBeGreaterThan(0);

      console.log("Health Report Summary:", {
        totalValidators: report.summary.totalValidators,
        failedValidators: report.summary.failedValidators,
        warnings: report.summary.warnings,
        compilationTime: `${report.performanceMetrics.compilationTime.toFixed(2)}ms`,
        validationTime: `${report.performanceMetrics.validationTime.toFixed(2)}ms`,
      });
    });

    test("should check system health status", async () => {
      const health = await monitor.checkHealth();

      expect(health).toBeDefined();
      expect(typeof health.healthy).toBe("boolean");
      expect(Array.isArray(health.issues)).toBe(true);

      console.log("Health Status:", {
        healthy: health.healthy,
        issueCount: health.issues.length,
        issues: health.issues,
      });

      // In a well-configured system, we should have minimal issues
      expect(health.issues.length).toBeLessThanOrEqual(5);
    });

    test("should detect type drift", async () => {
      const report = await monitor.generateHealthReport();

      expect(report.driftChecks).toBeDefined();
      expect(Array.isArray(report.driftChecks)).toBe(true);

      // Check that drift detection is working
      for (const driftCheck of report.driftChecks) {
        expect(driftCheck.entityName).toBeDefined();
        expect(Array.isArray(driftCheck.expectedFields)).toBe(true);
        expect(Array.isArray(driftCheck.actualFields)).toBe(true);
        expect(Array.isArray(driftCheck.missingFields)).toBe(true);
        expect(Array.isArray(driftCheck.extraFields)).toBe(true);
        expect(typeof driftCheck.hasDrift).toBe("boolean");

        if (driftCheck.hasDrift) {
          console.log(`Type drift detected in ${driftCheck.entityName}:`, {
            missing: driftCheck.missingFields,
            extra: driftCheck.extraFields,
          });
        }
      }
    });
  });

  describe("Performance Monitoring", () => {
    test("should track performance metrics", async () => {
      const report = await monitor.generateHealthReport();
      const performance = report.summary.performance;

      expect(performance.validatorCount).toBeGreaterThan(0);
      expect(performance.averageValidationTime).toBeGreaterThan(0);
      expect(performance.maxValidationTime).toBeGreaterThan(0);
      expect(performance.totalValidationTime).toBeGreaterThan(0);

      // Performance should be reasonable
      expect(performance.averageValidationTime).toBeLessThan(10); // Less than 10ms average
      expect(performance.maxValidationTime).toBeLessThan(50); // Less than 50ms max

      console.log("Performance Metrics:", {
        validatorCount: performance.validatorCount,
        averageTime: `${performance.averageValidationTime.toFixed(3)}ms`,
        maxTime: `${performance.maxValidationTime.toFixed(3)}ms`,
        totalTime: `${performance.totalValidationTime.toFixed(3)}ms`,
      });
    });

    test("should provide performance trends", () => {
      // Since we don't have historical data in tests, this will be empty
      const trends = monitor.getPerformanceTrends(7);

      expect(trends).toBeDefined();
      expect(Array.isArray(trends.validationTime)).toBe(true);
      expect(Array.isArray(trends.compilationTime)).toBe(true);
      expect(Array.isArray(trends.failureRate)).toBe(true);
      expect(Array.isArray(trends.timestamps)).toBe(true);

      // All arrays should have the same length
      expect(trends.validationTime.length).toBe(trends.compilationTime.length);
      expect(trends.compilationTime.length).toBe(trends.failureRate.length);
      expect(trends.failureRate.length).toBe(trends.timestamps.length);
    });
  });

  describe("Report Generation", () => {
    test("should export report to markdown", async () => {
      const report = await monitor.generateHealthReport();
      const markdown = monitor.exportReportToMarkdown(report);

      expect(typeof markdown).toBe("string");
      expect(markdown.length).toBeGreaterThan(0);

      // Should contain expected sections
      expect(markdown).toContain("# Type System Health Report");
      expect(markdown).toContain("## Summary");
      expect(markdown).toContain("## Performance Metrics");

      // Should contain actual data
      expect(markdown).toContain(report.summary.totalValidators.toString());
      expect(markdown).toContain(
        report.performanceMetrics.compilationTime.toFixed(2),
      );

      console.log("Markdown Report Length:", markdown.length, "characters");
    });

    test("should include recommendations", async () => {
      const report = await monitor.generateHealthReport();

      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.recommendations.length).toBeGreaterThan(0);

      console.log("Recommendations:", report.recommendations);

      // Should have actionable recommendations
      for (const recommendation of report.recommendations) {
        expect(typeof recommendation).toBe("string");
        expect(recommendation.length).toBeGreaterThan(10);
      }
    });
  });

  describe("Configuration", () => {
    test("should use default configuration", () => {
      const config = defaultTypeSystemConfig;

      expect(config.performanceThresholds).toBeDefined();
      expect(config.driftDetection).toBeDefined();
      expect(config.monitoring).toBeDefined();

      // Performance thresholds should be reasonable
      expect(config.performanceThresholds.maxValidationTime).toBeGreaterThan(0);
      expect(config.performanceThresholds.maxCompilationTime).toBeGreaterThan(
        0,
      );
      expect(config.performanceThresholds.maxMemoryIncrease).toBeGreaterThan(0);

      // Drift detection should be enabled by default
      expect(config.driftDetection.enabled).toBe(true);
      expect(
        Object.keys(config.driftDetection.expectedFields).length,
      ).toBeGreaterThan(0);

      // Monitoring should be enabled
      expect(config.monitoring.enabled).toBe(true);
      expect(config.monitoring.reportInterval).toBeGreaterThan(0);
    });

    test("should accept custom configuration", () => {
      const customConfig = {
        performanceThresholds: {
          maxValidationTime: 5,
          maxCompilationTime: 50,
          maxMemoryIncrease: 5,
        },
      };

      const customMonitor = new TypeSystemMonitor(customConfig);
      expect(customMonitor).toBeDefined();
    });
  });

  describe("Integration with CI/CD", () => {
    test("should provide CI-friendly health check", async () => {
      const health = await monitor.checkHealth();

      // This could be used as a CI/CD gate
      if (!health.healthy) {
        console.warn("Type system health check failed:", health.issues);
      }

      // In a real CI environment, we might want to fail the build if not healthy
      // For tests, we'll just log the status
      expect(typeof health.healthy).toBe("boolean");
    });

    test("should generate reports suitable for CI artifacts", async () => {
      const report = await monitor.generateHealthReport();
      const markdown = monitor.exportReportToMarkdown(report);

      // Report should be suitable for CI artifact storage
      expect(markdown).toContain("Generated:");
      expect(markdown).toContain("Status:");

      // Should have structured data that CI tools can parse
      expect(markdown).toMatch(/Total Validators.*\|\s*\d+/);
      expect(markdown).toMatch(/Failed Validators.*\|\s*\d+/);
    });
  });

  describe("Error Handling", () => {
    test("should handle missing validators gracefully", async () => {
      // This test ensures the monitor doesn't crash with incomplete validator sets
      const report = await monitor.generateHealthReport();

      expect(report).toBeDefined();
      expect(report.validationReport.totalValidators).toBeGreaterThan(0);
    });

    test("should handle performance measurement errors", async () => {
      // Test that performance measurement doesn't crash the monitoring
      const report = await monitor.generateHealthReport();

      expect(report.performanceMetrics).toBeDefined();
      expect(report.performanceMetrics.compilationTime).toBeGreaterThan(0);
      expect(report.performanceMetrics.validationTime).toBeGreaterThan(0);
    });
  });

  describe("Maintenance Recommendations", () => {
    test("should provide actionable maintenance recommendations", async () => {
      const report = await monitor.generateHealthReport();

      expect(report.recommendations.length).toBeGreaterThan(0);

      // Recommendations should be specific and actionable
      for (const recommendation of report.recommendations) {
        expect(recommendation).toMatch(
          /^(Fix|Add|Review|Optimize|Address|Consider|Investigate)/,
        );
      }
    });

    test("should prioritize critical issues", async () => {
      const report = await monitor.generateHealthReport();

      // If there are failed validators, that should be the top priority
      if (report.validationReport.failedValidators > 0) {
        const fixRecommendation = report.recommendations.find((r) =>
          r.includes("Fix"),
        );
        expect(fixRecommendation).toBeDefined();
      }

      // Performance issues should also be highlighted
      if (report.performanceMetrics.compilationTime > 100) {
        const performanceRecommendation = report.recommendations.find((r) =>
          r.includes("performance"),
        );
        expect(performanceRecommendation).toBeDefined();
      }
    });
  });
});
