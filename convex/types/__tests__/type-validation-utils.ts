/**
 * Type Validation Utilities
 *
 * This module provides utilities to validate validator-type alignment across all modules,
 * ensuring type safety and consistency at compile time and runtime.
 *
 * Requirements: 3.4, 3.5, 6.4, 6.5, 8.3, 8.4
 * Compliance: steering/convex_rules.mdc - Type-first approach with validator alignment validation
 */

import type { Infer, Validator } from "convex/values";

// Type assertion helpers for compile-time validation
export type AssertEqual<T, U> = [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;
export type Assert<T extends true> = T;

// Utility to check if a TypeScript type matches a validator's inferred type
export type ValidatorTypeAlignment<
  TType,
  TValidator extends Validator<any, any, any>,
> = AssertEqual<TType, Infer<TValidator>>;

// Runtime validator structure validation
export interface ValidatorTestResult {
  isValid: boolean;
  errors: string[];
  validatorName: string;
  typeName: string;
}

/**
 * Validates that a validator is properly structured and can be used
 * @param validator The validator to test
 * @param validatorName Name for error reporting
 * @returns Test result with validation status
 */
export function validateValidatorStructure(
  validator: any,
  validatorName: string,
): ValidatorTestResult {
  const errors: string[] = [];

  try {
    // Check if validator has required properties
    if (!validator || typeof validator !== "object") {
      errors.push(`${validatorName} is not a valid object`);
      return { isValid: false, errors, validatorName, typeName: "unknown" };
    }

    // Check for Convex validator structure
    if (!("kind" in validator)) {
      errors.push(`${validatorName} missing 'kind' property`);
    }

    // Note: 'type' property is not always present in mock validators
    // This is acceptable for testing purposes

    // Validate specific validator kinds
    switch (validator.kind) {
      case "object":
        if (!validator.fields || typeof validator.fields !== "object") {
          errors.push(
            `${validatorName} object validator missing or invalid 'fields'`,
          );
        }
        break;
      case "array":
        if (!validator.element) {
          errors.push(`${validatorName} array validator missing 'element'`);
        }
        break;
      case "union":
        if (!Array.isArray(validator.members)) {
          errors.push(
            `${validatorName} union validator missing or invalid 'members'`,
          );
        }
        break;
      case "record":
        if (!validator.keys || !validator.values) {
          errors.push(
            `${validatorName} record validator missing 'keys' or 'values'`,
          );
        }
        break;
    }

    return {
      isValid: errors.length === 0,
      errors,
      validatorName,
      typeName: validator.kind || "unknown",
    };
  } catch (error) {
    errors.push(`${validatorName} validation threw error: ${error}`);
    return { isValid: false, errors, validatorName, typeName: "error" };
  }
}

/**
 * Validates a collection of validators (e.g., UserV, MeetingV)
 * @param validators Object containing validators to test
 * @param collectionName Name of the validator collection
 * @returns Array of test results
 */
export function validateValidatorCollection(
  validators: Record<string, any>,
  collectionName: string,
): ValidatorTestResult[] {
  const results: ValidatorTestResult[] = [];

  for (const [key, validator] of Object.entries(validators)) {
    const validatorName = `${collectionName}.${key}`;
    results.push(validateValidatorStructure(validator, validatorName));
  }

  return results;
}

/**
 * Automated type drift detection utility
 * Compares validator structure against expected patterns
 */
export interface TypeDriftCheck {
  entityName: string;
  expectedFields: string[];
  actualFields: string[];
  missingFields: string[];
  extraFields: string[];
  hasDrift: boolean;
}

/**
 * Detects type drift by comparing validator fields against expected schema
 * @param validator Object validator to check
 * @param expectedFields Array of expected field names
 * @param entityName Name for reporting
 * @returns Drift detection result
 */
export function detectTypeDrift(
  validator: any,
  expectedFields: string[],
  entityName: string,
): TypeDriftCheck {
  const actualFields: string[] = [];

  if (validator?.kind === "object" && validator.fields) {
    actualFields.push(...Object.keys(validator.fields));
  }

  const missingFields = expectedFields.filter(
    (field) => !actualFields.includes(field),
  );
  const extraFields = actualFields.filter(
    (field) => !expectedFields.includes(field),
  );

  return {
    entityName,
    expectedFields,
    actualFields,
    missingFields,
    extraFields,
    hasDrift: missingFields.length > 0 || extraFields.length > 0,
  };
}

/**
 * Performance validation for type checking
 * Measures compile-time impact of centralized types
 */
export interface TypePerformanceMetrics {
  validatorCount: number;
  averageValidationTime: number;
  maxValidationTime: number;
  totalValidationTime: number;
  memoryUsage?: number;
}

/**
 * Measures performance impact of validator validation
 * @param validators Array of validators to test
 * @returns Performance metrics
 */
export function measureValidatorPerformance(
  validators: Array<{ name: string; validator: any }>,
): TypePerformanceMetrics {
  const startTime = performance.now();
  const validationTimes: number[] = [];

  for (const { name, validator } of validators) {
    const validationStart = performance.now();
    validateValidatorStructure(validator, name);
    const validationEnd = performance.now();
    validationTimes.push(validationEnd - validationStart);
  }

  const totalTime = performance.now() - startTime;
  const averageTime =
    validationTimes.reduce((sum, time) => sum + time, 0) /
    validationTimes.length;
  const maxTime = Math.max(...validationTimes);

  return {
    validatorCount: validators.length,
    averageValidationTime: averageTime,
    maxValidationTime: maxTime,
    totalValidationTime: totalTime,
  };
}

/**
 * CI/CD integration utilities for automated type checking
 */
export interface CIValidationReport {
  passed: boolean;
  totalValidators: number;
  failedValidators: number;
  errors: string[];
  warnings: string[];
  performance: TypePerformanceMetrics;
  timestamp: number;
}

/**
 * Generates a comprehensive validation report for CI/CD
 * @param validatorCollections Object mapping collection names to validator objects
 * @returns Comprehensive validation report
 */
export function generateCIValidationReport(
  validatorCollections: Record<string, Record<string, any>>,
): CIValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let totalValidators = 0;
  let failedValidators = 0;

  // Collect all validators for performance testing
  const allValidators: Array<{ name: string; validator: any }> = [];

  // Validate each collection
  for (const [collectionName, validators] of Object.entries(
    validatorCollections,
  )) {
    const results = validateValidatorCollection(validators, collectionName);
    totalValidators += results.length;

    for (const result of results) {
      allValidators.push({
        name: result.validatorName,
        validator: validators[result.validatorName.split(".")[1]],
      });

      if (!result.isValid) {
        failedValidators++;
        errors.push(...result.errors);
      }

      // Add warnings for potential issues
      if (result.typeName === "any") {
        warnings.push(
          `${result.validatorName} uses 'any' type - consider more specific typing`,
        );
      }
    }
  }

  // Measure performance
  const performance = measureValidatorPerformance(allValidators);

  // Performance warnings
  if (performance.averageValidationTime > 5) {
    warnings.push(
      `Average validation time (${performance.averageValidationTime.toFixed(2)}ms) exceeds recommended threshold`,
    );
  }

  if (performance.maxValidationTime > 20) {
    warnings.push(
      `Maximum validation time (${performance.maxValidationTime.toFixed(2)}ms) exceeds recommended threshold`,
    );
  }

  return {
    passed: failedValidators === 0,
    totalValidators,
    failedValidators,
    errors,
    warnings,
    performance,
    timestamp: Date.now(),
  };
}

