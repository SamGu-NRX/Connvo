/**
 * Test Helper Utilities for Docstring Example Validation
 *
 * Provides utilities for validating that docstring examples match actual
 * function behavior. These helpers normalize dynamic values (IDs, timestamps)
 * and provide assertion patterns for common scenarios.
 *
 * Usage:
 *   import { validateExampleAlignment, normalizeResponse } from "./docstringHelpers";
 *
 *   test("function example aligns", async () => {
 *     const result = await validateExamignment(
 *       t,
 *       "convex/users/queries.ts",
 *       "getUserById",
 *       api.users.queries.getUserById,
 *       { userId: testUserId }
 *     );
 *     expect(result.aligned).toBe(true);
 *   });
 */

import { expect } from "vitest";
import type { SystemTableNames } from "convex/server";
import { Id } from "@convex/_generated/dataModel";
import type { TableNames } from "@convex/_generated/dataModel";
import {
  getDocstringInfoForOperation,
  getExampleValue,
} from "./openapiExamples";
import type { TestConvex } from "convex-test";

type ConvexSchema = typeof import("../schema").default;
type DocstringTestConvex = TestConvex<ConvexSchema>;

/**
 * Normalizes dynamic values in a response to match example placeholders
 */
export function normalizeResponse<T extends Record<string, any>>(
  actual: T,
  example: T,
  options: {
    idFields?: string[];
    timestampFields?: string[];
    ignoreFields?: string[];
  } = {},
): T {
  const {
    idFields = ["_id", "userId", "meetingId", "organizerId"],
    timestampFields = [
      "_creationTime",
      "createdAt",
      "updatedAt",
      "scheduledAt",
      "startedAt",
      "endedAt",
      "joinedAt",
      "leftAt",
    ],
    ignoreFields = [],
  } = options;

  const normalized = { ...actual } as Record<string, any>;

  // Normalize ID fields
  for (const field of idFields) {
    if (field in example && field in normalized) {
      normalized[field] = example[field];
    }
  }

  // Normalize timestamp fields
  for (const field of timestampFields) {
    if (field in example && field in normalized) {
      normalized[field] = example[field];
    }
  }

  // Remove ignored fields
  for (const field of ignoreFields) {
    if (field in normalized) {
      delete normalized[field];
    }
  }

  // Recursively normalize nested objects
  for (const [key, value] of Object.entries(normalized)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (example[key] && typeof example[key] === "object") {
        normalized[key] = normalizeResponse(value, example[key], options);
      }
    }
  }

  return normalized as T;
}

/**
 * Normalizes an array of responses
 */
export function normalizeResponseArray<T extends Record<string, any>>(
  actual: T[],
  example: T[],
  options?: Parameters<typeof normalizeResponse>[2],
): T[] {
  return actual.map((item, index) => {
    const exampleItem = example[index] || example[0];
    return normalizeResponse(item, exampleItem, options);
  });
}

/**
 * Validates that a function's actual behavior aligns with its docstring examples
 */
