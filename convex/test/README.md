# Convex Test Infrastructure

This directory contains test utilities and helpers for validating Convex backend functions and their documentation.

## Overview

The test infrastructure provides:

1. **Example Validation**: Ensures docstring examples match actual function behavior
2. **Test Helpers**: Utilities for normalizing responses and validating structure
3. **Integration Tests**: Real-world scenario testing with convex-test

## Files

### Core Test Files

- **`openapiExamples.test.ts`** - Tests that validate docstring examples against actual function behavior
- **`openapiExamples.ts`** - Utilities for loading and parsing docstring examples
- **`docstringHelpers.ts`** - Helper functions for example validation and normalization
- **`helpers.ts`** - Test data creation utilities (users, meetings, profiles, etc.)
- **`setup.ts`** - Test environment configuration
- **`mocks.ts`** - Mock data and fixtures

### Test Patterns

#### Example Validation Pattern

```typescript
import { describe, expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import { createTestEnvironment } from "./helpers";
import {
  getDocstringInfoForOperation,
  getExampleValue,
} from "./openapiExamples";

test("function example aligns with actual behavior", async () => {
  const t = createTestEnvironment();

  // 1. Load docstring examples
  const docInfo = getDocstringInfoForOperation(
    "convex/users/queries.ts",
    "getUserById",
  );
  const requestExample = getExampleValue(docInfo, "request");
  const responseExample = getExampleValue(docInfo, "response");

  // 2. Set up test data matching examples
  const { userId } = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      workosUserId: "test-user",
      email: "test@example.com",
      displayName: "Test User",
      // ... other fields
    });
  });

  // 3. Execute function with example input
  const result = await t.query(api.users.queries.getUserById, {
    userId,
  });

  // 4. Normalize dynamic values (IDs, timestamps)
  const normalized = {
    ...result,
    _id: responseExample.value._id,
    createdAt: responseExample.value.createdAt,
  };

  // 5. Assert match
  expect(normalized).toMatchObject(responseExample.value);
});
```

#### Using Test Helpers

```typescript
import { createTestContext } from "./docstringHelpers";

test("validate query with helpers", async () => {
  const t = createTestEnvironment();
  const ctx = createTestContext(t);

  // Validate query example alignment
  const result = await ctx.validateQuery(
    "convex/users/queries.ts",
    "getUserById",
    api.users.queries.getUserById,
    { userId: testUserId },
    {
      normalizeOptions: {
        idFields: ["_id", "userId"],
        timestampFields: ["createdAt", "updatedAt"],
      },
    },
  );

  expect(result.aligned).toBe(true);
});
```

#### Error Example Validation

```typescript
test("validate error example", async () => {
  const t = createTestEnvironment();
  const ctx = createTestContext(t);

  const result = await ctx.validateError(
    "convex/users/queries.ts",
    "getUserById",
    api.users.queries.getUserById,
    { userId: "invalid_id" as Id<"users"> },
    {
      expectedErrorCode: "NOT_FOUND",
    },
  );

  expect(result.aligned).toBe(true);
});
```

## Helper Functions

### `normalizeResponse(actual, example, options)`

Normalizes dynamic values in a response to match example placeholders.

**Options:**

- `idFields`: Array of field names to normalize as IDs (default: `["_id", "userId", "meetingId", "organizerId"]`)
- `timestampFields`: Array of field names to normalize as timestamps (default: `["_creationTime", "createdAt", "updatedAt", ...]`)
- `ignoreFields`: Array of field names to exclude from comparison

**Example:**

```typescript
const normalized = normalizeResponse(actualResult, exampleResult, {
  idFields: ["_id", "userId"],
  timestampFields: ["createdAt"],
  ignoreFields: ["_creationTime"],
});
```

### `validateExampleAlignment(t, path, name, fn, args, options)`

Validates that a function's actual behavior aligns with its docstring examples.

**Returns:**

```typescript
{
  aligned: boolean;
  actual: TResult;
  expected: any;
  errors: string[];
}
```

### `assertResponseStructure(actual, example, options)`

Asserts that a response matches the structure of an example.

**Options:**

- `strictTypes`: Enforce strict type checking (default: `false`)
- `allowExtraFields`: Allow fields in actual that aren't in example (default: `false`)

### `assertPaginationStructure(actual, example)`

Validates pagination response structure with `page`, `isDone`, and `continueCursor` fields.

### `createDeterministicId(table, suffix)`

Creates deterministic test IDs that match example placeholders.

```typescript
const userId = createDeterministicId("users", "123example");
// Returns: "users_123example" as Id<"users">
```

### `createDeterministicTimestamp(dateString)`

Creates deterministic timestamps for test data.

```typescript
const timestamp = createDeterministicTimestamp("2024-01-01T00:00:00Z");
// Returns: 1704067200000
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run specific test file
pnpm test:run convex/test/openapiExamples.test.ts

# Run with coverage
pnpm test:run --coverage
```

## Best Practices

### 1. Use Deterministic Test Data

Always use deterministic IDs and timestamps that match docstring examples:

```typescript
const userId = await ctx.db.insert("users", {
  workosUserId: "user_123example", // Matches example
  createdAt: 1704067200000, // Fixed timestamp
  // ...
});
```

### 2. Normalize Before Comparison

Always normalize dynamic values before comparing with examples:

```typescript
const normalized = normalizeResponse(actual, example, {
  idFields: ["_id", "userId"],
  timestampFields: ["createdAt", "updatedAt"],
});

expect(normalized).toMatchObject(example);
```

### 3. Test All Example Types

For each function, test:

- `request` example
- `response` example
- `response-error` example (if applicable)
- `datamodel` example (if applicable)

### 4. Keep Tests Focused

Each test should validate one function's examples. Don't combine multiple functions in a single test.

### 5. Use Test Helpers

Leverage the test context helpers for cleaner, more maintainable tests:

```typescript
const ctx = createTestContext(t);
const result = await ctx.validateQuery(...);
```

## Adding New Tests

When adding documentation to a new function:

1. Add comprehensive docstrings with examples to the function
2. Create a test file (or extend existing) in `convex/test/`
3. Use the example validation pattern
4. Run tests to ensure examples match behavior
5. Update this README if introducing new patterns

## Troubleshooting

### Test Fails: "Response does not match example"

1. Check that dynamic values (IDs, timestamps) are normalized
2. Verify the example JSON is valid and matches the actual structure
3. Use `console.log` to inspect actual vs expected values
4. Ensure test data setup matches the example scenario

### Test Fails: "Example not found"

1. Verify the docstring has the correct `@example` tag
2. Check the example label matches (e.g., "request", "response")
3. Ensure the example is wrapped in a fenced code block

### Test Fails: "Invalid JSON in example"

1. Validate the JSON syntax in the docstring
2. Ensure proper escaping of special characters
3. Run `pnpm validate:docs` to check all docstrings

## Related Documentation

- [Docstring Parser](../../scripts/docstringParser.ts) - Parses JSDoc comments
- [Audit Script](../../scripts/audit-docstrings.ts) - Generates coverage reports
- [Validation Script](../../scripts/validate-docstrings.ts) - Validates docstring format
- [Requirements](.kiro/specs/convex-backend-documentation/requirements.md) - Documentation requirements
- [Design](.kiro/specs/convex-backend-documentation/design.md) - Documentation design