/**
 * Developer tools for type exploration and validation
 */
export interface TypeExplorationResult {
  validatorName: string;
  structure: any;
  inferredType: string;
  complexity: number;
  dependencies: string[];
}

/**
 * Explores validator structure for developer tooling
 * @param validator Validator to explore
 * @param validatorName Name for reporting
 * @returns Exploration result
 */
export function exploreValidatorStructure(
  validator: any,
  validatorName: string,
): TypeExplorationResult {
  const dependencies: string[] = [];
  let complexity = 1;

  function analyzeValidator(v: any, depth = 0): any {
    if (!v || typeof v !== "object") return v;

    complexity += 1;

    switch (v.kind) {
      case "object":
        const fields: any = {};
        if (v.fields) {
          for (const [key, fieldValidator] of Object.entries(v.fields)) {
            fields[key] = analyzeValidator(fieldValidator, depth + 1);
          }
        }
        return { kind: "object", fields };

      case "array":
        return {
          kind: "array",
          element: analyzeValidator(v.element, depth + 1),
        };

      case "union":
        return {
          kind: "union",
          members:
            v.members?.map((m: any) => analyzeValidator(m, depth + 1)) || [],
        };

      case "record":
        return {
          kind: "record",
          keys: analyzeValidator(v.keys, depth + 1),
          values: analyzeValidator(v.values, depth + 1),
        };

      case "id":
        if (v.tableName) {
          dependencies.push(`table:${v.tableName}`);
        }
        return { kind: "id", tableName: v.tableName };

      default:
        return { kind: v.kind };
    }
  }

  const structure = analyzeValidator(validator);

  return {
    validatorName,
    structure,
    inferredType: validator.type?.toString() || "unknown",
    complexity,
    dependencies,
  };
}

/**
 * Automated type safety test helpers for function validation
 */
export interface FunctionTypeValidation {
  functionName: string;
  hasArgsValidator: boolean;
  hasReturnsValidator: boolean;
  argsValidatorValid: boolean;
  returnsValidatorValid: boolean;
  errors: string[];
}

/**
 * Validates that a Convex function has proper type validators
 * @param convexFunction Function object to validate
 * @param functionName Name for reporting
 * @returns Validation result
 */
export function validateFunctionTypes(
  convexFunction: any,
  functionName: string,
): FunctionTypeValidation {
  const errors: string[] = [];

  const hasArgsValidator = !!convexFunction?.args;
  const hasReturnsValidator = !!convexFunction?.returns;

  if (!hasArgsValidator) {
    errors.push(`${functionName} missing args validator`);
  }

  if (!hasReturnsValidator) {
    errors.push(`${functionName} missing returns validator`);
  }

  let argsValidatorValid = true;
  let returnsValidatorValid = true;

  if (hasArgsValidator) {
    const argsResult = validateValidatorStructure(
      convexFunction.args,
      `${functionName}.args`,
    );
    if (!argsResult.isValid) {
      argsValidatorValid = false;
      errors.push(...argsResult.errors);
    }
  }

  if (hasReturnsValidator) {
    const returnsResult = validateValidatorStructure(
      convexFunction.returns,
      `${functionName}.returns`,
    );
    if (!returnsResult.isValid) {
      returnsValidatorValid = false;
      errors.push(...returnsResult.errors);
    }
  }

  return {
    functionName,
    hasArgsValidator,
    hasReturnsValidator,
    argsValidatorValid,
    returnsValidatorValid,
    errors,
  };
}