export async function validateExampleAlignment<TArgs, TResult>(
  t: DocstringTestConvex,
  moduleRelativePath: string,
  exportName: string,
  functionRef: (args: TArgs) => Promise<TResult>,
  testArgs: TArgs,
  options: {
    normalizeOptions?: Parameters<typeof normalizeResponse>[2];
    setupData?: () => Promise<void>;
    exampleLabel?: string;
  } = {},
): Promise<{
  aligned: boolean;
  actual: TResult;
  expected: any;
  errors: string[];
}> {
  const { normalizeOptions, setupData, exampleLabel = "response" } = options;

  const errors: string[] = [];

  try {
    // Load docstring examples
    const docInfo = getDocstringInfoForOperation(
      moduleRelativePath,
      exportName,
    );
    const requestExample = getExampleValue(docInfo, "request") as {
      args: TArgs;
    };
    const responseExample = getExampleValue(docInfo, exampleLabel) as {
      status?: string;
      value?: any;
    };

    if (!requestExample) {
      errors.push(`No "request" example found in docstring`);
    }

    if (!responseExample) {
      errors.push(`No "${exampleLabel}" example found in docstring`);
    }

    if (errors.length > 0) {
      return {
        aligned: false,
        actual: null as any,
        expected: responseExample?.value,
        errors,
      };
    }

    // Set up test data if needed
    if (setupData) {
      await setupData();
    }

    // Execute function with test args
    const actual = await functionRef(testArgs);

    // Normalize the actual result
    const normalizedActual =
      actual && typeof actual === "object"
        ? normalizeResponse(
            actual as any,
            responseExample.value,
            normalizeOptions,
          )
        : actual;

    // Compare with example
    const aligned =
      JSON.stringify(normalizedActual) ===
      JSON.stringify(responseExample.value);

    if (!aligned) {
      errors.push(
        `Response does not match example.\nExpected: ${JSON.stringify(responseExample.value, null, 2)}\nActual: ${JSON.stringify(normalizedActual, null, 2)}`,
      );
    }

    return {
      aligned,
      actual,
      expected: responseExample.value,
      errors,
    };
  } catch (error) {
    errors.push(
      `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      aligned: false,
      actual: null as any,
      expected: null,
      errors,
    };
  }
}

/**
 * Validates that error examples match actual error behavior
 */
export async function validateErrorExample<TArgs>(
  t: DocstringTestConvex,
  moduleRelativePath: string,
  exportName: string,
  functionRef: (args: TArgs) => Promise<any>,
  testArgs: TArgs,
  options: {
    exampleLabel?: string;
    expectedErrorCode?: string;
  } = {},
): Promise<{
  aligned: boolean;
  actualError: any;
  expectedError: any;
  errors: string[];
}> {
  const { exampleLabel = "response-error", expectedErrorCode } = options;

  const errors: string[] = [];

  try {
    // Load docstring examples
    const docInfo = getDocstringInfoForOperation(
      moduleRelativePath,
      exportName,
    );
    const errorExample = getExampleValue(docInfo, exampleLabel) as {
      status?: string;
      errorMessage?: string;
      errorData?: {
        code?: string;
        message?: string;
        [key: string]: any;
      };
    };

    if (!errorExample) {
      errors.push(`No "${exampleLabel}" example found in docstring`);
      return {
        aligned: false,
        actualError: null,
        expectedError: null,
        errors,
      };
    }

    // Execute function and expect it to throw
    let actualError: any = null;
    try {
      await functionRef(testArgs);
      errors.push("Function did not throw an error as expected");
    } catch (error) {
      actualError = error;
    }

    if (!actualError) {
      return {
        aligned: false,
        actualError: null,
        expectedError: errorExample,
        errors,
      };
    }

    // Validate error structure
    const errorCode =
      actualError.data?.code || actualError.code || actualError.name;

    if (expectedErrorCode && errorCode !== expectedErrorCode) {
      errors.push(
        `Error code mismatch. Expected: ${expectedErrorCode}, Actual: ${errorCode}`,
      );
    }

    if (
      errorExample.errorData?.code &&
      errorCode !== errorExample.errorData.code
    ) {
      errors.push(
        `Error code does not match example. Expected: ${errorExample.errorData.code}, Actual: ${errorCode}`,
      );
    }

    const aligned = errors.length === 0;

    return {
      aligned,
      actualError,
      expectedError: errorExample,
      errors,
    };
  } catch (error) {
    errors.push(
      `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      aligned: false,
      actualError: null,
      expectedError: null,
      errors,
    };
  }
}

/**
 * Creates deterministic test IDs that match example placeholders
 */
export function createDeterministicId<T extends TableNames | SystemTableNames>(
  table: T,
  suffix: string,
): Id<T> {
  // Generate a consistent ID format that matches examples
  return `${table}_${suffix}` as Id<T>;
}

/**
 * Creates deterministic timestamps for test data
 */
export function createDeterministicTimestamp(dateString: string): number {
  return new Date(dateString).getTime();
}

/**
 * Asserts that a response matches the structure of an example
 */
export function assertResponseStructure<T extends Record<string, any>>(
  actual: T,
  example: T,
  options: {
    strictTypes?: boolean;
    allowExtraFields?: boolean;
  } = {},
): void {
  const { strictTypes = false, allowExtraFields = false } = options;

  // Check that all example fields exist in actual
  for (const key of Object.keys(example)) {
    expect(actual).toHaveProperty(key);

    if (strictTypes) {
      expect(typeof actual[key]).toBe(typeof example[key]);
    }

    // Recursively check nested objects
    if (
      example[key] &&
      typeof example[key] === "object" &&
      !Array.isArray(example[key])
    ) {
      assertResponseStructure(actual[key], example[key], options);
    }
  }

  // Check for extra fields if not allowed
  if (!allowExtraFields) {
    for (const key of Object.keys(actual)) {
      if (!(key in example)) {
        throw new Error(
          `Unexpected field "${key}" in actual response (not in example)`,
        );
      }
    }
  }
}

