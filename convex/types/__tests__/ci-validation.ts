/**
 * CI/CD Type Validation Script
 *
 * This script provides automated type checking and validation for CI/CD pipelines.
 * It validates all centralized types, generates reports, and ensures type consistency.
 *
 * Requirements: 3.4, 3.5, 6.4, 6.5, 8.3, 8.4
 * Compliance: Automated CI/CD integration for type safety
 */

import {
  generateCIValidationReport,
  type CIValidationReport,
} from "./type-validation-utils";

// Import all validator collections for validation
import { UserV } from "../validators/user";
import { MeetingV } from "../validators/meeting";
import { TranscriptV } from "../validators/transcript";
import { NoteV } from "../validators/note";
import { PromptV } from "../validators/prompt";
import { MatchingV } from "../validators/matching";
import { WebRTCV } from "../validators/webrtc";
import { EmbeddingV } from "../validators/embedding";
import { MessagingV } from "../validators/messaging";
import { SystemV } from "../validators/system";
import { StreamV } from "../validators/stream";
import { CommonV, ErrorV } from "../validators/common";
import { PaginationV } from "../validators/pagination";

/**
 * Main CI validation function
 * Runs comprehensive type validation and generates a report
 */
export async function runCIValidation(): Promise<CIValidationReport> {
  console.log("🔍 Starting Convex Type Consistency Validation...");

  const validatorCollections = {
    UserV,
    MeetingV,
    TranscriptV,
    NoteV,
    PromptV,
    MatchingV,
    WebRTCV,
    EmbeddingV,
    MessagingV,
    SystemV,
    StreamV,
    CommonV: { ...CommonV, ...ErrorV }, // Combine common validators
    PaginationV,
  };

  const report = generateCIValidationReport(validatorCollections);

  // Log summary
  console.log("\n📊 Validation Summary:");
  console.log(`✅ Total Validators: ${report.totalValidators}`);
  console.log(`❌ Failed Validators: ${report.failedValidators}`);
  console.log(`⚠️  Warnings: ${report.warnings.length}`);
  console.log(
    `⚡ Performance: ${report.performance.averageValidationTime.toFixed(2)}ms avg`,
  );

  if (report.errors.length > 0) {
    console.log("\n🚨 Validation Errors:");
    report.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }

  if (report.warnings.length > 0) {
    console.log("\n⚠️  Validation Warnings:");
    report.warnings.forEach((warning, index) => {
      console.log(`  ${index + 1}. ${warning}`);
    });
  }

  // Performance metrics
  console.log("\n⚡ Performance Metrics:");
  console.log(
    `  Average validation time: ${report.performance.averageValidationTime.toFixed(2)}ms`,
  );
  console.log(
    `  Maximum validation time: ${report.performance.maxValidationTime.toFixed(2)}ms`,
  );
  console.log(
    `  Total validation time: ${report.performance.totalValidationTime.toFixed(2)}ms`,
  );

  return report;
}

/**
 * Validates TypeScript compilation
 * Ensures all types compile without errors
 */
