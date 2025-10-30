#!/usr/bin/env tsx
/**
 * Documentation Audit Script
 *
 * Scans all Convex functions and generates coverage reports showing:
 * - Total public functions (queries, mutations, actions)
 * - Functions with docstrings
 * - Functions with examples
 * - Functions with validated examples (tests)
 * - Coverage percentage by domain
 *
 * Usage:
 *   pnpm tsx scripts/audit-docstrings.ts
 *   pnpm tsx scripts/audit-docstrings.ts --domain=users
 *   pnpm tsx scripts/audit-docstrings.ts --json > coverage.json
 */

import fs from "fs";
import path from "path";
import { loadDocstringInfo } from "./docstringParser";

interface FunctionInfo {
  filePath: string;
  exportName: string;
  functionType:
    | "query"
    | "mutation"
    | "action"
    | "internalQuery"
    | "internalMutation"
    | "internalAction";
  isPublic: boolean;
  hasDocstring: boolean;
  hasSummary: boolean;
  hasDescription: boolean;
  hasExamples: boolean;
  exampleLabels: string[];
  hasTests: boolean;
}

interface DomainCoverage {
  domain: string;
  totalFunctions: number;
  publicFunctions: number;
  documented: number;
  withSummary: number;
  withDescription: number;
  withExamples: number;
  withTests: number;
  coverage: number;
  functions: FunctionInfo[];
}

interface CoverageReport {
  timestamp: number;
  totalFunctions: number;
  publicFunctions: number;
  documented: number;
  withExamples: number;
  withTests: number;
  overallCoverage: number;
  domains: DomainCoverage[];
}

const CONVEX_DIR = path.resolve(process.cwd(), "convex");
const TEST_DIR = path.resolve(CONVEX_DIR, "test");

// Domains to scan (subdirectoriesnvex/)
const DOMAINS = [
  "users",
  "meetings",
  "transcripts",
  "notes",
  "prompts",
  "insights",
  "matching",
  "embeddings",
  "realtime",
  "profiles",
  "interests",
  "monitoring",
  "system",
  "audit",
  "auth",
];

/**
 * Extracts function exports from a TypeScript file
 */
function extractFunctionExports(filePath: string): Array<{
  exportName: string;
  functionType:
    | "query"
    | "mutation"
    | "action"
    | "internalQuery"
    | "internalMutation"
    | "internalAction";
  isPublic: boolean;
}> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const exports: Array<{
    exportName: string;
    functionType:
      | "query"
      | "mutation"
      | "action"
      | "internalQuery"
      | "internalMutation"
      | "internalAction";
    isPublic: boolean;
  }> = [];

  // Match: export const functionName = query({ ... })
  const exportPattern =
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;
  let match;

  while ((match = exportPattern.exec(content)) !== null) {
    const exportName = match[1];
    const functionType = match[2] as
      | "query"
      | "mutation"
      | "action"
      | "internalQuery"
      | "internalMutation"
      | "internalAction";
    const isPublic = !functionType.startsWith("internal");

    exports.push({
      exportName,
      functionType,
      isPublic,
    });
  }

  return exports;
}

/**
 * Checks if a function has test coverage
 */
function hasTestCoverage(filePath: string, exportName: string): boolean {
  // Check if there's a test file that references this function
  const testFiles = fs
    .readdirSync(TEST_DIR)
    .filter((f) => f.endsWith(".test.ts"));

  for (const testFile of testFiles) {
    const testPath = path.join(TEST_DIR, testFile);
    const testContent = fs.readFileSync(testPath, "utf8");

    // Check if the test file references this function
    // Look for: api.domain.functionName or getDocstringInfoForOperation("path", "functionName")
    const functionRef = new RegExp(`["'\`]${exportName}["'\`]`, "g");
    if (functionRef.test(testContent)) {
      return true;
    }
  }

  return false;
}

/**
 * Scans a domain directory for functions
 */
function scanDomain(domain: string): DomainCoverage {
  const domainPath = path.join(CONVEX_DIR, domain);

  if (!fs.existsSync(domainPath)) {
    return {
      domain,
      totalFunctions: 0,
      publicFunctions: 0,
      documented: 0,
      withSummary: 0,
      withDescription: 0,
      withExamples: 0,
      withTests: 0,
      coverage: 0,
      functions: [],
    };
  }

  const functions: FunctionInfo[] = [];

  // Scan all .ts files in the domain (excluding test files)
  const files = fs
    .readdirSync(domainPath)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  for (const file of files) {
    const filePath = path.join(domainPath, file);
    const relativeFilePath = path.relative(CONVEX_DIR, filePath);

    // Extract function exports
    const exports = extractFunctionExports(filePath);

    for (const exp of exports) {
      // Load docstring info
      const docInfo = loadDocstringInfo(filePath, exp.exportName);

      const hasDocstring = docInfo !== null;
      const hasSummary = hasDocstring && !!docInfo.summary;
      const hasDescription = hasDocstring && !!docInfo.description;
      const exampleLabels = hasDocstring ? Object.keys(docInfo.examples) : [];
      const hasExamples = exampleLabels.length > 0;
      const hasTests = hasTestCoverage(filePath, exp.exportName);

      functions.push({
        filePath: relativeFilePath,
        exportName: exp.exportName,
        functionType: exp.functionType,
        isPublic: exp.isPublic,
        hasDocstring,
        hasSummary,
        hasDescription,
        hasExamples,
        exampleLabels,
        hasTests,
      });
    }
  }

  // Calculate coverage metrics
  const totalFunctions = functions.length;
  const publicFunctions = functions.filter((f) => f.isPublic).length;
  const documented = functions.filter(
    (f) => f.hasDocstring && f.isPublic,
  ).length;
  const withSummary = functions.filter(
    (f) => f.hasSummary && f.isPublic,
  ).length;
  const withDescription = functions.filter(
    (f) => f.hasDescription && f.isPublic,
  ).length;
  const withExamples = functions.filter(
    (f) => f.hasExamples && f.isPublic,
  ).length;
  const withTests = functions.filter((f) => f.hasTests && f.isPublic).length;
  const coverage =
    publicFunctions > 0 ? (documented / publicFunctions) * 100 : 0;

  return {
    domain,
    totalFunctions,
    publicFunctions,
    documented,
    withSummary,
    withDescription,
    withExamples,
    withTests,
    coverage,
    functions,
  };
}

