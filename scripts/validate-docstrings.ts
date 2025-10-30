#!/usr/bin/env tsx
/**
 * Docstring Validation Utilities
 *
 * Validates docstring format, JSON syntax, and completeness.
 * Can be used as a pre-commit hook or CI check.
 *
 * Usage:
 *   pnpm tsx scripts/validate-docstrings.ts
 *   pnpm tsx scripts/validate-docstrings.ts --file=convex/users/queries.ts
 *   pnpm tsx scripts/validate-docstrings.ts --fix
 */

import fs from "fs";
import path from "path";
import { loadDocstringInfo, ParsedDocstring } from "./docstringParser";

interface ValidationError {
  filePath: string;
  exportName: string;
  severity: "error" | "warning";
  message: string;
  line?: number;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

const CONVEX_DIR = path.resolve(process.cwd(), "convex");

/**
 * Validates JSON syntax in example blocks
 */
function validateExampleJSON(
  filePath: string,
  exportName: string,
  docstring: ParsedDocstring,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [label, example] of Object.entries(docstring.examples)) {
    if (!example.value && example.raw.includes("{")) {
      // JSON-like content but failed to parse
      errors.push({
        filePath,
        exportName,
        severity: "error",
        message: `Example "${label}" contains invalid JSON. Ensure the example is wrapped in a fenced code block and is valid JSON.`,
      });
    }
  }

  return errors;
}

/**
 * Validates docstring completeness
 */
function validateCompleteness(
  filePath: string,
  exportName: string,
  docstring: ParsedDocstring,
  isPublic: boolean,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Public functions should have summary
  if (isPublic && !docstring.summary) {
    errors.push({
      filePath,
      exportName,
      severity: "warning",
      message: "Public function missing @summary tag",
    });
  }

  // Public functions should have description
  if (isPublic && !docstring.description) {
    errors.push({
      filePath,
      exportName,
      severity: "warning",
      message: "Public function missing @description tag",
    });
  }

  // Public functions should have at least one example
  if (isPublic && Object.keys(docstring.examples).length === 0) {
    errors.push({
      filePath,
      exportName,
      severity: "warning",
      message: "Public function missing @example blocks",
    });
  }

  // Functions with examples should have both request and response
  const exampleLabels = Object.keys(docstring.examples);
  if (exampleLabels.length > 0) {
    if (!exampleLabels.includes("request")) {
      errors.push({
        filePath,
        exportName,
        severity: "warning",
        message: 'Function has examples but missing "@example request" block',
      });
    }

    if (
      !exampleLabels.includes("response") &&
      !exampleLabels.some((l) => l.startsWith("response-"))
    ) {
      errors.push({
        filePath,
        exportName,
        severity: "warning",
        message: 'Function has examples but missing "@example response" block',
      });
    }
  }

  return errors;
}

/**
 * Validates docstring format and structure
 */
function validateFormat(
  filePath: string,
  exportName: string,
  docstring: ParsedDocstring,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Summary should be concise (< 100 chars)
  if (docstring.summary && docstring.summary.length > 100) {
    errors.push({
      filePath,
      exportName,
      severity: "warning",
      message: `Summary is too long (${docstring.summary.length} chars). Keep it under 100 characters.`,
    });
  }

  // Summary should start with a verb
  if (docstring.summary) {
    const firstWord = docstring.summary.split(" ")[0].toLowerCase();
    const verbs = [
      "gets",
      "lists",
      "creates",
      "updates",
      "deletes",
      "generates",
      "processes",
      "validates",
      "checks",
      "calculates",
      "analyzes",
      "fetches",
      "retrieves",
      "adds",
      "removes",
      "sets",
      "clears",
      "initializes",
      "executes",
      "runs",
      "performs",
      "handles",
      "manages",
      "monitors",
      "tracks",
      "logs",
      "records",
      "stores",
      "loads",
      "saves",
      "imports",
      "exports",
      "syncs",
      "merges",
      "splits",
      "joins",
      "filters",
      "sorts",
      "searches",
      "finds",
      "queries",
      "counts",
      "aggregates",
      "summarizes",
    ];

    if (!verbs.includes(firstWord)) {
      errors.push({
        filePath,
        exportName,
        severity: "warning",
        message: `Summary should start with a verb (e.g., "Gets", "Creates", "Updates"). Current: "${docstring.summary}"`,
      });
    }
  }

  // Description should be substantial (> 50 chars)
  if (docstring.description && docstring.description.length < 50) {
    errors.push({
      filePath,
      exportName,
      severity: "warning",
      message: `Description is too brief (${docstring.description.length} chars). Provide more detail about behavior, parameters, and side effects.`,
    });
  }

  return errors;
}

/**
 * Checks for duplicate summaries across functions
 */