export async function validateTypeScriptCompilation(): Promise<boolean> {
  console.log("🔧 Validating TypeScript compilation...");

  try {
    // In a real CI environment, this would run `tsc --noEmit`
    // For now, we'll simulate the check
    const { execSync } = require("child_process");

    // Run TypeScript compilation check
    execSync("bun tsc --noEmit", {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    console.log("✅ TypeScript compilation successful");
    return true;
  } catch (error: any) {
    console.error("❌ TypeScript compilation failed:");
    console.error(error.stdout?.toString() || error.message);
    return false;
  }
}

/**
 * Validates Convex codegen
 * Ensures generated types are up to date
 */
export async function validateConvexCodegen(): Promise<boolean> {
  console.log("🔄 Validating Convex codegen...");

  try {
    const { execSync } = require("child_process");

    // Run Convex codegen
    execSync("npx convex codegen", {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    console.log("✅ Convex codegen successful");
    return true;
  } catch (error: any) {
    console.error("❌ Convex codegen failed:");
    console.error(error.stdout?.toString() || error.message);
    return false;
  }
}

/**
 * Runs all validation checks
 * Main entry point for CI/CD
 */
export async function runAllValidations(): Promise<{
  passed: boolean;
  report: CIValidationReport;
  typeScriptPassed: boolean;
  convexCodegenPassed: boolean;
}> {
  console.log("🚀 Running comprehensive type validation suite...\n");

  // Run all validations
  const [report, typeScriptPassed, convexCodegenPassed] = await Promise.all([
    runCIValidation(),
    validateTypeScriptCompilation(),
    validateConvexCodegen(),
  ]);

  const allPassed = report.passed && typeScriptPassed && convexCodegenPassed;

  console.log("\n" + "=".repeat(60));
  console.log("🎯 FINAL VALIDATION RESULTS");
  console.log("=".repeat(60));
  console.log(`Type Validation: ${report.passed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(
    `TypeScript Compilation: ${typeScriptPassed ? "✅ PASSED" : "❌ FAILED"}`,
  );
  console.log(
    `Convex Codegen: ${convexCodegenPassed ? "✅ PASSED" : "❌ FAILED"}`,
  );
  console.log("=".repeat(60));
  console.log(
    `Overall Result: ${allPassed ? "✅ ALL CHECKS PASSED" : "❌ SOME CHECKS FAILED"}`,
  );

  return {
    passed: allPassed,
    report,
    typeScriptPassed,
    convexCodegenPassed,
  };
}

/**
 * Generates a detailed validation report for CI artifacts
 */
export function generateDetailedReport(
  report: CIValidationReport,
  typeScriptPassed: boolean,
  convexCodegenPassed: boolean,
): string {
  const timestamp = new Date(report.timestamp).toISOString();

  let markdown = `# Convex Type Consistency Validation Report

**Generated:** ${timestamp}
**Status:** ${report.passed && typeScriptPassed && convexCodegenPassed ? "✅ PASSED" : "❌ FAILED"}

## Summary

| Metric | Value |
|--------|-------|
| Total Validators | ${report.totalValidators} |
| Failed Validators | ${report.failedValidators} |
| Warnings | ${report.warnings.length} |
| TypeScript Compilation | ${typeScriptPassed ? "✅ Passed" : "❌ Failed"} |
| Convex Codegen | ${convexCodegenPassed ? "✅ Passed" : "❌ Failed"} |

## Performance Metrics

| Metric | Value |
|--------|-------|
| Average Validation Time | ${report.performance.averageValidationTime.toFixed(2)}ms |
| Maximum Validation Time | ${report.performance.maxValidationTime.toFixed(2)}ms |
| Total Validation Time | ${report.performance.totalValidationTime.toFixed(2)}ms |
| Validator Count | ${report.performance.validatorCount} |

`;

  if (report.errors.length > 0) {
    markdown += `## ❌ Errors

`;
    report.errors.forEach((error, index) => {
      markdown += `${index + 1}. ${error}\n`;
    });
    markdown += "\n";
  }

  if (report.warnings.length > 0) {
    markdown += `## ⚠️ Warnings

`;
    report.warnings.forEach((warning, index) => {
      markdown += `${index + 1}. ${warning}\n`;
    });
    markdown += "\n";
  }

  markdown += `## Recommendations

`;

  if (report.failedValidators > 0) {
    markdown += `- Fix ${report.failedValidators} failed validator(s) before merging\n`;
  }

  if (report.performance.averageValidationTime > 5) {
    markdown += `- Consider optimizing validator performance (current avg: ${report.performance.averageValidationTime.toFixed(2)}ms)\n`;
  }

  if (report.warnings.length > 5) {
    markdown += `- Address ${report.warnings.length} warnings to improve code quality\n`;
  }

  if (report.errors.length === 0 && report.warnings.length === 0) {
    markdown += `- All validations passed! ✅\n`;
  }

  return markdown;
}

/**
 * CLI entry point
 * Allows running validation from command line
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputFile = args
    .find((arg) => arg.startsWith("--output="))
    ?.split("=")[1];
  const exitOnFailure = !args.includes("--no-exit");

  try {
    const results = await runAllValidations();

    // Generate detailed report if output file specified
    if (outputFile) {
      const detailedReport = generateDetailedReport(
        results.report,
        results.typeScriptPassed,
        results.convexCodegenPassed,
      );

      const fs = require("fs");
      fs.writeFileSync(outputFile, detailedReport);
      console.log(`\n📄 Detailed report written to: ${outputFile}`);
    }

    // Exit with appropriate code
    if (exitOnFailure && !results.passed) {
      process.exit(1);
    }
  } catch (error) {
    console.error("💥 Validation failed with error:", error);
    if (exitOnFailure) {
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