/**
 * Generates a coverage report for all domains
 */
function generateCoverageReport(domainFilter?: string): CoverageReport {
  const domainsToScan = domainFilter ? [domainFilter] : DOMAINS;
  const domains: DomainCoverage[] = [];

  for (const domain of domainsToScan) {
    const coverage = scanDomain(domain);
    if (coverage.totalFunctions > 0) {
      domains.push(coverage);
    }
  }

  // Calculate overall metrics
  const totalFunctions = domains.reduce((sum, d) => sum + d.totalFunctions, 0);
  const publicFunctions = domains.reduce(
    (sum, d) => sum + d.publicFunctions,
    0,
  );
  const documented = domains.reduce((sum, d) => sum + d.documented, 0);
  const withExamples = domains.reduce((sum, d) => sum + d.withExamples, 0);
  const withTests = domains.reduce((sum, d) => sum + d.withTests, 0);
  const overallCoverage =
    publicFunctions > 0 ? (documented / publicFunctions) * 100 : 0;

  return {
    timestamp: Date.now(),
    totalFunctions,
    publicFunctions,
    documented,
    withExamples,
    withTests,
    overallCoverage,
    domains,
  };
}

/**
 * Formats the coverage report as human-readable text
 */
function formatReport(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(80));
  lines.push("CONVEX BACKEND DOCUMENTATION COVERAGE REPORT");
  lines.push("=".repeat(80));
  lines.push("");
  lines.push(`Generated: ${new Date(report.timestamp).toISOString()}`);
  lines.push("");

  // Overall summary
  lines.push("OVERALL SUMMARY");
  lines.push("-".repeat(80));
  lines.push(`Total Functions:        ${report.totalFunctions}`);
  lines.push(`Public Functions:       ${report.publicFunctions}`);
  lines.push(
    `Documented:             ${report.documented} (${report.overallCoverage.toFixed(1)}%)`,
  );
  lines.push(
    `With Examples:          ${report.withExamples} (${((report.withExamples / report.publicFunctions) * 100).toFixed(1)}%)`,
  );
  lines.push(
    `With Tests:             ${report.withTests} (${((report.withTests / report.publicFunctions) * 100).toFixed(1)}%)`,
  );
  lines.push("");

  // Domain breakdown
  lines.push("DOMAIN BREAKDOWN");
  lines.push("-".repeat(80));
  lines.push(
    `${"Domain".padEnd(20)} ${"Public".padStart(8)} ${"Docs".padStart(8)} ${"Examples".padStart(10)} ${"Tests".padStart(8)} ${"Coverage".padStart(10)}`,
  );
  lines.push("-".repeat(80));

  for (const domain of report.domains.sort((a, b) => b.coverage - a.coverage)) {
    const coverageBar =
      "█".repeat(Math.floor(domain.coverage / 10)) +
      "░".repeat(10 - Math.floor(domain.coverage / 10));
    lines.push(
      `${domain.domain.padEnd(20)} ${domain.publicFunctions.toString().padStart(8)} ${domain.documented.toString().padStart(8)} ${domain.withExamples.toString().padStart(10)} ${domain.withTests.toString().padStart(8)} ${domain.coverage.toFixed(1).padStart(9)}% ${coverageBar}`,
    );
  }

  lines.push("");

  // Functions needing attention
  lines.push("FUNCTIONS NEEDING ATTENTION");
  lines.push("-".repeat(80));

  for (const domain of report.domains) {
    const needsAttention = domain.functions.filter(
      (f) => f.isPublic && (!f.hasDocstring || !f.hasExamples),
    );

    if (needsAttention.length > 0) {
      lines.push("");
      lines.push(`${domain.domain.toUpperCase()}`);
      for (const func of needsAttention) {
        const issues: string[] = [];
        if (!func.hasDocstring) issues.push("no docstring");
        if (!func.hasSummary) issues.push("no summary");
        if (!func.hasDescription) issues.push("no description");
        if (!func.hasExamples) issues.push("no examples");
        if (!func.hasTests) issues.push("no tests");

        lines.push(
          `  - ${func.filePath}:${func.exportName} (${issues.join(", ")})`,
        );
      }
    }
  }

  lines.push("");
  lines.push("=".repeat(80));

  return lines.join("\n");
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const domainArg = args.find((arg) => arg.startsWith("--domain="));
  const domain = domainArg ? domainArg.split("=")[1] : undefined;

  const report = generateCoverageReport(domain);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  // Exit with error code if coverage is below threshold
  const threshold = 80; // 80% coverage target
  if (report.overallCoverage < threshold) {
    process.exit(1);
  }
}

main();
