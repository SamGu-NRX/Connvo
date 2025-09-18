/**
 * Type System Monitoring and Maintenance Tools
 *
 * This module provides tools for monitoring type consistency, detecting drift,
 * and maintaining the centralized type system over time.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.3, 8.4
 * Compliance: Automated monitoring and maintenance for type system health
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  generateCIValidationReport,
  detectTypeDrift,
  exploreValidatorStructure,
  measureValidatorPerformance,
  type CIValidationReport,
  type TypeDriftCheck,
  type TypePerformanceMetrics,
} from "./type-validation-utils";

// Import all validator collections
import { UserV, MeetingV, TranscriptV } from "../validators";
import { CommonV } from "../validators/common";
import { PaginationV } from "../validators/pagination";

export interface TypeSystemHealthReport {
  timestamp: number;
  version: string;
  summary: {
    totalValidators: number;
    failedValidators: number;
    warnings: number;
    performance: TypePerformanceMetrics;
  };
  validationReport: CIValidationReport;
  driftChecks: TypeDriftCheck[];
  performanceMetrics: {
    compilationTime: number;
    validationTime: number;
    memoryUsage?: number;
  };
  recommendations: string[];
}

export interface TypeSystemConfig {
  performanceThresholds: {
    maxValidationTime: number; // ms
    maxCompilationTime: number; // ms
    maxMemoryIncrease: number; // MB
  };
  driftDetection: {
    enabled: boolean;
    expectedFields: Record<string, string[]>;
  };
  monitoring: {
    enabled: boolean;
    reportInterval: number; // hours
    alertThresholds: {
      failureRate: number; // percentage
      performanceDegradation: number; // percentage
    };
  };
}

const DEFAULT_CONFIG: TypeSystemConfig = {
  performanceThresholds: {
    maxValidationTime: 10, // 10ms
    maxCompilationTime: 100, // 100ms
    maxMemoryIncrease: 10, // 10MB
  },
  driftDetection: {
    enabled: true,
    expectedFields: {
      User: [
        "_id",
        "_creationTime",
        "workosUserId",
        "email",
        "orgId",
        "orgRole",
        "displayName",
        "avatarUrl",
        "isActive",
        "lastSeenAt",
        "onboardingComplete",
        "onboardingStartedAt",
        "onboardingCompletedAt",
        "createdAt",
        "updatedAt",
      ],
      Meeting: [
        "_id",
        "_creationTime",
        "organizerId",
        "title",
        "description",
        "scheduledAt",
        "duration",
        "webrtcEnabled",
        "streamRoomId",
        "state",
        "participantCount",
        "averageRating",
        "createdAt",
        "updatedAt",
      ],
      Transcript: [
        "_id",
        "_creationTime",
        "meetingId",
        "bucketMs",
        "sequence",
        "speakerId",
        "text",
        "confidence",
        "startMs",
        "endMs",
        "isInterim",
        "wordCount",
        "language",
        "createdAt",
      ],
    },
  },
  monitoring: {
    enabled: true,
    reportInterval: 24, // 24 hours
    alertThresholds: {
      failureRate: 5, // 5%
      performanceDegradation: 50, // 50%
    },
  },
};

/**
 * Type System Monitor Class
 * Provides comprehensive monitoring and maintenance capabilities
 */
export class TypeSystemMonitor {
  private config: TypeSystemConfig;
  private reportHistory: TypeSystemHealthReport[] = [];

  constructor(config: Partial<TypeSystemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadReportHistory();
  }