function checkDuplicateSummaries(
  functions: Array<{
    filePath: string;
    exportName: string;
    docstring: ParsedDocstring;
  }>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const summaryMap = new Map<
    string,
    Array<{ filePath: string; exportName: string }>
  >();

  for (const func of functions) {
    if (func.docstring.summary) {
      const summary = func.docstring.summary.toLowerCase().trim();
      if (!summaryMap.has(summary)) {
        summaryMap.set(summary, []);
      }
      summaryMap.get(summary)!.push({
        filePath: func.filePath,
        exportName: func.exportName,
      });
    }
  }

  // Report duplicates
  for (const [summary, occurrences] of summaryMap.entries()) {
    if (occurrences.length > 1) {
      for (const occurrence of occurrences) {
        errors.push({
          filePath: occurrence.filePath,
          exportName: occurrence.exportName,
          severity: "warning",
          message: `Duplicate summary: "${summary}" (also used in ${occurrences
            .filter((o) => o !== occurrence)
            .map((o) => `${o.filePath}:${o.exportName}`)
            .join(", ")})`,
        });
      }
    }
  }

  return errors;
}

/**
 * Extracts function exports from a TypeScript file
 */
function extractFunctionExports(filePath: string): Array<{
  exportName: string;
  isPublic: boolean;
}> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const exports: Array<{
    exportName: string;
    isPublic: boolean;
  }> = [];

  // Match: export const functionName = query({ ... })
  const exportPattern =
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;
  let match;

  while ((match = exportPattern.exec(content)) !== null) {
    const exportName = match[1];
    const functionType = match[2];
    const isPublic = !functionType.startsWith("internal");

    exports.push({
      exportName,
      isPublic,
    });
  }

  return exports;
}

/**
 * Validates a single file
 */
function validateFile(filePath: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const exports = extractFunctionExports(filePath);
  const functions: Array<{
    filePath: string;
    exportName: string;
    docstring: ParsedDocstring;
  }> = [];

  for (const exp of exports) {
    const docstring = loadDocstringInfo(filePath, exp.exportName);

    if (!docstring) {
      if (exp.isPublic) {
        warnings.push({
          filePath,
          exportName: exp.exportName,
          severity: "warning",
          message: "Public function missing docstring",
        });
      }
      continue;
    }

    functions.push({
      filePath,
      exportName: exp.exportName,
      docstring,
    });

    // Validate JSON syntax
    errors.push(...validateExampleJSON(filePath, exp.exportName, docstring));

    // Validate completeness
    const completenessErrors = validateCompleteness(
      filePath,
      exp.exportName,
      docstring,
      exp.isPublic,
    );
    errors.push(...completenessErrors.filter((e) => e.severity === "error"));
    warnings.push(
      ...completenessErrors.filter((e) => e.severity === "warning"),
    );

    // Validate format
    const formatErrors = validateFormat(filePath, exp.exportName, docstring);
    errors.push(...formatErrors.filter((e) => e.severity === "error"));
    warnings.push(...formatErrors.filter((e) => e.severity === "warning"));
  }

  // Check for duplicate summaries
  const duplicateErrors = checkDuplicateSummaries(functions);
  warnings.push(...duplicateErrors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates all files in a directory
 */
function validateDirectory(dirPath: string): ValidationResult {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationError[] = [];

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip test directories and node_modules
        if (
          entry.name !== "test" &&
          entry.name !== "node_modules" &&
          entry.name !== "_generated"
        ) {
          scanDir(fullPath);
        }
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        const result = validateFile(fullPath);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      }
    }
  }

  scanDir(dirPath);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Formats validation results
 */
function formatResults(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.errors.length === 0 && result.warnings.length === 0) {
    lines.push("✓ All docstrings are valid!");
    return lines.join("\n");
  }

  if (result.errors.length > 0) {
    lines.push(`\n❌ ERRORS (${result.errors.length})`);
    lines.push("=".repeat(80));

    for (const error of result.errors) {
      lines.push(`\n${error.filePath}:${error.exportName}`);
      lines.push(`  ${error.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`\n⚠️  WARNINGS (${result.warnings.length})`);
    lines.push("=".repeat(80));

    for (const warning of result.warnings) {
      lines.push(`\n${warning.filePath}:${warning.exportName}`);
      lines.push(`  ${warning.message}`);
    }
  }

  lines.push("");
  lines.push("=".repeat(80));
  lines.push(
    `Total: ${result.errors.length} errors, ${result.warnings.length} warnings`,
  );

  return lines.join("\n");
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => arg.startsWith("--file="));
  const file = fileArg ? fileArg.split("=")[1] : undefined;

  let result: ValidationResult;

  if (file) {
    const filePath = path.resolve(process.cwd(), file);
    result = validateFile(filePath);
  } else {
    result = validateDirectory(CONVEX_DIR);
  }

  console.log(formatResults(result));

  // Exit with error code if there are errors
  if (!result.valid) {
    process.exit(1);
  }
}

main();