/**
 * Validates that all required examples exist for a function
 */
export function validateRequiredExamples(
  moduleRelativePath: string,
  exportName: string,
  requiredLabels: string[] = ["request", "response"],
): {
  valid: boolean;
  missing: string[];
} {
  const docInfo = getDocstringInfoForOperation(moduleRelativePath, exportName);
  const existingLabels = Object.keys(docInfo.examples);
  const missing = requiredLabels.filter(
    (label) => !existingLabels.includes(label),
  );

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Extracts test data from datamodel examples
 */
export function getDataModelExample(
  moduleRelativePath: string,
  exportName: string,
): any {
  const docInfo = getDocstringInfoForOperation(moduleRelativePath, exportName);
  return getExampleValue(docInfo, "datamodel");
}

/**
 * Validates pagination response structure
 */
export function assertPaginationStructure<T>(
  actual: {
    page: T[];
    isDone: boolean;
    continueCursor: string | null;
  },
  example: {
    page: T[];
    isDone: boolean;
    continueCursor: string | null;
  },
): void {
  expect(actual).toHaveProperty("page");
  expect(actual).toHaveProperty("isDone");
  expect(actual).toHaveProperty("continueCursor");

  expect(Array.isArray(actual.page)).toBe(true);
  expect(typeof actual.isDone).toBe("boolean");
  expect(
    actual.continueCursor === null || typeof actual.continueCursor === "string",
  ).toBe(true);

  // Validate page items have same structure as example
  if (actual.page.length > 0 && example.page.length > 0) {
    assertResponseStructure(actual.page[0] as any, example.page[0] as any, {
      allowExtraFields: true,
    });
  }
}

/**
 * Creates a test context with common utilities
 */
export function createTestContext(t: DocstringTestConvex) {
  return {
    /**
     * Validates a query example
     */
    async validateQuery<TArgs, TResult>(
      moduleRelativePath: string,
      exportName: string,
      functionRef: (args: TArgs) => Promise<TResult>,
      testArgs: TArgs,
      options?: Parameters<typeof validateExampleAlignment>[5],
    ) {
      return validateExampleAlignment(
        t,
        moduleRelativePath,
        exportName,
        functionRef,
        testArgs,
        options,
      );
    },

    /**
     * Validates a mutation example
     */
    async validateMutation<TArgs, TResult>(
      moduleRelativePath: string,
      exportName: string,
      functionRef: (args: TArgs) => Promise<TResult>,
      testArgs: TArgs,
      options?: Parameters<typeof validateExampleAlignment>[5],
    ) {
      return validateExampleAlignment(
        t,
        moduleRelativePath,
        exportName,
        functionRef,
        testArgs,
        options,
      );
    },

    /**
     * Validates an action example
     */
    async validateAction<TArgs, TResult>(
      moduleRelativePath: string,
      exportName: string,
      functionRef: (args: TArgs) => Promise<TResult>,
      testArgs: TArgs,
      options?: Parameters<typeof validateExampleAlignment>[5],
    ) {
      return validateExampleAlignment(
        t,
        moduleRelativePath,
        exportName,
        functionRef,
        testArgs,
        options,
      );
    },

    /**
     * Validates an error example
     */
    async validateError<TArgs>(
      moduleRelativePath: string,
      exportName: string,
      functionRef: (args: TArgs) => Promise<any>,
      testArgs: TArgs,
      options?: Parameters<typeof validateErrorExample>[5],
    ) {
      return validateErrorExample(
        t,
        moduleRelativePath,
        exportName,
        functionRef,
        testArgs,
        options,
      );
    },

    /**
     * Normalizes a response for comparison
     */
    normalize: normalizeResponse,

    /**
     * Normalizes an array of responses
     */
    normalizeArray: normalizeResponseArray,

    /**
     * Asserts response structure
     */
    assertStructure: assertResponseStructure,

    /**
     * Asserts pagination structure
     */
    assertPagination: assertPaginationStructure,

    /**
     * Gets datamodel example
     */
    getDataModel: getDataModelExample,

    /**
     * Creates deterministic ID
     */
    createId: createDeterministicId,

    /**
     * Creates deterministic timestamp
     */
    createTimestamp: createDeterministicTimestamp,
  };
}