  /**
   * Generate a comprehensive health report
   */
  async generateHealthReport(): Promise<TypeSystemHealthReport> {
    const startTime = performance.now();

    // Collect all validators
    const validatorCollections = {
      UserV,
      MeetingV,
      TranscriptV,
      CommonV,
      PaginationV,
    };

    // Generate validation report
    const validationReport = generateCIValidationReport(validatorCollections);

    // Perform drift detection
    const driftChecks: TypeDriftCheck[] = [];
    if (this.config.driftDetection.enabled) {
      for (const [entityName, expectedFields] of Object.entries(
        this.config.driftDetection.expectedFields,
      )) {
        const validator = this.getValidatorForEntity(entityName);
        if (validator) {
          const driftCheck = detectTypeDrift(
            validator,
            expectedFields,
            entityName,
          );
          driftChecks.push(driftCheck);
        }
      }
    }

    // Measure performance
    const allValidators = Object.values(validatorCollections)
      .flatMap((collection) => Object.values(collection))
      .filter((v) => v && typeof v === "object" && v.kind);

    const performanceMetrics = measureValidatorPerformance(
      allValidators.map((validator, index) => ({
        name: `validator_${index}`,
        validator,
      })),
    );

    const endTime = performance.now();
    const compilationTime = endTime - startTime;

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      validationReport,
      driftChecks,
      performanceMetrics,
    );

    const report: TypeSystemHealthReport = {
      timestamp: Date.now(),
      version: this.getTypeSystemVersion(),
      summary: {
        totalValidators: validationReport.totalValidators,
        failedValidators: validationReport.failedValidators,
        warnings: validationReport.warnings.length,
        performance: performanceMetrics,
      },
      validationReport,
      driftChecks,
      performanceMetrics: {
        compilationTime,
        validationTime: performanceMetrics.totalValidationTime,
      },
      recommendations,
    };

    // Store report in history
    this.reportHistory.push(report);
    this.saveReportHistory();

    return report;
  }

  /**
   * Check if the type system is healthy
   */
  async checkHealth(): Promise<{ healthy: boolean; issues: string[] }> {
    const report = await this.generateHealthReport();
    const issues: string[] = [];

    // Check validation failures
    if (report.validationReport.failedValidators > 0) {
      issues.push(
        `${report.validationReport.failedValidators} validators failed validation`,
      );
    }

    // Check performance thresholds
    if (
      report.performanceMetrics.compilationTime >
      this.config.performanceThresholds.maxCompilationTime
    ) {
      issues.push(
        `Compilation time (${report.performanceMetrics.compilationTime.toFixed(2)}ms) exceeds threshold`,
      );
    }

    if (
      report.performanceMetrics.validationTime >
      this.config.performanceThresholds.maxValidationTime
    ) {
      issues.push(
        `Validation time (${report.performanceMetrics.validationTime.toFixed(2)}ms) exceeds threshold`,
      );
    }

    // Check for type drift
    const driftIssues = report.driftChecks.filter((check) => check.hasDrift);
    if (driftIssues.length > 0) {
      issues.push(`Type drift detected in ${driftIssues.length} entities`);
    }

    return {
      healthy: issues.length === 0,
      issues,
    };
  }

  /**
   * Generate maintenance recommendations
   */
  private generateRecommendations(
    validationReport: CIValidationReport,
    driftChecks: TypeDriftCheck[],
    performanceMetrics: TypePerformanceMetrics,
  ): string[] {
    const recommendations: string[] = [];

    // Validation recommendations
    if (validationReport.failedValidators > 0) {
      recommendations.push(
        `Fix ${validationReport.failedValidators} failed validators`,
      );
    }

    if (validationReport.warnings.length > 5) {
      recommendations.push(
        `Address ${validationReport.warnings.length} warnings to improve code quality`,
      );
    }

    // Performance recommendations
    if (performanceMetrics.averageValidationTime > 5) {
      recommendations.push(
        `Optimize validator performance (current avg: ${performanceMetrics.averageValidationTime.toFixed(2)}ms)`,
      );
    }

    if (performanceMetrics.maxValidationTime > 20) {
      recommendations.push(
        `Investigate slow validators (max: ${performanceMetrics.maxValidationTime.toFixed(2)}ms)`,
      );
    }

    // Drift recommendations
    const driftedEntities = driftChecks.filter((check) => check.hasDrift);
    for (const drift of driftedEntities) {
      if (drift.missingFields.length > 0) {
        recommendations.push(
          `Add missing fields to ${drift.entityName}: ${drift.missingFields.join(", ")}`,
        );
      }
      if (drift.extraFields.length > 0) {
        recommendations.push(
          `Review extra fields in ${drift.entityName}: ${drift.extraFields.join(", ")}`,
        );
      }
    }

    // General recommendations
    if (recommendations.length === 0) {
      recommendations.push(
        "Type system is healthy! Consider adding more comprehensive tests.",
      );
    }

    return recommendations;
  }

  /**
   * Get validator for entity name
   */
  private getValidatorForEntity(entityName: string): any {
    switch (entityName) {
      case "User":
        return UserV.full;
      case "Meeting":
        return MeetingV.full;
      case "Transcript":
        return TranscriptV.full;
      default:
        return null;
    }
  }

  /**
   * Get type system version (could be from package.json or git)
   */
  private getTypeSystemVersion(): string {
    try {
      const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
      return packageJson.version || "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Load report history from disk
   */
  private loadReportHistory(): void {
    const historyPath = join(
      process.cwd(),
      ".kiro",
      "type-system-reports.json",
    );
    if (existsSync(historyPath)) {
      try {
        const data = readFileSync(historyPath, "utf-8");
        this.reportHistory = JSON.parse(data);
      } catch (error) {
        console.warn("Failed to load report history:", error);
        this.reportHistory = [];
      }
    }
  }

  /**
   * Save report history to disk
   */
  private saveReportHistory(): void {
    const historyPath = join(
      process.cwd(),
      ".kiro",
      "type-system-reports.json",
    );

    // Keep only last 100 reports
    const recentReports = this.reportHistory.slice(-100);

    try {
      writeFileSync(historyPath, JSON.stringify(recentReports, null, 2));
    } catch (error) {
      console.warn("Failed to save report history:", error);
    }
  }

  /**
   * Get performance trends over time
   */
  getPerformanceTrends(days: number = 7): {
    validationTime: number[];
    compilationTime: number[];
    failureRate: number[];
    timestamps: number[];
  } {
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const recentReports = this.reportHistory.filter(
      (report) => report.timestamp > cutoffTime,
    );

    return {
      validationTime: recentReports.map(
        (r) => r.performanceMetrics.validationTime,
      ),
      compilationTime: recentReports.map(
        (r) => r.performanceMetrics.compilationTime,
      ),
      failureRate: recentReports.map(
        (r) =>
          (r.validationReport.failedValidators /
            r.validationReport.totalValidators) *
          100,
      ),
      timestamps: recentReports.map((r) => r.timestamp),
    };
  }

  /**
   * Export health report to markdown
   */
  exportReportToMarkdown(report: TypeSystemHealthReport): string {
    const date = new Date(report.timestamp).toISOString();

    let markdown = `# Type System Health Report

**Generated:** ${date}
**Version:** ${report.version}
**Status:** ${report.validationReport.passed ? "✅ HEALTHY" : "❌ ISSUES DETECTED"}

## Summary

| Metric | Value |
|--------|-------|
| Total Validators | ${report.summary.totalValidators} |
| Failed Validators | ${report.summary.failedValidators} |
| Warnings | ${report.summary.warnings} |
| Compilation Time | ${report.performanceMetrics.compilationTime.toFixed(2)}ms |
| Validation Time | ${report.performanceMetrics.validationTime.toFixed(2)}ms |

## Performance Metrics

| Metric | Value |
|--------|-------|
| Average Validation Time | ${report.summary.performance.averageValidationTime.toFixed(2)}ms |
| Maximum Validation Time | ${report.summary.performance.maxValidationTime.toFixed(2)}ms |
| Total Validation Time | ${report.summary.performance.totalValidationTime.toFixed(2)}ms |
| Validator Count | ${report.summary.performance.validatorCount} |

`;

    if (report.validationReport.errors.length > 0) {
      markdown += `## ❌ Errors

`;
      report.validationReport.errors.forEach((error, index) => {
        markdown += `${index + 1}. ${error}\n`;
      });
      markdown += "\n";
    }

    if (report.validationReport.warnings.length > 0) {
      markdown += `## ⚠️ Warnings

`;
      report.validationReport.warnings.forEach((warning, index) => {
        markdown += `${index + 1}. ${warning}\n`;
      });
      markdown += "\n";
    }

    const driftedEntities = report.driftChecks.filter(
      (check) => check.hasDrift,
    );
    if (driftedEntities.length > 0) {
      markdown += `## 🔄 Type Drift Detected

`;
      driftedEntities.forEach((drift) => {
        markdown += `### ${drift.entityName}

`;
        if (drift.missingFields.length > 0) {
          markdown += `**Missing Fields:** ${drift.missingFields.join(", ")}\n`;
        }
        if (drift.extraFields.length > 0) {
          markdown += `**Extra Fields:** ${drift.extraFields.join(", ")}\n`;
        }
        markdown += "\n";
      });
    }

    if (report.recommendations.length > 0) {
      markdown += `## 💡 Recommendations

`;
      report.recommendations.forEach((rec, index) => {
        markdown += `${index + 1}. ${rec}\n`;
      });
      markdown += "\n";
    }

    return markdown;
  }
}

/**
 * CLI tool for type system monitoring
 */
export async function runTypeSystemMonitor(args: string[] = []): Promise<void> {
  const monitor = new TypeSystemMonitor();

  const command = args[0] || "health";

  switch (command) {
    case "health":
      const health = await monitor.checkHealth();
      console.log(
        `Type System Health: ${health.healthy ? "✅ HEALTHY" : "❌ ISSUES"}`,
      );
      if (health.issues.length > 0) {
        console.log("\nIssues:");
        health.issues.forEach((issue, index) => {
          console.log(`  ${index + 1}. ${issue}`);
        });
      }
      break;

    case "report":
      const report = await monitor.generateHealthReport();
      const outputFile = args[1] || "type-system-health-report.md";
      const markdown = monitor.exportReportToMarkdown(report);
      writeFileSync(outputFile, markdown);
      console.log(`Health report written to: ${outputFile}`);
      break;

    case "trends":
      const days = parseInt(args[1]) || 7;
      const trends = monitor.getPerformanceTrends(days);
      console.log(`Performance Trends (last ${days} days):`);
      console.log(`  Reports: ${trends.timestamps.length}`);
      if (trends.validationTime.length > 0) {
        const avgValidation =
          trends.validationTime.reduce((a, b) => a + b, 0) /
          trends.validationTime.length;
        const avgCompilation =
          trends.compilationTime.reduce((a, b) => a + b, 0) /
          trends.compilationTime.length;
        const avgFailureRate =
          trends.failureRate.reduce((a, b) => a + b, 0) /
          trends.failureRate.length;

        console.log(`  Avg Validation Time: ${avgValidation.toFixed(2)}ms`);
        console.log(`  Avg Compilation Time: ${avgCompilation.toFixed(2)}ms`);
        console.log(`  Avg Failure Rate: ${avgFailureRate.toFixed(2)}%`);
      }
      break;

    default:
      console.log(
        "Usage: runTypeSystemMonitor [health|report|trends] [options]",
      );
      console.log("  health                    - Check type system health");
      console.log(
        "  report [output.md]        - Generate detailed health report",
      );
      console.log("  trends [days]             - Show performance trends");
  }
}

// Export for use in other tools
export { DEFAULT_CONFIG as defaultTypeSystemConfig };

// CLI entry point
if (require.main === module) {
  runTypeSystemMonitor(process.argv.slice(2)).catch(console.error);
}
